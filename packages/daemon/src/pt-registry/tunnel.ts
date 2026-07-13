// Cloudflare Tunnel — the "phone from anywhere" default.
//
// `cloudflared tunnel --url http://localhost:<port>` opens an outbound
// connection to Cloudflare's edge and prints a public HTTPS URL like
// https://random-words-xyz.trycloudflare.com — which proxies straight
// back to our local pt-registry browser server. The user opens that
// URL on their phone (LTE, hotel WiFi, anywhere) and the daemon's UI
// loads as if they were sitting at the Mac.
//
// Why this is the default:
//   - No inbound port on the Mac (cloudflared dials out).
//   - No hosting account, no card, no signup, no relay to deploy.
//   - Quick tunnels are free forever. URL changes per restart — for a
//     permanent URL the user runs `cloudflared tunnel login` once
//     (still free, just creates a Cloudflare account).
//
// Single responsibility of this module: spawn cloudflared, capture the
// printed URL, keep it alive while the daemon runs.

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

// qrcode-terminal is CJS — load via createRequire so we stay in strict
// ESM land for the rest of the daemon.
const _req     = createRequire(import.meta.url);
const qrcode   = _req('qrcode-terminal') as typeof import('qrcode-terminal');

const TUNNEL_URL_FILE = path.join(os.homedir(), '.pocket-t', 'tunnel-url');
const URL_REGEX       = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export interface TunnelHandle {
  url:   string;
  stop: () => void;
}

/**
 * Spawn cloudflared and wait for it to print the public URL. Returns
 * the URL and a handle to stop the tunnel later. Throws if cloudflared
 * isn't installed or doesn't print a URL within `timeoutMs`.
 */
export function startTunnel(opts: {
  localPort:  number;
  timeoutMs?: number;
  /** Access token appended (?t=<token>) to the URL persisted for tooling
   *  so the saved link authenticates against the daemon's gate. */
  token?:     string;
}): Promise<TunnelHandle> {
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn('cloudflared', [
        'tunnel', '--url', `http://localhost:${opts.localPort}`,
        // Quieter logs; we only need the URL line.
        '--no-autoupdate',
        '--metrics', '127.0.0.1:0',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new Error(`cloudflared spawn failed: ${(e as Error).message}`));
      return;
    }

    let resolved = false;
    let buffer   = '';

    const onChunk = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(URL_REGEX);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        const url = match[0];
        // Persist for tooling (xbar widget, status CLI, etc). Include the
        // access token so the saved link actually authenticates.
        const savedUrl = opts.token ? `${url}?t=${encodeURIComponent(opts.token)}` : url;
        try {
          fs.mkdirSync(path.dirname(TUNNEL_URL_FILE), { recursive: true });
          // 0600 — the persisted link now carries the access token, so
          // keep it owner-only (anyone who reads it can drive the terminal).
          // The mode option only applies on create, so chmod as well to
          // tighten a file left 0644 by an earlier (pre-token) run.
          fs.writeFileSync(TUNNEL_URL_FILE, savedUrl + '\n', { mode: 0o600 });
          try { fs.chmodSync(TUNNEL_URL_FILE, 0o600); } catch { /* best-effort */ }
        } catch { /* best-effort */ }
        resolve({
          url,
          stop: () => {
            try { proc.kill('SIGTERM'); } catch { /* noop */ }
            try { fs.unlinkSync(TUNNEL_URL_FILE); } catch { /* noop */ }
          },
        });
      }
    };
    proc.stdout?.on('data', onChunk);
    proc.stderr?.on('data', onChunk);

    proc.on('error', (e) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          'cloudflared is not installed.\n' +
          '  macOS:   brew install cloudflared\n' +
          '  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
          '  Then re-run `pt-registry serve --tunnel`.',
        ));
      } else {
        reject(e);
      }
    });

    proc.on('exit', (code, sig) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (code=${code} signal=${sig}) before printing a URL`));
    });

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { proc.kill('SIGTERM'); } catch { /* noop */ }
      reject(new Error(
        `cloudflared did not print a public URL within ${timeoutMs / 1000}s. ` +
        `Last output:\n${buffer.slice(-400)}`,
      ));
    }, timeoutMs);
  });
}

/** Render the tunnel banner on the daemon's terminal — prominent URL +
 *  a scannable QR code. The QR is what makes the "open on phone" step
 *  trivial — no typing, no copy-paste.
 *
 *  When a `token` is supplied it is appended as `?t=<token>` so the
 *  published URL authenticates against the daemon's access gate — the
 *  tunnel must never expose an unauthenticated surface. */
export function printTunnelBanner(url: string, token?: string): void {
  const publicUrl = token ? `${url}?t=${encodeURIComponent(token)}` : url;
  console.log('');
  console.log('━'.repeat(60));
  console.log('  🚇 pocket-t tunnel ready');
  console.log('');
  console.log('  Open on your phone (or any device, any network):');
  console.log('');
  console.log(`     ${publicUrl}`);
  console.log('');
  qrcode.generate(publicUrl, { small: true });
  console.log(`  This URL carries an access token — anyone with it can`);
  console.log(`  drive your terminal. Don't share it.`);
  console.log('━'.repeat(60));
  console.log('');
}
