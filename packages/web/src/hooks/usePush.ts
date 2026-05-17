import { useState, useCallback } from 'react';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC as string;

type PushState =
  | 'unsupported'
  | 'not-standalone'
  | 'prompt'
  | 'enabled'
  | 'denied';

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const str = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

function getInitialState(): PushState {
  if (typeof window === 'undefined')             return 'unsupported';
  if (!('PushManager' in window))               return 'unsupported';
  if (!('serviceWorker' in navigator))          return 'unsupported';
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;
  if (!isStandalone)                            return 'not-standalone';
  if (Notification.permission === 'granted')   return 'enabled';
  if (Notification.permission === 'denied')    return 'denied';
  return 'prompt';
}

export function usePush() {
  const [state, setState] = useState<PushState>(getInitialState);

  const enablePush = useCallback(async () => {
    try {
      const reg  = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();

      if (perm !== 'granted') { setState('denied'); return false; }

      const sub  = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      });
      const json = sub.toJSON();

      await fetch('/api/push/subscribe', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });

      setState('enabled');
      return true;
    } catch (e) {
      console.error('[push]', e);
      return false;
    }
  }, []);

  return { state, enablePush };
}
