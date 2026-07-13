import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PushService,
  isValidSubscription,
  loadPushServiceFromEnv,
  type StoredSubscription,
  type PushPayload,
} from './push.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pt-push-'));
}

function sub(endpoint: string): StoredSubscription {
  return {
    endpoint,
    keys: { p256dh: 'BPUBLICKEY', auth: 'AUTHSECRET' },
  } as StoredSubscription;
}

const VAPID = {
  subject:    'mailto:test@example.com',
  publicKey:  'BPUBLIC',
  privateKey: 'PRIVATE',
};

describe('isValidSubscription', () => {
  it('accepts a well-formed subscription', () => {
    expect(isValidSubscription(sub('https://push.example/abc'))).toBe(true);
  });
  it('rejects garbage / missing keys / bad endpoint', () => {
    expect(isValidSubscription(null)).toBe(false);
    expect(isValidSubscription({})).toBe(false);
    expect(isValidSubscription({ endpoint: 'ftp://nope', keys: { p256dh: 'x', auth: 'y' } })).toBe(false);
    expect(isValidSubscription({ endpoint: 'https://ok', keys: { p256dh: 'x' } })).toBe(false);
  });
});

describe('PushService', () => {
  let dir: string;
  let store: string;
  beforeEach(() => { dir = tmpDir(); store = path.join(dir, 'push-subscriptions.json'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('stores a subscription, dedupes by endpoint, and persists atomically', () => {
    const sender = vi.fn(async () => ({ statusCode: 201 }));
    const svc = new PushService({ config: VAPID, storeFile: store, sender });
    expect(svc.addSubscription(sub('https://push.example/a'))).toBe(true);
    expect(svc.addSubscription(sub('https://push.example/a'))).toBe(true); // dedupe
    expect(svc.addSubscription(sub('https://push.example/b'))).toBe(true);
    expect(svc.subscriptionCount).toBe(2);
    expect(svc.addSubscription({ bogus: true })).toBe(false);

    // Persisted to disk, owner-only, no temp left behind.
    expect(fs.existsSync(`${store}.tmp`)).toBe(false);
    expect(fs.statSync(store).mode & 0o777).toBe(0o600);

    // A fresh service restores the two subscriptions.
    const svc2 = new PushService({ config: VAPID, storeFile: store, sender });
    expect(svc2.subscriptionCount).toBe(2);
  });

  it('the no-watcher send path: notify() delivers a payload to every subscription', async () => {
    const seen: Array<{ endpoint: string; payload: PushPayload }> = [];
    const sender = vi.fn(async (s: StoredSubscription, body: string) => {
      seen.push({ endpoint: s.endpoint, payload: JSON.parse(body) as PushPayload });
      return { statusCode: 201 };
    });
    const svc = new PushService({ config: VAPID, storeFile: store, sender });
    svc.addSubscription(sub('https://push.example/a'));
    svc.addSubscription(sub('https://push.example/b'));

    const delivered = await svc.notify({
      title: 'pocket-t — approval needed',
      body:  'Bash requires approval',
      data:  { sessionId: 'sess-1', tag: 'approval-xyz' },
    });

    expect(delivered).toBe(2);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(seen.map((s) => s.endpoint).sort()).toEqual([
      'https://push.example/a',
      'https://push.example/b',
    ]);
    // The service worker renders exactly this shape.
    expect(seen[0].payload.title).toBe('pocket-t — approval needed');
    expect(seen[0].payload.body).toBe('Bash requires approval');
    expect(seen[0].payload.data).toEqual({ sessionId: 'sess-1', tag: 'approval-xyz' });
  });

  it('notify() with zero subscriptions sends nothing', async () => {
    const sender = vi.fn(async () => ({ statusCode: 201 }));
    const svc = new PushService({ config: VAPID, storeFile: store, sender });
    expect(await svc.notify({ title: 't', body: 'b' })).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it('prunes subscriptions the push service reports gone (404/410)', async () => {
    const sender = vi.fn(async (s: StoredSubscription) => {
      if (s.endpoint.endsWith('/dead')) {
        const err = new Error('gone') as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
      return { statusCode: 201 };
    });
    const svc = new PushService({ config: VAPID, storeFile: store, sender });
    svc.addSubscription(sub('https://push.example/live'));
    svc.addSubscription(sub('https://push.example/dead'));
    expect(svc.subscriptionCount).toBe(2);

    const delivered = await svc.notify({ title: 't', body: 'b' });
    expect(delivered).toBe(1);
    expect(svc.subscriptionCount).toBe(1);

    // The pruning is persisted.
    const svc2 = new PushService({ config: VAPID, storeFile: store, sender });
    expect(svc2.subscriptionCount).toBe(1);
  });

  it('keeps a subscription on a transient (non-404/410) error', async () => {
    const sender = vi.fn(async () => {
      const err = new Error('rate limited') as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    });
    const svc = new PushService({ config: VAPID, storeFile: store, sender });
    svc.addSubscription(sub('https://push.example/a'));
    const delivered = await svc.notify({ title: 't', body: 'b' });
    expect(delivered).toBe(0);
    expect(svc.subscriptionCount).toBe(1); // not pruned
  });
});

describe('loadPushServiceFromEnv', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('returns null (disabled) when no VAPID keys are set', () => {
    delete process.env.POCKET_T_VAPID_PUBLIC_KEY;
    delete process.env.POCKET_T_VAPID_PRIVATE_KEY;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const svc = loadPushServiceFromEnv(path.join(tmpDir(), 'x.json'));
    expect(svc).toBeNull();
    spy.mockRestore();
  });
});
