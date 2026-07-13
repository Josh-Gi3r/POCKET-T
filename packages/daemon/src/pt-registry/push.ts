// Server-side Web Push.
//
// The browser subscribes with the VAPID *public* key baked into the PWA at
// build time and POSTs the resulting PushSubscription to the daemon. This
// module is the other half: it holds the VAPID *private* key, stores the
// subscriptions, and — when an approval needs a human but no browser is
// live on that session — pushes a notification the service worker renders.
//
// Push is entirely optional. With no VAPID key pair configured the service
// is disabled: it logs a single hint at startup and every entry point is a
// no-op, so the daemon runs exactly as before.

import * as fs from 'node:fs';
import webpush from 'web-push';
import type { PushSubscription } from 'web-push';

export interface VapidConfig {
  // Contact URI the push service can reach the sender at: a `mailto:` or an
  // `https:` URL, per the VAPID spec.
  subject:    string;
  publicKey:  string;
  privateKey: string;
}

// The JSON shape the browser's PushManager produces and POSTs to us.
export type StoredSubscription = PushSubscription;

// Notification body the service worker's `push` handler understands
// (see the web-client service worker): { title, body, data }.
export interface PushPayload {
  title: string;
  body:  string;
  data?: Record<string, unknown>;
}

// Injectable transport so the send path is testable without real network.
// Resolves with the push service's HTTP status; rejects with an error that
// may carry a `statusCode` (404/410 mean the subscription is dead).
export type PushSender = (
  subscription: StoredSubscription,
  payload:      string,
) => Promise<{ statusCode: number }>;

interface PersistedSubscriptions {
  version:       number;
  subscriptions: StoredSubscription[];
}

const SUBS_VERSION = 1;

/** Shallow structural check that a value is a usable PushSubscription. */
export function isValidSubscription(v: unknown): v is StoredSubscription {
  if (!v || typeof v !== 'object') return false;
  const s = v as StoredSubscription;
  return typeof s.endpoint === 'string'
    && /^https?:\/\//.test(s.endpoint)
    && !!s.keys
    && typeof s.keys.p256dh === 'string'
    && typeof s.keys.auth === 'string';
}

function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * Web Push subscriber registry + sender. Instantiated only when a VAPID key
 * pair is configured. Subscriptions persist to a sibling file of state.json
 * so a daemon restart keeps notifying already-registered devices.
 */
export class PushService {
  private readonly storeFile: string;
  private readonly sender:    PushSender;
  private subs = new Map<string, StoredSubscription>();

  constructor(opts: { config: VapidConfig; storeFile: string; sender?: PushSender }) {
    this.storeFile = opts.storeFile;
    if (opts.sender) {
      this.sender = opts.sender;
    } else {
      // Real transport. setVapidDetails validates the key pair and subject.
      webpush.setVapidDetails(opts.config.subject, opts.config.publicKey, opts.config.privateKey);
      this.sender = (subscription, payload) => webpush.sendNotification(subscription, payload);
    }
    this.load();
  }

  get subscriptionCount(): number {
    return this.subs.size;
  }

  /** Register (or refresh) a subscription. Returns false when the payload
   *  isn't a usable PushSubscription. Deduplicated by endpoint. */
  addSubscription(raw: unknown): boolean {
    if (!isValidSubscription(raw)) return false;
    this.subs.set(raw.endpoint, raw);
    this.persist();
    return true;
  }

  /** Drop a subscription by endpoint (e.g. the device unsubscribed). */
  removeSubscription(endpoint: string): void {
    if (this.subs.delete(endpoint)) this.persist();
  }

  /**
   * Deliver a notification to every stored device. Subscriptions the push
   * service reports as gone (404/410) are pruned. Returns the number of
   * notifications the push service accepted.
   */
  async notify(payload: PushPayload): Promise<number> {
    if (this.subs.size === 0) return 0;
    const body = JSON.stringify(payload);
    const dead: string[] = [];
    let delivered = 0;
    await Promise.all(
      Array.from(this.subs.values()).map(async (sub) => {
        try {
          await this.sender(sub, body);
          delivered++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            dead.push(sub.endpoint);
          } else {
            console.warn('[pt-registry] web push send failed:', (e as Error).message);
          }
        }
      }),
    );
    if (dead.length > 0) {
      for (const endpoint of dead) this.subs.delete(endpoint);
      this.persist();
    }
    return delivered;
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storeFile, 'utf8');
    } catch {
      return; // no prior subscriptions
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSubscriptions>;
      if (parsed?.version !== SUBS_VERSION || !Array.isArray(parsed.subscriptions)) return;
      for (const s of parsed.subscriptions) {
        if (isValidSubscription(s)) this.subs.set(s.endpoint, s);
      }
    } catch {
      /* malformed store — start empty */
    }
  }

  private persist(): void {
    const data: PersistedSubscriptions = {
      version:       SUBS_VERSION,
      subscriptions: Array.from(this.subs.values()),
    };
    try {
      atomicWriteJson(this.storeFile, data);
    } catch (e) {
      console.warn('[pt-registry] push subscription persist failed:', (e as Error).message);
    }
  }
}

/**
 * Build a PushService from the environment, or return null when push isn't
 * configured. Reads POCKET_T_VAPID_PUBLIC_KEY / POCKET_T_VAPID_PRIVATE_KEY
 * (the public key must match the PWA's VITE_VAPID_PUBLIC_KEY) and an
 * optional POCKET_T_VAPID_SUBJECT contact URI. Logs one line either way so
 * the operator can tell whether phone notifications are live.
 */
export function loadPushServiceFromEnv(storeFile: string): PushService | null {
  const publicKey  = process.env.POCKET_T_VAPID_PUBLIC_KEY  ?? '';
  const privateKey = process.env.POCKET_T_VAPID_PRIVATE_KEY ?? '';
  if (!publicKey || !privateKey) {
    console.log('[pt-registry] web push disabled — set POCKET_T_VAPID_PUBLIC_KEY + POCKET_T_VAPID_PRIVATE_KEY to enable phone notifications (generate a pair with `npx web-push generate-vapid-keys`)');
    return null;
  }
  const subject = process.env.POCKET_T_VAPID_SUBJECT || 'mailto:pocket-t@localhost';
  try {
    const service = new PushService({ config: { subject, publicKey, privateKey }, storeFile });
    console.log(`[pt-registry] web push enabled (${service.subscriptionCount} subscription(s) restored)`);
    return service;
  } catch (e) {
    console.warn('[pt-registry] web push init failed, disabling:', (e as Error).message);
    return null;
  }
}
