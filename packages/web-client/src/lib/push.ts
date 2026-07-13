/**
 * Web Push subscription (client side).
 *
 * Requests Notification permission, grabs the active service-worker
 * registration, creates a PushSubscription against the VAPID public key
 * baked in at build time (VITE_VAPID_PUBLIC_KEY), and registers it with the
 * daemon (POST /push/subscribe) so the daemon can wake this device when an
 * approval is raised with no live browser watching. The daemon holds the
 * VAPID private key and does the actual send; the service worker's 'push'
 * handler (src/sw.ts) renders it.
 *
 * Generate a key pair once with `npx web-push generate-vapid-keys`, set the
 * public key as VITE_VAPID_PUBLIC_KEY at build time, and the private key on
 * the daemon (POCKET_T_VAPID_PRIVATE_KEY).
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushConfigured(): boolean {
  return typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 0;
}

export async function enableNotifications(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

/**
 * Subscribe this device to Web Push and register it with the daemon.
 * No-ops with null when push isn't supported, permission is denied, or no
 * VAPID key was provided at build time.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!pushConfigured()) return null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;

  const permission = await enableNotifications();
  if (permission !== 'granted') return null;

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string) as unknown as BufferSource,
    }));

  // Register with the daemon so it can target this device. The entry
  // document set an HttpOnly SameSite=Strict cookie carrying the token, so
  // `credentials: 'include'` authenticates the token-gated endpoint without
  // exposing the token to page JS. Best-effort: local Notifications still
  // fire for a foregrounded tab even if registration fails.
  try {
    await fetch('/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
  } catch {
    /* registration is best-effort */
  }

  return sub;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
