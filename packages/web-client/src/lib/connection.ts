import { WebSocket as PartySocket } from 'partysocket';
import {
  MsgType,
  SubscribeFlags,
  encodeFrame,
  decodeFrame,
  encodeSubscribePayload,
  encodeResizePayload,
  encodeHelloPayload,
  encodeText,
  decodeText,
} from './protocol';
import { OutboundQueue } from './outbound';
import type { ConnStatus } from './types';

const FULL_FLAGS = SubscribeFlags.Stdout | SubscribeFlags.Snapshots | SubscribeFlags.Events;
const PING_INTERVAL_MS = 15_000;

export interface ConnectionHandlers {
  onStatus?: (s: ConnStatus) => void;
  onStdout?: (sessionId: string, bytes: Uint8Array) => void;
  onSnapshot?: (sessionId: string, text: string) => void;
  onEvent?: (sessionId: string, json: unknown) => void;
  onWelcome?: () => void;
  /** Fired right before a reconnect re-SUBSCRIBEs the current session, so
   *  the consumer can clear that session's replayed state and let the
   *  daemon's history replay rebuild it cleanly (no duplicate bubbles). */
  onResync?: (sessionId: string) => void;
}

/**
 * PTConnection — a reconnecting ws-v3 client.
 *
 * The whole point of this class is the reconnect-owns-resubscribe rule
 * from ws-v3.ts: on EVERY (re)open we send HELLO(token) then re-SUBSCRIBE
 * the currently-watched session. The daemon replies to SUBSCRIBE with a
 * fresh SNAPSHOT_VT + a replay of adapter-event history, so the UI
 * resyncs automatically after a phone backgrounds, a tunnel blips, or the
 * network flaps. We never try to "catch up" by hand — re-subscribe is the
 * resync.
 *
 * partysocket gives us the backoff/retry transport; we layer the ws-v3
 * handshake, a ping keepalive, and visibility/online nudges on top.
 */
export class PTConnection {
  private ws: PartySocket;
  private token: string;
  private currentSession: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private handlers: ConnectionHandlers;
  // Buffers user input produced while the socket is reconnecting; flushed
  // in order on the next open so nothing typed mid-reconnect is lost.
  private outbound = new OutboundQueue<Uint8Array>();
  // First open vs. a reconnect: a reconnect must clear-then-resubscribe.
  private hasOpened = false;

  constructor(handlers: ConnectionHandlers) {
    this.handlers = handlers;
    this.token = readAndScrubToken();

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    // URL provider is re-evaluated on every reconnect so a token rotated
    // into the URL bar (or a changed host after a tunnel swap) is picked
    // up without recreating the socket.
    const urlProvider = () => {
      const t = this.token ? `?t=${encodeURIComponent(this.token)}` : '';
      return `${scheme}://${location.host}/ws${t}`;
    };

    // partysocket signature: new WebSocket(url, protocols?, options?).
    // `url` may be a provider fn, re-evaluated on every reconnect.
    this.ws = new PartySocket(urlProvider, undefined, {
      // Reconnect forever with bounded exponential backoff.
      maxRetries: Infinity,
      minReconnectionDelay: 500,
      maxReconnectionDelay: 15_000,
      reconnectionDelayGrowFactor: 1.6,
      // Consider the connection dead if it doesn't open reasonably fast.
      connectionTimeout: 8_000,
    });
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('open', () => this.onOpen());
    this.ws.addEventListener('message', (e) => this.onMessage(e as MessageEvent));
    this.ws.addEventListener('close', () => {
      this.stopPing();
      this.handlers.onStatus?.('reconnecting');
    });
    this.ws.addEventListener('error', () => {
      this.handlers.onStatus?.('reconnecting');
    });

    this.handlers.onStatus?.('connecting');
    this.installLifecycleNudges();
  }

  private onOpen(): void {
    this.handlers.onStatus?.('open');
    const isReconnect = this.hasOpened;
    this.hasOpened = true;
    // 1) authenticate. On the relay path this HELLO token is the ONLY
    //    auth; on the local/tunnel path it's harmless (cookie already
    //    gated the upgrade). Either way the daemon replies with WELCOME
    //    + the session catalog.
    this.send(encodeFrame({ type: MsgType.HELLO, payload: encodeHelloPayload(this.token) }));
    // 2) resume: re-subscribe whatever we were watching so the daemon
    //    re-snapshots + replays events for it. On a reconnect the replay is
    //    the FULL history, so ask the consumer to clear the session's local
    //    state first — otherwise the replay appends a duplicate copy. The
    //    first open has nothing to clear (no session attached yet).
    if (this.currentSession) {
      if (isReconnect) this.handlers.onResync?.(this.currentSession);
      this.sendSubscribe(this.currentSession);
    }
    this.startPing();
    // 3) flush any input the user produced while we were reconnecting.
    this.outbound.flush((frame) => this.rawSend(frame));
  }

  private onMessage(e: MessageEvent): void {
    const data = e.data;
    if (!(data instanceof ArrayBuffer)) return;
    const frame = decodeFrame(new Uint8Array(data));
    if (!frame) return;
    switch (frame.type) {
      case MsgType.WELCOME:
        this.handlers.onWelcome?.();
        break;
      case MsgType.STDOUT:
        this.handlers.onStdout?.(frame.sessionId, frame.payload);
        break;
      case MsgType.SNAPSHOT_VT:
        this.handlers.onSnapshot?.(frame.sessionId, decodeText(frame.payload));
        break;
      case MsgType.EVENT:
        try {
          this.handlers.onEvent?.(frame.sessionId, JSON.parse(decodeText(frame.payload)));
        } catch {
          /* malformed event json — ignore */
        }
        break;
      case MsgType.PONG:
        // pipe is alive; partysocket handles liveness, this is a soft signal.
        break;
      default:
        break;
    }
  }

  /** Attach to a session: unsubscribe the old one, remember + subscribe
   *  the new one. The remembered id is what gets re-subscribed on every
   *  future reconnect. */
  attach(sessionId: string): void {
    if (this.currentSession === sessionId) return;
    if (this.currentSession && this.isOpen()) {
      this.send(encodeFrame({ type: MsgType.UNSUBSCRIBE, sessionId: this.currentSession }));
    }
    this.currentSession = sessionId;
    if (this.isOpen()) this.sendSubscribe(sessionId);
  }

  /** Re-SUBSCRIBE the current session on demand — the daemon replies with
   *  a fresh SNAPSHOT_VT + event-history replay. Used when the terminal tab
   *  mounts late (it missed the attach-time snapshot). */
  resubscribe(): void {
    if (this.currentSession && this.isOpen()) this.sendSubscribe(this.currentSession);
  }

  private sendSubscribe(sessionId: string): void {
    this.send(
      encodeFrame({
        type: MsgType.SUBSCRIBE,
        sessionId,
        payload: encodeSubscribePayload({ flags: FULL_FLAGS }),
      }),
    );
  }

  /** Send user keystrokes/text to the attached session's PTY. Returns true
   *  once the input is accepted — sent immediately or buffered for the next
   *  open — and false only when there is no attached session to send to. */
  sendInput(text: string): boolean {
    if (!this.currentSession) return false;
    this.sendUserFrame(
      encodeFrame({
        type: MsgType.INPUT_TEXT,
        sessionId: this.currentSession,
        payload: encodeText(text),
      }),
    );
    return true;
  }

  /** Raw key bytes (e.g. escape sequences from the touch keyboard row). */
  sendKeyBytes(bytes: Uint8Array): boolean {
    if (!this.currentSession) return false;
    this.sendUserFrame(
      encodeFrame({ type: MsgType.INPUT_KEY, sessionId: this.currentSession, payload: bytes }),
    );
    return true;
  }

  sendResize(cols: number, rows: number): void {
    if (!this.currentSession) return;
    this.send(
      encodeFrame({
        type: MsgType.RESIZE,
        sessionId: this.currentSession,
        payload: encodeResizePayload(cols, rows),
      }),
    );
  }

  /** Browser → daemon JSON EVENT (approvalDecision / spawnSession). */
  sendJsonEvent(sessionId: string, obj: unknown): void {
    this.send(
      encodeFrame({
        type: MsgType.EVENT,
        sessionId,
        payload: encodeText(JSON.stringify(obj)),
      }),
    );
  }

  resolveApproval(sessionId: string, approvalId: string, decision: 'approve' | 'deny'): void {
    this.sendJsonEvent(sessionId, { kind: 'approvalDecision', approvalId, decision });
  }

  spawnSession(cwd?: string): void {
    // sessionId is irrelevant for spawn; server keys off the payload.
    this.sendJsonEvent('', { kind: 'spawnSession', ...(cwd ? { cwd } : {}) });
  }

  killSession(sessionId: string): void {
    this.send(encodeFrame({ type: MsgType.KILL, sessionId }));
  }

  private isOpen(): boolean {
    return this.ws.readyState === PartySocket.OPEN;
  }

  private rawSend(frame: Uint8Array): void {
    // Cast: TS 5.7+ widens Uint8Array's buffer to ArrayBufferLike, but
    // encodeFrame always allocates over a fresh ArrayBuffer, so this is a
    // valid BufferSource on the wire.
    this.ws.send(frame as unknown as ArrayBufferView<ArrayBuffer>);
  }

  /** Control frames (HELLO/SUBSCRIBE/PING/RESIZE/…) are regenerated on the
   *  next open, so dropping them while closed is correct. */
  private send(frame: Uint8Array): void {
    if (this.isOpen()) this.rawSend(frame);
  }

  /** User input cannot be regenerated, so buffer it while closed and let
   *  onOpen flush it in order. */
  private sendUserFrame(frame: Uint8Array): void {
    if (this.isOpen()) this.rawSend(frame);
    else this.outbound.enqueue(frame);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send(encodeFrame({ type: MsgType.PING }));
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * The reason this app exists: phones aggressively freeze background
   * tabs and silently kill sockets. When the page comes back to the
   * foreground (visibilitychange / pageshow) or the network returns
   * (online), we force partysocket to (re)connect immediately instead of
   * waiting out its backoff timer. On reconnect, onOpen re-subscribes and
   * the daemon re-snapshots — so the user sees current state instantly.
   */
  private installLifecycleNudges(): void {
    const nudge = () => {
      if (this.ws.readyState !== PartySocket.OPEN) {
        this.handlers.onStatus?.('reconnecting');
        try {
          this.ws.reconnect();
        } catch {
          /* partysocket already dialing */
        }
      } else {
        // Socket claims open but may be a zombie after a long freeze —
        // a ping shakes it; a dead one triggers close→reconnect.
        this.send(encodeFrame({ type: MsgType.PING }));
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') nudge();
    });
    window.addEventListener('pageshow', nudge);
    window.addEventListener('online', nudge);
    window.addEventListener('focus', nudge);
  }

  close(): void {
    this.stopPing();
    this.ws.close();
  }
}

/** Token comes from ?t= / ?token= (the URL the daemon prints). On the
 *  same-origin local/tunnel path the daemon also sets an HttpOnly cookie,
 *  so the ws upgrade authenticates even with no query token — but we
 *  still forward any query token for the relay path.
 *
 *  We read it exactly once, then scrub it out of the address bar with
 *  history.replaceState. Left in the URL it would leak into browser
 *  history, tab sync, and any copied/shared link; the in-memory copy plus
 *  the daemon's cookie carry every later (re)connect. */
function readAndScrubToken(): string {
  try {
    const url = new URL(location.href);
    const token = url.searchParams.get('t') ?? url.searchParams.get('token') ?? '';
    if (url.searchParams.has('t') || url.searchParams.has('token')) {
      url.searchParams.delete('t');
      url.searchParams.delete('token');
      const scrubbed = url.pathname + (url.search ? url.search : '') + url.hash;
      history.replaceState(history.state, '', scrubbed);
    }
    return token;
  } catch {
    return '';
  }
}
