import { useState, useEffect, useCallback } from 'react';

interface CryptoKeys {
  outputKey: CryptoKey;  // decrypt incoming (daemon output)
  inputKey:  CryptoKey;  // encrypt outgoing (user input)
}

type CryptoState = 'none' | 'loading' | 'ready' | 'error';

async function importKey(b64: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

export function useCrypto(sessionId: string) {
  const [keys,  setKeys]  = useState<CryptoKeys | null>(null);
  const [state, setState] = useState<CryptoState>('none');

  // Load keys from URL fragment (never from server)
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const params      = new URLSearchParams(hash);
    const outputKeyB64 = params.get('outputKey');
    const inputKeyB64  = params.get('inputKey');

    if (!outputKeyB64 || !inputKeyB64) return;

    setState('loading');
    Promise.all([
      importKey(outputKeyB64, ['decrypt']),
      importKey(inputKeyB64,  ['encrypt']),
    ]).then(([outputKey, inputKey]) => {
      setKeys({ outputKey, inputKey });
      setState('ready');
      // Clear fragment from URL — don't leave keys in history
      history.replaceState(null, '', window.location.pathname);
    }).catch(() => setState('error'));
  }, [sessionId]);

  const decrypt = useCallback(async (
    ivHex: string, dataHex: string, tagHex: string,
  ): Promise<string> => {
    if (!keys) throw new Error('No crypto keys');
    const iv   = Uint8Array.from(ivHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const data = Uint8Array.from(dataHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const tag  = Uint8Array.from(tagHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

    // GCM: data + tag concatenated for SubtleCrypto
    const combined = new Uint8Array(data.length + tag.length);
    combined.set(data);
    combined.set(tag, data.length);

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      keys.outputKey,
      combined,
    );
    return new TextDecoder().decode(plain);
  }, [keys]);

  const encrypt = useCallback(async (plaintext: string): Promise<{
    iv: string; data: string; tag: string;
  }> => {
    if (!keys) throw new Error('No crypto keys');
    const iv      = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipher  = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      keys.inputKey,
      encoded,
    );
    // SubtleCrypto returns data+tag concatenated
    const result  = new Uint8Array(cipher);
    const data    = result.slice(0, -16);
    const tag     = result.slice(-16);

    const toHex = (u: Uint8Array) =>
      Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');

    return {
      iv:   toHex(iv),
      data: toHex(data),
      tag:  toHex(tag),
    };
  }, [keys]);

  return { state, decrypt, encrypt };
}
