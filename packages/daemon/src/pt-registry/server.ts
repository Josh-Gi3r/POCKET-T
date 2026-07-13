// pt-registry — the daemon-side pt session registry.
//
// Speaks the binary frame protocol from `packages/pt-shim/src/ipc.rs`
// over a Unix socket at ~/.pocket-t/pt.sock. Tracks every pt session
// in-memory and exposes a tiny JSON control protocol on a second socket
// at ~/.pocket-t/ctl.sock for CLI inspection and remote input injection.
//
// Subcommands:
//   serve                          — long-running server (start this first)
//   list                           — print active sessions as JSON
//   input <sessionId> <bytes...>   — write bytes to a session's PTY master
//   kill  <sessionId> [signal]     — send a signal to a session's shell
//
// Model A semantics: `pt` owns the PTY master locally. The
// daemon never holds a PTY fd; it just brokers messages between `pt`
// (one Unix socket per pt process) and remote viewers (the
// browser; for now: the local CLI).

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { spawn as spawnChild } from 'node:child_process';
import { createRequire } from 'node:module';
import { WebSocketServer, WebSocket } from 'ws';
import type { Terminal as HeadlessTerminalType } from '@xterm/headless';
import type { SerializeAddon as SerializeAddonType } from '@xterm/addon-serialize';
import {
  encodeWsV3Frame,
  decodeWsV3Frame,
  decodeSubscribePayload,
  WsV3MessageType,
  WsV3SubscribeFlags,
} from '@pocket-t/shared';
import type { Adapter, BubbleEvent } from '../adapters/Adapter.js';
import { detectAdapter } from '../adapters/detect.js';
import { HookServer } from '../hooks/HookServer.js';
import { Recorder } from './recorder.js';
import { startTunnel, printTunnelBanner, type TunnelHandle } from './tunnel.js';
import {
  readState,
  writeStateAtomic,
  pidAlive,
  acquireInstanceLock,
  releaseInstanceLock,
  listTmuxSessions,
  sessionIdFromTmuxName,
  tmuxSessionName,
  tmuxSessionAlive,
  killTmuxSession,
  type PersistedSession,
  type PersistedEvent,
} from './state.js';
import { loadPushServiceFromEnv, type PushService } from './push.js';

// @xterm/headless and @xterm/addon-serialize ship as CommonJS — Node 22's
// strict ESM loader rejects `import { Terminal } from '@xterm/headless'`
// because the package doesn't expose a named ESM export. createRequire
// loads them through the CJS path, and we re-apply the proper types
// above for typechecking.
const _require = createRequire(import.meta.url);
const HeadlessTerminal = _require('@xterm/headless').Terminal as typeof HeadlessTerminalType;
const SerializeAddon   = _require('@xterm/addon-serialize').SerializeAddon as typeof SerializeAddonType;

// ─── Frame protocol (mirrors packages/pt-shim/src/ipc.rs) ──────────────────

const PROTOCOL_VERSION = 1;

// pt → daemon
const FRAME_HELLO    = 0x01;
const FRAME_REGISTER = 0x02;
const FRAME_STDOUT   = 0x03;
const FRAME_RESIZE   = 0x04;
const FRAME_EXIT     = 0x05;

// daemon → pt
const FRAME_ACK            = 0x10;
const FRAME_INPUT          = 0x11;
const FRAME_KILL           = 0x12;
const FRAME_RESIZE_REMOTE  = 0x13;

const POCKET_T_DIR = path.join(os.homedir(), '.pocket-t');
const PT_SOCK_PATH  = path.join(POCKET_T_DIR, 'pt.sock');
export const CTL_SOCK_PATH = path.join(POCKET_T_DIR, 'ctl.sock');
export const RECORDINGS_DIR = path.join(POCKET_T_DIR, 'recordings');
// Persisted session registry — rehydrated on daemon restart so the
// catalog (and the detach-grace resume it enables) survives a restart.
export const STATE_FILE = path.join(POCKET_T_DIR, 'state.json');
// Web Push subscriptions, persisted beside the state file so a restart
// keeps notifying already-registered devices.
export const PUSH_SUBS_FILE = path.join(POCKET_T_DIR, 'push-subscriptions.json');
// Single-instance lock: a pidfile that keeps a second daemon from
// unlinking and re-binding this one's sockets and splitting the catalog.
export const LOCK_FILE = path.join(POCKET_T_DIR, 'daemon.lock');
// How much scrollback to fold into a persisted VT snapshot. Bounds the size
// of state.json while still painting a re-attaching browser a full screen
// plus a little history.
const SNAPSHOT_SCROLLBACK = 200;
// Cap on the adapter events persisted per session — the recent bubbles and
// the latest cost update, not the whole conversation.
const MAX_PERSISTED_EVENTS = 100;

// Local browser endpoint. any browser on the same Mac can
// open http://127.0.0.1:7700/ and see / control pt sessions over ws-v3.
// swaps this for going through the relay so any browser anywhere
// can connect via outbound websocket.
// Default: loopback only — anything on your Mac, nothing across the
// network. Override with POCKET_T_BROWSER_HOST=0.0.0.0 to expose the
// daemon to your LAN (e.g. so your phone on the same WiFi can hit
// http://<mac-lan-ip>:7700/ directly). Use a relay hub for the
// cross-network case (no inbound port required).
const BROWSER_PORT = Number(process.env.POCKET_T_BROWSER_PORT ?? 7700);
const BROWSER_HOST = process.env.POCKET_T_BROWSER_HOST ?? '127.0.0.1';

// Per-daemon bearer token minted at startup (see runServer). Every /ws
// upgrade and every page GET must carry it — via ?t=<token> in the URL
// the daemon prints, an Authorization: Bearer header, or the same-origin
// cookie the page route sets. Empty until runServer() mints it; an empty
// token rejects everything, so nothing is ever served unauthenticated.
let BROWSER_TOKEN = '';

// Origin allowlist for the /ws upgrade. Populated in runServer with the
// daemon's own loopback host(s) and, once known, the tunnel/relay host.
// A drive-by website's Origin never lands here, so it can't open a
// ws://localhost socket even before the token check runs.
const ALLOWED_ORIGIN_HOSTS = new Set<string>();

// Keystroke recording is OFF by default — the .cast files capture every
// byte typed, including passwords pasted into prompts. Opt in explicitly
// with POCKET_T_RECORD=1 (or true/yes/on).
const RECORDING_ENABLED = /^(1|true|yes|on)$/i.test(process.env.POCKET_T_RECORD ?? '');

// when a pt socket drops without a clean FRAME_EXIT, we hold
// the session in "detached" state for this long. Lets the browser show
// a graceful "detached" badge instead of yanking the session away, and
// is the foundation for resume (a shim that re-dials with the same
// persisted UUID picks up where the old socket left off).
//
// Default is 5 minutes (was 60s): on mobile the browser is backgrounded
// aggressively and the network flaps, so a 60s window routinely expired
// mid-commute and dropped a live session out from under the user. The
// PTY is owned by the surviving shim, so holding the slot longer costs
// only a Map entry. Override with POCKET_T_DETACH_GRACE_MS.
function resolveDetachGraceMs(): number {
  const raw = Number(process.env.POCKET_T_DETACH_GRACE_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 5 * 60_000;
}
const DETACH_GRACE_MS = resolveDetachGraceMs();

// Claude Code PreToolUse hooks land here. The daemon turns
// them into bubble events with kind:'approval' so the browser can show
// approve/deny buttons; the user's choice flows back through ws-v3.
const HOOK_PORT = Number(process.env.POCKET_T_HOOK_PORT ?? 7621);

// PreToolUse failsafe when no UI listener is connected. An explicit
// POCKET_T_HOOK_FAILSAFE always wins. Otherwise the default depends on
// exposure: a loopback-only daemon can safely fall through to Claude's
// own permission gate (approve), but an exposed daemon (tunnel/relay/
// non-loopback bind) must fail CLOSED (deny) so a remote peer can't
// auto-approve writes when no human is watching. Resolved per-run in
// runServer() where exposure is known.
function resolveHookFailsafeMode(exposed: boolean): 'approve' | 'deny' | 'passthrough' {
  const env = (process.env.POCKET_T_HOOK_FAILSAFE ?? '').toLowerCase();
  if (env === 'approve' || env === 'deny' || env === 'passthrough') return env;
  return exposed ? 'deny' : 'approve';
}

// startup time for uptime reporting via `pt-registry status`.
const STARTED_AT = Date.now();

// ─── Session registry ──────────────────────────────────────────────────────

interface PtSession {
  sessionId:     string;
  cwd:           string;
  pid:           number;
  rows:          number;
  cols:          number;
  shell:         string;
  registeredAt:  number;
  lastActiveAt:  number;
  bytesIn:       number;  // PTY → daemon (output bytes)
  bytesOut:      number;  // daemon → PTY (input bytes)
  exitCode?:     number;
  // True when the shell runs inside a tmux session. Such a session outlives
  // its shim: on rehydrate its liveness is decided by tmux, and killing it
  // means killing the tmux session (not just signalling an attached client).
  tmux:          boolean;
  // null when the session was rehydrated from state.json after a daemon
  // restart but its owning shim hasn't re-dialled yet — the PTY is alive
  // (shim survives daemon death) but we have no socket to it until the
  // shim's reconnect loop re-registers. Every write to it is guarded.
  socket:        net.Socket | null;
  // Headless terminal + serializer maintained per session so we can
  // hand a *snapshot of current screen state* to any browser that
  // subscribes mid-session. Without this, a browser attaching to a
  // long-running TUI (Claude Code, vim, htop, less) only sees output
  // emitted from its subscribe moment forward and the terminal looks
  // empty until the app does a redraw.
  headless?:    HeadlessTerminalType;
  serializer?:  SerializeAddonType;
  // Vendor adapter (Claude / Codex / OpenClaw / …) — emits typed
  // bubble events the browser renders as cards. Null when the
  // session is a plain shell.
  adapter?:     Adapter;
  vendor?:      string;
  // Adapter event history — replayed to newly-subscribing clients
  // so a browser attaching mid-session sees the conversation, not
  // just future turns. Capped at MAX_ADAPTER_EVENTS to bound memory.
  events:       BubbleEvent[];
  // every byte the PTY writes ends up in this asciinema
  // v2 .cast file, alongside a header that records geometry + env.
  // Replayable with `asciinema play` or `pt-registry replay`.
  recorder?:    Recorder;
  // when the pt socket drops without a FRAME_EXIT we
  // mark the session detached and start a grace timer. If a new
  // pt registers with the same sessionId before the timer fires,
  // we swap the socket and resume; otherwise we tear down.
  detached?:        boolean;
  detachedAt?:      number;
  detachTimer?:     NodeJS.Timeout;
  // outstanding PreToolUse approvals routed through the
  // HookServer. We track them per-session so the browser can resolve
  // them via ws-v3 EVENT (and so a reattaching browser sees pending
  // approvals on subscribe).
  pendingApprovals: Map<string, PendingApproval>;
}

const MAX_ADAPTER_EVENTS = 500;

interface PendingApproval {
  approvalId: string;
  toolName:   string;
  toolInput:  unknown;
  createdAt:  number;
}

const sessions = new Map<string, PtSession>();

// reverse lookup: which session a given approval belongs to.
// HookServer doesn't know — Claude Code sends the hook with whatever
// session header it has (often "unknown"). We keep our own map so the
// browser → daemon approval-decision frame can find both the session
// and the HookServer entry.
const approvalToSession = new Map<string, string>();

// ─── Registry persistence (survives daemon restart) ─────────────────────────
//
// We snapshot the session catalog to state.json so a `pt-registry serve`
// restart rehydrates it instead of starting blank. Only serialisable
// metadata is persisted — the live socket, headless terminal, adapter and
// recorder are all rebuilt at runtime (or re-attached when the surviving
// shim re-dials). Writes are debounced so a chatty session (STDOUT every
// few ms) doesn't hammer the disk; every state-changing event calls
// schedulePersist(), and we also flush synchronously on shutdown.

/** Serialize the current screen, bounded to SNAPSHOT_SCROLLBACK lines so
 *  the persisted state file stays small. Returns null when there's nothing
 *  to snapshot or the serializer refuses. */
function captureSnapshot(s: PtSession): string | null {
  if (!s.serializer) return null;
  try {
    const vt = s.serializer.serialize({ scrollback: SNAPSHOT_SCROLLBACK });
    return vt.length > 0 ? vt : null;
  } catch {
    return null;
  }
}

function toPersisted(s: PtSession): PersistedSession {
  return {
    sessionId:    s.sessionId,
    cwd:          s.cwd,
    pid:          s.pid,
    rows:         s.rows,
    cols:         s.cols,
    shell:        s.shell,
    vendor:       s.vendor ?? null,
    registeredAt: s.registeredAt,
    lastActiveAt: s.lastActiveAt,
    detached:     s.detached ?? false,
    detachedAt:   s.detachedAt ?? null,
    exitCode:     s.exitCode ?? null,
    tmux:         s.tmux ?? false,
    // Screen + recent bubbles so a browser re-attaching after a restart is
    // painted the last frame and the recent conversation, not a blank.
    snapshot:     captureSnapshot(s),
    events:       s.events.slice(-MAX_PERSISTED_EVENTS) as unknown as PersistedEvent[],
  };
}

function persistNow(): void {
  try {
    writeStateAtomic(STATE_FILE, Array.from(sessions.values()).map(toPersisted));
  } catch (e) {
    // Persistence is best-effort — a full disk or permission error must
    // never crash the registry. Log once and keep serving; the worst case
    // is a stale catalog after the next restart.
    console.warn('[pt-registry] state persist failed:', (e as Error).message);
  }
}

let persistTimer: NodeJS.Timeout | null = null;
function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 500);
  // Don't let a pending persist keep the process alive on shutdown.
  persistTimer.unref?.();
}

/**
 * Build a detached PtSession shell (no live socket yet) from persisted or
 * enumerated metadata, register it in the catalog, and start a grace timer.
 * The socket is filled in when a shim re-dials (REGISTER resume path); for a
 * tmux-backed session whose shim is gone, `reattach` spawns a headless shim
 * that attaches to the surviving tmux session and pipes it back to the daemon.
 */
function addRehydratedSession(meta: {
  sessionId: string; cwd: string; pid: number; rows: number; cols: number;
  shell: string; vendor?: string; registeredAt: number; lastActiveAt: number;
  tmux: boolean; snapshot?: string | null; events?: BubbleEvent[];
}, reattach: boolean): void {
  const cols = meta.cols || 80;
  const rows = meta.rows || 24;
  let headless: HeadlessTerminalType | undefined;
  let serializer: SerializeAddonType | undefined;
  try {
    headless = new HeadlessTerminal({ cols, rows, scrollback: 2000, allowProposedApi: true });
    serializer = new SerializeAddon();
    headless.loadAddon(serializer);
    // Replay the persisted screen into the fresh terminal. A serialized VT
    // snapshot is written back verbatim to reconstruct the screen, so a
    // browser that subscribes before any new output still gets a SNAPSHOT_VT
    // painted with the last frame the daemon saw.
    if (meta.snapshot) headless.write(meta.snapshot);
  } catch { /* headless optional — snapshots just start empty */ }
  const session: PtSession = {
    sessionId:    meta.sessionId,
    cwd:          meta.cwd,
    pid:          meta.pid,
    rows,
    cols,
    shell:        meta.shell,
    registeredAt: meta.registeredAt,
    lastActiveAt: meta.lastActiveAt,
    bytesIn:      0,
    bytesOut:     0,
    socket:       null,     // no live shim link until one (re-)registers
    headless,
    serializer,
    vendor:       meta.vendor,
    // Recent bubbles + cost carried across the restart, replayed to a
    // browser that subscribes with the Events flag.
    events:       meta.events ? meta.events.slice(-MAX_ADAPTER_EVENTS) : [],
    tmux:         meta.tmux,
    detached:     true,     // awaiting a shim (re)connect
    detachedAt:   Date.now(),
    pendingApprovals: new Map(),
  };
  session.detachTimer = setTimeout(() => {
    const still = sessions.get(session.sessionId);
    if (still && still.detached) {
      console.log(`[pt-registry] rehydrate: ${session.sessionId} grace expired without shim reconnect — closing`);
      finalizeSession(still);
    }
  }, DETACH_GRACE_MS);
  session.detachTimer.unref?.();
  sessions.set(session.sessionId, session);
  if (reattach) reattachTmuxSession(session.sessionId, session.cwd);
}

/**
 * Rehydrate the session catalog on startup from two sources that survive a
 * daemon restart:
 *
 *   1. tmux — the pocket-t tmux server owns each tmux-backed session's PTY
 *      and shell independently of any shim, so a session whose tmux session
 *      is still listed is LIVE even if the original shim pid is long gone.
 *      A headless shim is spawned to re-pipe it so a re-attaching browser
 *      can drive it immediately.
 *   2. state.json — the persisted metadata store, which carries cwd, vendor,
 *      timestamps and geometry for a nicer resume, plus the non-tmux sessions
 *      (direct forkpty) whose liveness still follows the shim pid.
 *
 * Sessions that clean-exited, or whose backing (tmux session / shim pid) is
 * gone, are dropped.
 */
function rehydrateSessions(): void {
  const liveTmux = new Set(listTmuxSessions());
  const prior = readState(STATE_FILE);
  let restored = 0;

  // 1) Metadata-backed rehydrate from state.json.
  for (const ps of prior?.sessions ?? []) {
    // Clean-exited sessions are truly finished — don't resurrect them.
    if (typeof ps.exitCode === 'number' && ps.exitCode !== null) continue;
    const isTmux = Boolean(ps.tmux);
    const alive = isTmux
      ? liveTmux.has(tmuxSessionName(ps.sessionId))
      : pidAlive(ps.pid);
    if (!alive) {
      console.log(`[pt-registry] rehydrate: dropping ${ps.sessionId} — ${isTmux ? 'tmux session gone' : `shim pid ${ps.pid} no longer alive`}`);
      continue;
    }
    // A tmux-backed session whose shim survived our restart will re-dial on
    // its own; only spawn a headless re-attach when that shim is truly gone.
    const reattach = isTmux && !pidAlive(ps.pid);
    addRehydratedSession({
      sessionId: ps.sessionId, cwd: ps.cwd, pid: ps.pid, rows: ps.rows, cols: ps.cols,
      shell: ps.shell, vendor: ps.vendor ?? undefined,
      registeredAt: ps.registeredAt, lastActiveAt: ps.lastActiveAt, tmux: isTmux,
      snapshot: ps.snapshot ?? null,
      events: Array.isArray(ps.events) ? ps.events as unknown as BubbleEvent[] : undefined,
    }, reattach);
    restored++;
  }

  // 2) Enumerate any live pocket-t tmux session not covered by state.json
  //    (e.g. state.json lost/corrupt but the tmux server kept running). We
  //    still surface these as live sessions and re-pipe them.
  for (const name of liveTmux) {
    const id = sessionIdFromTmuxName(name);
    if (!id || sessions.has(id)) continue;
    console.log(`[pt-registry] rehydrate: adopting orphan tmux session ${name}`);
    addRehydratedSession({
      sessionId: id, cwd: os.homedir(), pid: 0, rows: 24, cols: 80,
      shell: process.env.SHELL ?? '/bin/zsh',
      registeredAt: Date.now(), lastActiveAt: Date.now(), tmux: true,
    }, true);
    restored++;
  }

  if (restored > 0) {
    console.log(`[pt-registry] rehydrated ${restored} session(s) — awaiting shim reconnect (grace ${DETACH_GRACE_MS / 1000}s)`);
    persistNow();
  }
}

function publicView(s: PtSession) {
  return {
    sessionId:    s.sessionId,
    cwd:          s.cwd,
    pid:          s.pid,
    rows:         s.rows,
    cols:         s.cols,
    shell:        s.shell,
    registeredAt: s.registeredAt,
    lastActiveAt: s.lastActiveAt,
    bytesIn:      s.bytesIn,
    bytesOut:     s.bytesOut,
    exitCode:     s.exitCode ?? null,
    vendor:       s.vendor ?? null,
    detached:     s.detached ?? false,
    tmux:         s.tmux ?? false,
    pendingApprovals: s.pendingApprovals.size,
  };
}

// Module-level HookServer instance — created in runServer() and
// referenced by the ctl + ws-v3 approval handlers.
let hookServer: HookServer | null = null;

// Web Push sender — null when no VAPID key pair is configured. Used to
// notify a phone when an approval needs a human but no browser is watching.
let pushService: PushService | null = null;

// ─── Frame parser ──────────────────────────────────────────────────────────

class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  append(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
  }

  *frames(): Generator<{ type: number; payload: Buffer }> {
    while (this.buf.length >= 5) {
      const type = this.buf[0]!;
      const len = this.buf.readUInt32BE(1);
      if (this.buf.length < 5 + len) return;
      const payload = Buffer.from(this.buf.subarray(5, 5 + len));
      yield { type, payload };
      this.buf = this.buf.subarray(5 + len);
    }
  }
}

function writeFrame(sock: net.Socket | null, type: number, payload: Buffer | Uint8Array = Buffer.alloc(0)): void {
  if (!sock || sock.destroyed || !sock.writable) return;
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(payload.length, 1);
  sock.write(header);
  if (payload.length > 0) sock.write(Buffer.from(payload));
}

// ─── pt socket server ──────────────────────────────────────────────────────

function startPtServer(): net.Server {
  const server = net.createServer((sock) => {
    const parser = new FrameParser();
    let boundSessionId: string | null = null;
    let helloOk = false;

    sock.on('data', (chunk: Buffer) => {
      parser.append(chunk);
      for (const { type, payload } of parser.frames()) {
        if (!helloOk && type !== FRAME_HELLO) {
          console.warn(`[pt-registry] expected HELLO first, got 0x${type.toString(16)}`);
          sock.destroy();
          return;
        }
        switch (type) {
          case FRAME_HELLO: {
            const v = payload[0] ?? 0;
            if (v !== PROTOCOL_VERSION) {
              console.warn(`[pt-registry] protocol mismatch: pt=${v}, daemon=${PROTOCOL_VERSION}`);
              sock.destroy();
              return;
            }
            helloOk = true;
            writeFrame(sock, FRAME_ACK);
            break;
          }
          case FRAME_REGISTER: {
            try {
              const meta = JSON.parse(payload.toString('utf8'));
              const sessionId = String(meta.sessionId);
              const cols = Number(meta.cols);
              const rows = Number(meta.rows);

              // resume path. If a session with this id is
              // currently in the detach-grace window, swap the new
              // socket in and resurrect it instead of creating a
              // fresh one. Bubble history, headless terminal, vendor
              // adapter and recorder all carry over.
              const existing = sessions.get(sessionId);
              if (existing && existing.detached) {
                existing.socket = sock;
                existing.detached = false;
                existing.detachedAt = undefined;
                if (existing.detachTimer) {
                  clearTimeout(existing.detachTimer);
                  existing.detachTimer = undefined;
                }
                // Adopt the re-dialling shim's identity: its pid (the old one
                // may be a dead terminal or an unknown 0 for an adopted tmux
                // session) and its cwd, and confirm the tmux backing.
                if (Number.isFinite(meta.pid)) existing.pid = Number(meta.pid);
                if (typeof meta.cwd === 'string' && meta.cwd) existing.cwd = meta.cwd;
                if (meta.tmux !== undefined) existing.tmux = Boolean(meta.tmux);
                existing.lastActiveAt = Date.now();
                // Geometry may have changed across the detach.
                if (rows && cols && (rows !== existing.rows || cols !== existing.cols)) {
                  existing.rows = rows;
                  existing.cols = cols;
                  try { existing.headless?.resize(cols, rows); } catch { /* noop */ }
                }
                boundSessionId = sessionId;
                writeFrame(sock, FRAME_ACK);
                console.log(`[pt-registry] ↺ ${sessionId} resumed (${sessions.size} active)`);
                // A session rehydrated after a daemon restart carries its
                // vendor label but lost the live adapter (the JSONL-tailing
                // side-channel). Re-bind it so bubble events flow again.
                if (!existing.adapter) void tryBindAdapter(existing, 0);
                broadcastEvent(sessionId, { kind: 'sessionUpdated', session: publicView(existing) });
                schedulePersist();
                break;
              }

              const headless = new HeadlessTerminal({
                cols,
                rows,
                scrollback:       2000,
                allowProposedApi: true,
              });
              const serializer = new SerializeAddon();
              headless.loadAddon(serializer);
              const session: PtSession = {
                sessionId,
                cwd:          String(meta.cwd),
                pid:          Number(meta.pid),
                rows,
                cols,
                shell:        String(meta.shell),
                registeredAt: Date.now(),
                lastActiveAt: Date.now(),
                bytesIn:      0,
                bytesOut:     0,
                socket:       sock,
                headless,
                serializer,
                events:       [],
                tmux:         Boolean(meta.tmux),
                pendingApprovals: new Map(),
              };
              // asciinema recorder. Opt-in only (POCKET_T_RECORD): the
              // .cast files record every keystroke, including secrets.
              // Best-effort: never lets a filesystem hiccup kill a session.
              if (RECORDING_ENABLED) {
                try {
                  session.recorder = new Recorder({
                    dir:       RECORDINGS_DIR,
                    sessionId: session.sessionId,
                    cols:      session.cols,
                    rows:      session.rows,
                    shell:     session.shell,
                    cwd:       session.cwd,
                  });
                } catch (e) {
                  console.warn(`[pt-registry] recorder init failed for ${session.sessionId}:`, (e as Error).message);
                }
              }
              sessions.set(session.sessionId, session);
              boundSessionId = session.sessionId;
              writeFrame(sock, FRAME_ACK);
              console.log(`[pt-registry] + ${session.sessionId} pid=${session.pid} cwd=${session.cwd} ${session.rows}x${session.cols} (${sessions.size} active)`);
              broadcastEvent(session.sessionId, { kind: 'sessionAdded', session: publicView(session) });
              schedulePersist();
              // Adapter detection runs async — agents take a moment to
              // create their transcript / show up in the process tree.
              // We retry a few times so we catch slow-starting Claude
              // sessions without blocking REGISTER acknowledgement.
              void tryBindAdapter(session, 0);
            } catch (e) {
              console.warn('[pt-registry] REGISTER payload parse failed:', e);
              sock.destroy();
              return;
            }
            break;
          }
          case FRAME_STDOUT: {
            if (boundSessionId) {
              const s = sessions.get(boundSessionId);
              if (s) {
                s.bytesIn += payload.length;
                s.lastActiveAt = Date.now();
                // Feed the per-session headless terminal so it tracks
                // VT state (cursor, alt-screen, colors, scrollback) —
                // that's what we serialize and send as SNAPSHOT_VT to
                // any browser that subscribes later.
                s.headless?.write(payload);
                // persist to the asciinema .cast file.
                s.recorder?.writeOutput(payload);
              }
              // Fan out to subscribed browser viewers.
              broadcastStdout(boundSessionId, payload);
            }
            break;
          }
          case FRAME_RESIZE: {
            if (payload.length >= 4 && boundSessionId) {
              const s = sessions.get(boundSessionId);
              if (s) {
                s.rows = payload.readUInt16BE(0);
                s.cols = payload.readUInt16BE(2);
                s.lastActiveAt = Date.now();
                try { s.headless?.resize(s.cols, s.rows); } catch { /* xterm can refuse 0 dims */ }
                s.recorder?.writeResize(s.cols, s.rows);
              }
            }
            break;
          }
          case FRAME_EXIT: {
            const code = payload.length >= 4 ? payload.readInt32BE(0) : 0;
            if (boundSessionId) {
              const s = sessions.get(boundSessionId);
              if (s) {
                s.exitCode = code;
                // a clean FRAME_EXIT means the shell really
                // exited. Skip the detach grace and tear down on socket
                // close (handled in cleanup below).
                s.detached = false;
                schedulePersist();
                console.log(`[pt-registry] - ${s.sessionId} exit=${code} (${sessions.size - 1} active)`);
              }
            }
            break;
          }
          default:
            console.warn(`[pt-registry] unknown frame type 0x${type.toString(16)}`);
        }
      }
    });

    const cleanup = () => {
      if (!boundSessionId) return;
      const s = sessions.get(boundSessionId);
      if (!s) return;

      // if the shell exited cleanly we tear down now.
      // Otherwise hold the session in detach-grace so a quick reconnect
      // (pt restart, machine sleep, transient socket error) doesn't
      // lose the bubble history or the user's place in the conversation.
      const cleanExit = typeof s.exitCode === 'number';
      if (cleanExit) {
        finalizeSession(s);
        return;
      }
      // Already detached (e.g. duplicate close events) — nothing to do.
      if (s.detached) return;

      s.detached   = true;
      s.detachedAt = Date.now();
      s.socket     = null;   // the dropped socket is dead; a re-dial installs a fresh one
      console.log(`[pt-registry] ⌛ ${s.sessionId} detached — grace ${DETACH_GRACE_MS / 1000}s`);
      broadcastEvent(s.sessionId, { kind: 'sessionUpdated', session: publicView(s) });
      schedulePersist();
      // A tmux-backed session whose shim really died (terminal quit) keeps
      // running in the tmux server. If its tmux session is still alive,
      // re-pipe it with a headless shim so it stays drivable from a browser
      // instead of only showing a "detached" badge. A transient socket blip
      // where the same shim is still alive is left to that shim's own
      // reconnect loop, so we don't spawn a duplicate client.
      if (s.tmux && !pidAlive(s.pid) && tmuxSessionAlive(s.sessionId)) {
        reattachTmuxSession(s.sessionId, s.cwd);
      }
      s.detachTimer = setTimeout(() => {
        const still = sessions.get(s.sessionId);
        if (still && still.detached) {
          console.log(`[pt-registry] ⌛ ${s.sessionId} grace expired — closing`);
          finalizeSession(still);
        }
      }, DETACH_GRACE_MS);
    };
    sock.on('end',   cleanup);
    sock.on('close', cleanup);
    sock.on('error', (e) => {
      console.warn('[pt-registry] pt socket error:', e.message);
    });
  });

  return server;
}

/** Tear a session down for real — happens on clean exit or after the
 *  detach grace expires. Resolves any outstanding approvals as 'deny'
 *  so the agent doesn't hang forever waiting on a UI that vanished. */
function finalizeSession(s: PtSession): void {
  if (s.detachTimer) { clearTimeout(s.detachTimer); s.detachTimer = undefined; }
  try { s.headless?.dispose(); } catch { /* noop */ }
  try { s.adapter?.stop(); }    catch { /* noop */ }
  try { s.recorder?.close(s.exitCode); } catch { /* noop */ }
  for (const [aid] of s.pendingApprovals) {
    approvalToSession.delete(aid);
    try { hookServer?.resolveApproval(aid, 'deny'); } catch { /* noop */ }
  }
  s.pendingApprovals.clear();
  sessions.delete(s.sessionId);
  broadcastEvent(s.sessionId, { kind: 'sessionRemoved', sessionId: s.sessionId });
  schedulePersist();
}

// ─── ctl socket server ─────────────────────────────────────────────────────
//
// Simple JSON-per-line protocol. Each client connection sends one JSON
// command, gets one JSON response, then closes. Commands:
//   {"cmd":"list"}                                       → {sessions:[…]}
//   {"cmd":"input","sessionId":"…","text":"echo hi\n"}   → {ok:true}
//   {"cmd":"kill","sessionId":"…","signal":15}           → {ok:true}

function startCtlServer(): net.Server {
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);

      let req: any;
      try {
        req = JSON.parse(line);
      } catch {
        sock.write(JSON.stringify({ ok: false, error: 'invalid json' }) + '\n');
        sock.end();
        return;
      }

      let resp: any;
      switch (req.cmd) {
        case 'list': {
          resp = { ok: true, sessions: Array.from(sessions.values()).map(publicView) };
          break;
        }
        case 'input': {
          const s = sessions.get(req.sessionId);
          if (!s) { resp = { ok: false, error: 'no such session' }; break; }
          if (s.detached) { resp = { ok: false, error: 'session detached' }; break; }
          const text = String(req.text ?? '');
          const bytes = Buffer.from(text, 'utf8');
          writeFrame(s.socket, FRAME_INPUT, bytes);
          s.bytesOut += bytes.length;
          s.lastActiveAt = Date.now();
          resp = { ok: true, bytes: bytes.length };
          break;
        }
        case 'kill': {
          const s = sessions.get(req.sessionId);
          if (!s) { resp = { ok: false, error: 'no such session' }; break; }
          // A tmux-backed session can be killed even while detached (no live
          // shim), because the shell lives in the tmux server, not a client.
          if (s.tmux) {
            killTmuxSession(s.sessionId);
            resp = { ok: true };
            break;
          }
          if (s.detached) { resp = { ok: false, error: 'session detached' }; break; }
          const sig = Number(req.signal ?? 15);
          writeFrame(s.socket, FRAME_KILL, Buffer.from([sig & 0xff]));
          resp = { ok: true };
          break;
        }
        case 'status': {
          // single-shot health summary for tooling
          // (menu bar widget, monitoring scripts, etc).
          let recordingsCount = 0;
          let recordingsBytes = 0;
          try {
            for (const f of fs.readdirSync(RECORDINGS_DIR)) {
              if (!f.endsWith('.cast')) continue;
              recordingsCount++;
              try { recordingsBytes += fs.statSync(path.join(RECORDINGS_DIR, f)).size; } catch { /* race */ }
            }
          } catch { /* dir not yet created */ }
          let totalIn = 0, totalOut = 0, pendingAppr = 0;
          for (const s of sessions.values()) {
            totalIn  += s.bytesIn;
            totalOut += s.bytesOut;
            pendingAppr += s.pendingApprovals.size;
          }
          resp = {
            ok: true,
            startedAt:    STARTED_AT,
            uptimeMs:     Date.now() - STARTED_AT,
            pid:          process.pid,
            sessions:     sessions.size,
            detached:     Array.from(sessions.values()).filter(s => s.detached).length,
            browserClients: browserClients.size,
            relayLinks:   Array.from(browserClients).filter(c => c === RELAY_CLIENT).length,
            bytesIn:      totalIn,
            bytesOut:     totalOut,
            pendingApprovals: pendingAppr,
            hookServerPort:   HOOK_PORT,
            recordingsDir:    RECORDINGS_DIR,
            recordingsCount,
            recordingsBytes,
          };
          break;
        }
        case 'approve': {
          // fulfil an approval from the local CLI. The
          // browser path goes through ws-v3 (handleIncomingFrame's
          // EVENT branch), but a CLI command is useful when the
          // browser isn't open and the user wants to unblock Claude
          // from a fresh terminal.
          const approvalId = String(req.approvalId ?? '');
          const decision   = req.decision === 'approve' ? 'approve' : 'deny';
          const ok = resolveApprovalLocally(approvalId, decision);
          resp = ok ? { ok: true } : { ok: false, error: 'no such approval' };
          break;
        }
        case 'pending': {
          // list outstanding approvals (used by the menu
          // bar widget to badge a count, and by `pt-registry pending`).
          const out: unknown[] = [];
          for (const s of sessions.values()) {
            for (const p of s.pendingApprovals.values()) {
              out.push({
                sessionId:  s.sessionId,
                approvalId: p.approvalId,
                toolName:   p.toolName,
                toolInput:  p.toolInput,
                createdAt:  p.createdAt,
              });
            }
          }
          resp = { ok: true, pending: out };
          break;
        }
        case 'recordings': {
          // list cast files for the replay CLI / web UI.
          const out: unknown[] = [];
          try {
            for (const f of fs.readdirSync(RECORDINGS_DIR)) {
              if (!f.endsWith('.cast')) continue;
              try {
                const full = path.join(RECORDINGS_DIR, f);
                const st = fs.statSync(full);
                out.push({
                  sessionId: f.replace(/\.cast$/, ''),
                  path:      full,
                  size:      st.size,
                  mtime:     st.mtimeMs,
                });
              } catch { /* race */ }
            }
          } catch { /* no dir */ }
          out.sort((a: any, b: any) => b.mtime - a.mtime);
          resp = { ok: true, recordings: out };
          break;
        }
        default:
          resp = { ok: false, error: 'unknown cmd' };
      }
      sock.write(JSON.stringify(resp) + '\n');
      sock.end();
    });
    sock.on('error', () => { /* ignore — clients come and go */ });
  });
  return server;
}

// central approval resolver. Used by the ctl 'approve'
// command, the ws-v3 EVENT inbound path, and the finalizeSession
// teardown (which denies anything still hanging).
function resolveApprovalLocally(approvalId: string, decision: 'approve' | 'deny'): boolean {
  const sid = approvalToSession.get(approvalId);
  if (!sid) return false;
  const s = sessions.get(sid);
  if (s) s.pendingApprovals.delete(approvalId);
  approvalToSession.delete(approvalId);
  const ok = hookServer?.resolveApproval(approvalId, decision) ?? false;
  // Broadcast a follow-up bubble so all attached browsers update
  // their UI together (the approving tab gets it too — idempotent).
  broadcastEvent(sid, {
    kind:      'bubble',
    sessionId: sid,
    event: {
      kind:       'approval',
      role:       'assistant',
      approvalId,
      text:       decision === 'approve' ? '✓ approved' : '✗ denied',
      timestamp:  Date.now(),
    },
  });
  return ok;
}

// Reference to the relay BrowserClient if we connected to one — used
// by the status CLI to report relay link state. Set in connectToRelay.
let RELAY_CLIENT: BrowserClient | null = null;

/**
 * Phone-initiated "+ New session" — daemon opens a Terminal.app window
 * on the Mac via osascript. The user's Terminal profile is already set
 * up to launch /usr/local/bin/pt as its shell (the install.sh step
 * everyone follows), so the new window's pt registers a session via
 * the existing unix socket protocol. Within ~1 second the new session
 * appears in every browser sidebar (phone and Mac alike), and the
 * Terminal.app window is also visible on the Mac so the user can
 * continue locally when they're back at the machine.
 *
 * This was the user's explicit request: "would be nice to continue
 * when I am back on my machine."
 *
 * Best-effort: if osascript fails (macOS Automation permission not
 * yet granted, or Terminal.app missing on this machine), we log and
 * move on. The first run pops a system prompt — accept it once and
 * subsequent spawns are seamless.
 */
function spawnPtSession(opts: { cwd?: string } = {}): void {
  const ptBin = process.env.POCKET_T_PT_BIN ?? '/usr/local/bin/pt';
  // The 'do script' string runs in the new Terminal.app window. We
  // explicitly `exec` pt so we don't depend on the user's profile
  // already having pt as its shell — works on every profile.
  //
  // `cd` first if the caller supplied a working directory (so the
  // new window opens IN that folder, matching the user's expectation
  // when they tap + while looking at a project session).
  const cwdPrefix = opts.cwd ? `cd ${shellEscape(opts.cwd)} && ` : '';
  const cmd = `${cwdPrefix}exec ${ptBin}`;
  const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "Terminal"
  activate
  do script "${escaped}"
end tell`;
  try {
    spawnChild('osascript', ['-e', script], {
      detached: true,
      stdio:    'ignore',
    }).unref();
    console.log(`[pt-registry] spawned Terminal.app window (cwd=${opts.cwd ?? '~'})`);
  } catch (e) {
    console.warn(`[pt-registry] osascript spawn failed: ${(e as Error).message}`);
  }
}

/** Minimal POSIX shell escape — wrap arg in single quotes, escape
 *  any internal single quotes. Plenty for the cwd-prefix use above. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Re-pipe a surviving tmux-backed session whose owning shim is gone (the
 * user quit the terminal, or the daemon restarted while the shell kept
 * running in tmux). We spawn a HEADLESS `pt` pinned to the same session id:
 * it becomes a tmux client attached to `pocket-t-<id>`, tees the PTY back
 * to us, and re-registers over the Unix socket — the REGISTER resume path
 * then swaps it into the existing detached session, so a browser can drive
 * it again. The daemon still never holds a PTY fd itself (Model A).
 *
 * Best-effort: if the `pt` binary isn't installed we skip it — the session
 * stays visible as a surviving tmux session and re-pipes the moment any
 * shim (a reopened terminal, or an installed `pt`) attaches to it.
 */
function reattachTmuxSession(sessionId: string, cwd?: string): void {
  const ptBin = process.env.POCKET_T_PT_BIN ?? '/usr/local/bin/pt';
  if (!fs.existsSync(ptBin)) return;
  try {
    spawnChild(ptBin, [], {
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      env: { ...process.env, POCKET_T_HEADLESS: '1', POCKET_T_SESSION_ID: sessionId },
      detached: true,
      stdio: 'ignore',
    }).unref();
    console.log(`[pt-registry] re-piping ${tmuxSessionName(sessionId)} via headless pt`);
  } catch (e) {
    console.warn(`[pt-registry] headless reattach spawn failed: ${(e as Error).message}`);
  }
}

// ─── Browser server (HTTP + ws-v3) ─────────────────────────────────────────
//
// Any browser on the same Mac can open http://127.0.0.1:7700/ and get the
// pocket-t web UI. The page connects over WebSocket to /ws and speaks
// ws-v3 binary frames. SUBSCRIBE attaches to a session; STDOUT frames
// stream that session's PTY output; INPUT_TEXT writes user keystrokes
// back through the daemon → pt → PTY master path.
//
// Default bind is 127.0.0.1 — local-Mac-only access. For phone-from-
// anywhere we ALSO dial out to a Cloudflare Quick Tunnel (see tunnel.ts)
// or a self-hosted ws-v3 hub (--relay), so any browser on any network
// can connect without an inbound port on the Mac.

interface BrowserClient {
  ws:            WebSocket;
  subscriptions: Map<string, number>; // sessionId → flag bitmask
  // Has this client proved it holds the per-daemon bearer token? Clients
  // that arrive over the local /ws server are pre-authed by verifyClient
  // (token + Origin checked at the HTTP upgrade). Clients that arrive via
  // the outbound relay have NO HTTP handshake to gate them, so they start
  // false and must present the token in their HELLO frame before any
  // privileged frame (SUBSCRIBE / INPUT / KILL / spawnSession) is honoured.
  authed:        boolean;
}

const browserClients = new Set<BrowserClient>();

function broadcastStdout(sessionId: string, bytes: Buffer): void {
  if (browserClients.size === 0) return;
  let cachedFrame: Uint8Array | null = null;
  for (const client of browserClients) {
    if (!client.authed) continue;   // defense-in-depth: no PTY bytes to unauthed relay peers
    const flags = client.subscriptions.get(sessionId);
    if (!flags || !(flags & WsV3SubscribeFlags.Stdout)) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (!cachedFrame) {
      cachedFrame = encodeWsV3Frame({
        type:      WsV3MessageType.STDOUT,
        sessionId,
        payload:   new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      });
    }
    client.ws.send(cachedFrame);
  }
}

/**
 * Try to detect an agent adapter for this session. Adapters bind to
 * side-channels (Claude's JSONL transcript, etc.) that are created
 * lazily — a freshly-spawned shell that hasn't yet run `claude` won't
 * match. We retry a small number of times so a session that gets
 * `claude` typed into it shortly after registration gets adapted too.
 */
async function tryBindAdapter(session: PtSession, attempt: number): Promise<void> {
  if (!sessions.has(session.sessionId) || session.adapter) return;
  const adapter = await detectAdapter({
    sessionId: session.sessionId,
    cwd:       session.cwd,
    pid:       session.pid,
  });
  if (!adapter) {
    if (attempt < 30) {
      // ~30s of retries at 1s each — enough for the user to start an
      // agent CLI after opening a fresh shell.
      setTimeout(() => { void tryBindAdapter(session, attempt + 1); }, 1000);
    }
    return;
  }
  const started = await adapter.start();
  if (!started) {
    if (attempt < 30) {
      setTimeout(() => { void tryBindAdapter(session, attempt + 1); }, 1000);
    }
    return;
  }
  session.adapter = adapter;
  session.vendor  = adapter.vendor;
  schedulePersist();  // persist the vendor label so a restart rehydrates it
  console.log(`[pt-registry] adapter bound: ${session.sessionId} → ${adapter.vendor}`);
  // Tell every viewer this session now has a vendor so the bubble
  // toggle becomes meaningful.
  broadcastEvent(session.sessionId, { kind: 'sessionUpdated', session: publicView(session) });

  adapter.on('event', (ev: BubbleEvent) => {
    // Record history (capped) so a later-arriving browser can replay
    // the conversation on subscribe.
    session.events.push(ev);
    if (session.events.length > MAX_ADAPTER_EVENTS) {
      session.events.splice(0, session.events.length - MAX_ADAPTER_EVENTS);
    }
    broadcastEvent(session.sessionId, { kind: 'bubble', sessionId: session.sessionId, event: ev });
  });
  adapter.on('error', (err) => {
    console.warn(`[pt-registry] adapter[${session.sessionId}] error:`, err.message);
  });
}

function broadcastEvent(sessionId: string, event: unknown): void {
  if (browserClients.size === 0) return;
  const payload = new TextEncoder().encode(JSON.stringify(event));
  let cachedFrame: Uint8Array | null = null;
  const kind = (event && typeof event === 'object') ? (event as { kind?: string }).kind : undefined;
  // Session lifecycle events go to EVERY connected client whether or
  // not they've subscribed yet — that's how their sidebars learn
  // what's available. Bubble / cost / per-session events respect the
  // Events subscription flag.
  const sessionLifecycle =
       kind === 'sessionAdded'
    || kind === 'sessionRemoved'
    || kind === 'sessionUpdated';

  for (const client of browserClients) {
    // Never leak session metadata to a not-yet-authenticated relay peer,
    // even for unsubscribed lifecycle events — this matches the catalog
    // gating in attachWsAsBrowserClient so pre-auth relay clients see nothing.
    if (!client.authed) continue;
    const flags = client.subscriptions.get(sessionId);
    const wantsEvents = (flags ?? 0) & WsV3SubscribeFlags.Events;
    if (!sessionLifecycle && !wantsEvents) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (!cachedFrame) {
      cachedFrame = encodeWsV3Frame({
        type:      WsV3MessageType.EVENT,
        sessionId,
        payload,
      });
    }
    client.ws.send(cachedFrame);
  }
}

/**
 * Is any authenticated browser currently watching this session's events?
 * "Watching" = an open ws client subscribed to the session with the Events
 * flag — the clients that would receive an approval bubble live. When none
 * exist, an approval would go unseen, so we fall back to a Web Push.
 */
function sessionHasEventWatcher(sessionId: string): boolean {
  for (const client of browserClients) {
    if (!client.authed) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const flags = client.subscriptions.get(sessionId);
    if (flags && (flags & WsV3SubscribeFlags.Events)) return true;
  }
  return false;
}

function sendWelcomeAndCatalog(ws: WebSocket): void {
  ws.send(encodeWsV3Frame({ type: WsV3MessageType.WELCOME }));
  // Catalog: tell the new client about every session we know about so
  // its sidebar populates immediately, even before any subscribe.
  for (const session of sessions.values()) {
    ws.send(encodeWsV3Frame({
      type:      WsV3MessageType.EVENT,
      sessionId: session.sessionId,
      payload:   new TextEncoder().encode(JSON.stringify({
        kind:    'sessionAdded',
        session: publicView(session),
      })),
    }));
  }
}

/**
 * Process one ws-v3 frame arriving from a browser-side peer. Used by
 * both the local WS server and the outbound relay connection
 * — both look like "a browser sent us a frame" from the
 * daemon's perspective.
 */
function handleIncomingFrame(client: BrowserClient, frame: { type: WsV3MessageType; sessionId: string; payload: Uint8Array }): void {
  // Relay auth gate. A relay-attached client (client.authed === false)
  // reached us with NO HTTP handshake, so verifyClient never ran. Until
  // it proves the token in its HELLO frame we honour only HELLO (which
  // carries the token) and PING (keepalive). Every privileged frame —
  // SUBSCRIBE, INPUT_TEXT/KEY, RESIZE, KILL, and EVENT (spawnSession /
  // approvalDecision) — is dropped, so an unauthenticated hub peer can
  // never inject keystrokes or kill sessions.
  if (!client.authed
      && frame.type !== WsV3MessageType.HELLO
      && frame.type !== WsV3MessageType.PING) {
    return;
  }

  switch (frame.type) {
    case WsV3MessageType.HELLO: {
      // Browser-side HELLO arrives whenever a fresh tab connects. Through
      // the local WS this happens after we already sent the catalog on
      // connect; through the relay (hub) it's the FIRST signal we get
      // that a downstream browser is alive, since the hub is a dumb pipe.
      //
      // HELLO payload = [protocolVersion, ...tokenUtf8]. On the relay
      // path the token here is the ONLY authentication, so a not-yet-authed
      // client must present a valid token or be dropped. Pre-authed
      // (local /ws) clients skip the check — they were gated at the HTTP
      // upgrade — but sending the token is harmless.
      if (!client.authed) {
        const token = frame.payload.length > 1
          ? new TextDecoder().decode(frame.payload.subarray(1))
          : '';
        if (!tokenMatches(token)) {
          console.warn('[pt-registry] relay client HELLO missing/invalid token — dropping connection');
          try { client.ws.close(1008, 'Unauthorized'); } catch { /* noop */ }
          return;
        }
        client.authed = true;
        console.log('[pt-registry] relay client authenticated via HELLO token');
      }
      // Re-send the catalog so the browser populates its sidebar.
      sendWelcomeAndCatalog(client.ws);
      break;
    }

    case WsV3MessageType.SUBSCRIBE: {
      const sub = decodeSubscribePayload(frame.payload);
      if (!sub) return;
      client.subscriptions.set(frame.sessionId, sub.flags);
      const s = sessions.get(frame.sessionId);

      // Snapshot: paint current screen state for mid-session attaches.
      if (s?.serializer && (sub.flags & WsV3SubscribeFlags.Snapshots)) {
        const vt = s.serializer.serialize();
        if (vt.length > 0) {
          client.ws.send(encodeWsV3Frame({
            type:      WsV3MessageType.SNAPSHOT_VT,
            sessionId: frame.sessionId,
            payload:   new TextEncoder().encode(vt),
          }));
        }
      }

      // Events: replay adapter-event history so the bubble view shows
      // the full conversation when the browser attaches mid-session.
      // Without this, switching sessions would show an empty bubble
      // list until the next agent turn arrives.
      if (s && (sub.flags & WsV3SubscribeFlags.Events)) {
        for (const ev of s.events) {
          client.ws.send(encodeWsV3Frame({
            type:      WsV3MessageType.EVENT,
            sessionId: frame.sessionId,
            payload:   new TextEncoder().encode(JSON.stringify({
              kind:      'bubble',
              sessionId: frame.sessionId,
              event:     ev,
            })),
          }));
        }
        // replay outstanding approval prompts so a browser
        // attaching mid-question sees the buttons. Without this they'd
        // only appear when the next PreToolUse fires.
        if (s) for (const p of s.pendingApprovals.values()) {
          client.ws.send(encodeWsV3Frame({
            type:      WsV3MessageType.EVENT,
            sessionId: frame.sessionId,
            payload:   new TextEncoder().encode(JSON.stringify({
              kind:      'bubble',
              sessionId: frame.sessionId,
              event: {
                kind:       'approval',
                role:       'assistant',
                approvalId: p.approvalId,
                tool:       p.toolName,
                parameters: (p.toolInput && typeof p.toolInput === 'object')
                  ? p.toolInput as Record<string, unknown>
                  : { value: p.toolInput },
                text:       `${p.toolName} requires approval`,
                timestamp:  p.createdAt,
              },
            })),
          }));
        }
      }
      break;
    }

    case WsV3MessageType.UNSUBSCRIBE:
      client.subscriptions.delete(frame.sessionId);
      break;

    case WsV3MessageType.INPUT_TEXT:
    case WsV3MessageType.INPUT_KEY: {
      const s = sessions.get(frame.sessionId);
      if (!s) return;
      if (s.detached) return;  // can't write to a dead socket
      writeFrame(s.socket, FRAME_INPUT, Buffer.from(frame.payload));
      s.bytesOut += frame.payload.length;
      s.lastActiveAt = Date.now();
      // record user input alongside output. Asciinema "i"
      // frames let us reconstruct exactly what the human typed.
      s.recorder?.writeInput(Buffer.from(frame.payload));
      break;
    }

    case WsV3MessageType.EVENT: {
      // Browser → daemon EVENT frames. JSON-encoded with a `kind`
      // tag dispatching to the right handler. Add a new kind here to
      // open a new browser→daemon channel.
      let msg: any;
      try { msg = JSON.parse(new TextDecoder().decode(frame.payload)); }
      catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.kind === 'approvalDecision' && typeof msg.approvalId === 'string') {
        resolveApprovalLocally(msg.approvalId, msg.decision === 'approve' ? 'approve' : 'deny');
      } else if (msg.kind === 'spawnSession') {
        // Phone-tapped "+ New session" — daemon launches /usr/local/bin/pt
        // as a child process. pt opens its own PTY, runs the user's
        // shell inside it, and registers via the same Unix socket
        // path real Terminal.app sessions use. The browser sees the
        // new session appear in its sidebar within ~100ms.
        spawnPtSession({ cwd: typeof msg.cwd === 'string' ? msg.cwd : undefined });
      }
      break;
    }

    case WsV3MessageType.RESIZE: {
      // Browser drives a PTY resize. ws-v3 RESIZE payload is
      // 4 bytes cols + 4 bytes rows, little-endian u32. We translate
      // into pt-shim's compact daemon→pt RESIZE_REMOTE: 2 bytes rows +
      // 2 bytes cols, big-endian u16 (terminal sizes never exceed u16).
      if (frame.payload.length < 8) return;
      const view = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
      const cols = view.getUint32(0, true);
      const rows = view.getUint32(4, true);
      const s = sessions.get(frame.sessionId);
      if (!s) return;
      // SANITY GUARD: a buggy / mid-animation browser can send 0×0 (e.g.
      // when the terminal pane is briefly display:none during a view
      // toggle). Forwarding that to TIOCSWINSZ wedges the shell at
      // column 1 — visible on the local Terminal.app too, since they
      // share the PTY. Refuse anything below the smallest usable size.
      if (cols < 4 || rows < 2 || cols > 1000 || rows > 1000) {
        console.warn(`[pt-registry] ignored bogus RESIZE ${cols}x${rows} for ${frame.sessionId}`);
        return;
      }
      const rowsU16 = Math.min(rows, 0xffff);
      const colsU16 = Math.min(cols, 0xffff);
      const buf = Buffer.alloc(4);
      buf.writeUInt16BE(rowsU16, 0);
      buf.writeUInt16BE(colsU16, 2);
      writeFrame(s.socket, FRAME_RESIZE_REMOTE, buf);
      // Update our cached + headless dims so subsequent SNAPSHOT_VTs
      // serialize at the right size for newly-attaching clients.
      s.rows = rowsU16;
      s.cols = colsU16;
      try { s.headless?.resize(colsU16, rowsU16); } catch { /* noop */ }
      s.lastActiveAt = Date.now();
      break;
    }

    case WsV3MessageType.KILL: {
      const s = sessions.get(frame.sessionId);
      if (!s) return;
      // A tmux-backed session's shell lives in the tmux server, so signalling
      // an attached client only detaches it. Kill the tmux session directly
      // so the shell really exits — this works even when no shim is attached
      // (a rehydrated session with socket === null). The attached client, if
      // any, then hits EOF and reports a clean exit.
      if (s.tmux) {
        killTmuxSession(s.sessionId);
        break;
      }
      // SIGHUP (1) is the right signal for "user closed the terminal".
      // Every shell handles it correctly (it's what `close window` in
      // Terminal.app sends via the PTY hangup mechanism). SIGTERM (15)
      // is sometimes ignored by interactive shells, leaving the
      // session zombie-alive after the user tapped ×.
      writeFrame(s.socket, FRAME_KILL, Buffer.from([1]));
      break;
    }

    case WsV3MessageType.PING:
      client.ws.send(encodeWsV3Frame({ type: WsV3MessageType.PONG }));
      break;

    default:
      break;
  }
}

function attachWsAsBrowserClient(ws: WebSocket, label: string, preAuthed = true): BrowserClient {
  const client: BrowserClient = { ws, subscriptions: new Map(), authed: preAuthed };
  browserClients.add(client);
  // Only paint the session catalog for an already-authenticated client.
  // A relay client (preAuthed=false) gets it after it authenticates in
  // its HELLO frame — never leak the session list to an unauthed peer.
  if (preAuthed) sendWelcomeAndCatalog(ws);
  console.log(`[pt-registry] ${label} connected${preAuthed ? '' : ' (awaiting token)'} (${browserClients.size} total)`);

  ws.on('message', (data: Buffer) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const frame = decodeWsV3Frame(bytes);
    if (!frame) return;
    handleIncomingFrame(client, frame);
  });

  const drop = () => {
    if (browserClients.delete(client)) {
      console.log(`[pt-registry] ${label} disconnected (${browserClients.size} total)`);
    }
  };
  ws.on('close', drop);
  ws.on('error', drop);
  return client;
}

// ─── Browser auth: bearer token + origin allowlist ─────────────────────────
//
// The daemon serves a terminal-control surface: /ws lets a peer stream
// PTY output and inject keystrokes into any live session. Left open, a
// drive-by website could ws://localhost:7700/ws and drive the user's
// shell. Two gates close that:
//
//   1. A per-daemon bearer token (BROWSER_TOKEN). The page GET requires
//      it (delivered via ?t=<token> in the URL the daemon prints) and
//      sets it as a same-origin cookie, so the ws-v3 handshake the
//      static client opens carries it automatically.
//   2. An Origin allowlist on the /ws upgrade — a foreign site's Origin
//      never matches, so it's rejected before the token check.
//
// Tunnel traffic reaches us over loopback (cloudflared dials localhost),
// so it is indistinguishable from a local socket. We therefore never
// exempt by remote address — the token is ALWAYS required.

const TOKEN_COOKIE = 'pocket_t_token';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function tokenFromRequest(req: http.IncomingMessage): string | null {
  // 1) query param ?t= / ?token= (matches the relay hub convention).
  try {
    const u = new URL(req.url ?? '/', 'http://localhost');
    const q = u.searchParams.get('t') ?? u.searchParams.get('token');
    if (q) return q;
  } catch { /* malformed url */ }
  // 2) Authorization: Bearer <token>.
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  // 3) same-origin cookie set by the page route.
  const cookies = parseCookies(req.headers['cookie']);
  return cookies[TOKEN_COOKIE] ?? null;
}

/** Constant-time compare of a candidate against the per-daemon token.
 *  An unminted (empty) token rejects everything. Shared by the HTTP gate
 *  (tokenOk) and the ws-v3 relay gate (HELLO auth). */
function tokenMatches(candidate: string | null | undefined): boolean {
  if (!BROWSER_TOKEN) return false;
  if (!candidate || candidate.length !== BROWSER_TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(BROWSER_TOKEN));
  } catch { return false; }
}

/** True only when the request carries the exact per-daemon token. */
function tokenOk(req: http.IncomingMessage): boolean {
  return tokenMatches(tokenFromRequest(req));
}

/** Extract the bare hostname (no port) from an Origin, a Host header, or
 *  a "host[:port]" string. Comparing host-only sidesteps the default-port
 *  mismatch: a phone's Origin is https://x.trycloudflare.com (implicit
 *  :443) while the forwarded Host may carry an explicit port. Returns ''
 *  on anything unparseable. */
function hostnameOf(hostOrOrigin: string): string {
  try {
    const u = new URL(hostOrOrigin.includes('://') ? hostOrOrigin : `http://${hostOrOrigin}`);
    return u.hostname.toLowerCase();
  } catch { return ''; }
}

/** Origin allowlist for the /ws upgrade. Same-origin (Origin host ==
 *  Host header, both compared HOST-ONLY) or a known tunnel/relay/loopback
 *  host passes. A missing Origin (native client, e.g. the relay dial-out)
 *  passes to the token gate. Any foreign Origin is rejected. */
function originOk(req: http.IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (!origin) return true;  // non-browser client; token still required
  const originHost = hostnameOf(origin);
  if (!originHost) return false;
  const host = req.headers['host'];
  if (host && hostnameOf(host) === originHost) return true;
  return ALLOWED_ORIGIN_HOSTS.has(originHost);
}

// Read a bounded JSON request body. Caps the size so a malicious client
// can't exhaust memory, and rejects anything that isn't a JSON object.
function readJsonBody(req: http.IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function handlePushSubscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
  void (async () => {
    // Push isn't configured — accept the request without storing so the
    // client's fetch resolves, but tell it push won't fire.
    if (!pushService) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'push not configured' }));
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req, 16 * 1024);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      return;
    }
    // Accept either the raw PushSubscription or { subscription: {...} }.
    const sub = (body && typeof body === 'object' && 'subscription' in (body as Record<string, unknown>))
      ? (body as { subscription: unknown }).subscription
      : body;
    if (!pushService.addSubscription(sub)) {
      res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'invalid subscription' }));
      return;
    }
    console.log(`[pt-registry] push subscription registered (${pushService.subscriptionCount} total)`);
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  })();
}

function startBrowserServer(): http.Server {
  const httpServer = http.createServer((req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { /* noop */ }
    // Entry document: token-gated, and hand the token to the browser as a
    // same-origin cookie so the ws-v3 handshake (opened without a query
    // string by the static client) authenticates automatically. HttpOnly
    // keeps it out of page JS; SameSite=Strict keeps it off cross-site
    // requests, so a request from another site carries no token.
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      if (!tokenOk(req)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unauthorized — open the URL the daemon printed (it carries ?t=<token>).');
        return;
      }
      const headers: http.OutgoingHttpHeaders = {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(BROWSER_TOKEN)}; Path=/; SameSite=Strict; HttpOnly`,
      };
      // A read error here (asset deleted mid-serve, permission flip) must
      // fall back to the bundled single-file client, never crash the daemon.
      let body: Buffer | string = BROWSER_PAGE_HTML;
      const indexFile = resolveWebAsset('index.html');
      if (indexFile) {
        try { body = fs.readFileSync(indexFile); }
        catch (e) { console.warn(`[pt-registry] index read failed, using bundled client: ${(e as Error).message}`); }
      }
      res.writeHead(200, headers);
      res.end(body);
      return;
    }
    // Device registers its Web Push subscription here. Token-gated exactly
    // like the entry document — only a holder of the daemon token can point
    // notifications at a device.
    if (req.method === 'POST' && pathname === '/push/subscribe') {
      if (!tokenOk(req)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unauthorized');
        return;
      }
      handlePushSubscribe(req, res);
      return;
    }
    // Static assets from the PWA build (hashed JS/CSS, sw.js, manifest,
    // icons). No secret in these, so they serve without the token; the
    // ws-v3 channel is still token-gated. sw.js is served from root scope.
    if (req.method === 'GET') {
      const file = resolveWebAsset(pathname);
      if (file) {
        const ext = path.extname(file).toLowerCase();
        // A file resolved by statSync can still fail the read (races, a
        // permission change). 500 instead of throwing out of the handler,
        // which would take the whole daemon down.
        let data: Buffer;
        try {
          data = fs.readFileSync(file);
        } catch (e) {
          console.warn(`[pt-registry] static read failed for ${pathname}: ${(e as Error).message}`);
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
        res.end(data);
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const wss = new WebSocketServer({
    server: httpServer,
    path:   '/ws',
    verifyClient: (info, cb) => {
      if (!originOk(info.req)) {
        console.warn(`[pt-registry] rejected /ws — foreign origin ${info.req.headers['origin']}`);
        cb(false, 403, 'Forbidden origin');
        return;
      }
      if (!tokenOk(info.req)) {
        console.warn('[pt-registry] rejected /ws — missing/invalid token');
        cb(false, 401, 'Unauthorized');
        return;
      }
      cb(true);
    },
  });
  wss.on('connection', (ws) => attachWsAsBrowserClient(ws, 'browser'));

  return httpServer;
}

/**
 * Outbound relay client. The daemon dials OUT to a self-hosted ws-v3
 * hub so any browser anywhere can connect through it — no inbound
 * ports on the Mac. (For the default zero-infrastructure case we use
 * Cloudflare Quick Tunnel instead; see tunnel.ts.)
 *
 * Reconnects with bounded backoff. Drops + re-establishes the
 * BrowserClient on reconnect so the catalog is re-emitted automatically
 * to whatever browsers are currently on the other side of the hub.
 */
function connectToRelay(url: string): void {
  let backoff = 1000;
  const MAX_BACKOFF = 30_000;

  const dial = () => {
    console.log(`[pt-registry] dialling relay ${url}…`);
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';

    let client: BrowserClient | null = null;
    ws.on('open', () => {
      console.log(`[pt-registry] relay connected`);
      backoff = 1000;
      // preAuthed=false: the relay hub is a dumb pipe with no per-browser
      // HTTP upgrade, so downstream browsers must authenticate at the
      // ws-v3 layer via the token in their HELLO frame before we honour
      // any privileged frame.
      client = attachWsAsBrowserClient(ws, 'relay', false);
      RELAY_CLIENT = client;  // surfaced via `pt-registry status`.
    });

    const handleEnd = () => {
      if (client && browserClients.delete(client)) {
        console.log(`[pt-registry] relay disconnected — retrying in ${backoff}ms`);
      }
      if (RELAY_CLIENT === client) RELAY_CLIENT = null;
      client = null;
      setTimeout(dial, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    };
    ws.on('close', handleEnd);
    ws.on('error', (e) => {
      console.warn(`[pt-registry] relay error: ${(e as Error).message}`);
    });
  };
  dial();
}

// ─── Static HTML for the browser ───────────────────────────────────────────

// Browser client — the built @pocket-t/web-client PWA is served from its
// static dist/ tree when present; the single-file ui/index.html is the
// fallback if the PWA hasn't been built. The entry document stays behind
// the token gate + Set-Cookie; hashed assets / sw.js / manifest / icons
// are public (they carry no secret).
const BROWSER_PAGE_HTML = fs.readFileSync(
  new URL('./ui/index.html', import.meta.url),
  'utf-8',
);

// Resolve the web-client dist/ across dev (src-relative) and built
// (dist/main.js-relative) layouts.
const WEB_CLIENT_DIST = (() => {
  const candidates = [
    new URL('../../../web-client/dist/', import.meta.url),
    new URL('../../web-client/dist/', import.meta.url),
    new URL('./web/', import.meta.url),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(new URL('index.html', c))) return c; } catch { /* noop */ }
  }
  return null;
})();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
};

/** Resolve a URL path to a real file inside dist/, or null (missing / traversal). */
function resolveWebAsset(pathname: string): string | null {
  if (!WEB_CLIENT_DIST) return null;
  const rel = pathname.replace(/^\/+/, '');
  const root = path.resolve(new URL('.', WEB_CLIENT_DIST).pathname);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;  // block ../ traversal
  try { if (fs.statSync(full).isFile()) return full; } catch { /* noop */ }
  return null;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function ensureSocketDir(): void {
  if (!fs.existsSync(POCKET_T_DIR)) {
    fs.mkdirSync(POCKET_T_DIR, { recursive: true });
  }
}

export async function runServer(opts: { relayUrl?: string; tunnel?: boolean } = {}): Promise<void> {
  ensureSocketDir();

  // Single-instance guard. Two daemons sharing ~/.pocket-t would each
  // unlink and re-bind the other's sockets, splitting the catalog so half
  // the sessions vanish from each. Take a pidfile lock BEFORE touching the
  // sockets; a live holder means another daemon owns them, so we bail.
  const lockHolder = acquireInstanceLock(LOCK_FILE);
  if (lockHolder !== null) {
    console.error(`[pt-registry] another daemon is already running (pid ${lockHolder}). Refusing to start a second instance.`);
    process.exit(1);
  }

  // Remove stale sockets from a prior run.
  for (const p of [PT_SOCK_PATH, CTL_SOCK_PATH]) {
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* noop */ }
    }
  }

  // Rehydrate the session catalog from a prior run BEFORE we start
  // listening, so a surviving shim that re-dials the instant the socket
  // reappears finds its session already waiting and resumes cleanly. Note
  // we deliberately do NOT unlink STATE_FILE above — it's the one file in
  // ~/.pocket-t that must outlive the daemon.
  rehydrateSessions();

  // Fix the per-daemon bearer token BEFORE any surface is served so no
  // request is ever answered with an empty (accept-nothing) token. This is
  // what gates /ws and the page route; the tunnel/relay paths inherit it
  // unconditionally (no loopback exemption — see the auth section).
  //
  // POCKET_T_TOKEN pins a stable token instead of minting a fresh random
  // one each start. A self-hosted hub needs this: the token is also the
  // relay account key, so it must be known ahead of time to put in the
  // `--relay …&t=<token>` URL and share with the browser. Left unset, a
  // strong random token is minted per run (best for local / tunnel use).
  BROWSER_TOKEN = process.env.POCKET_T_TOKEN && process.env.POCKET_T_TOKEN.length >= 16
    ? process.env.POCKET_T_TOKEN
    : crypto.randomBytes(32).toString('hex');

  // Seed the /ws Origin allowlist with our own loopback hostnames so the
  // local browser client passes the same-origin check. Stored HOST-ONLY
  // (no port) to match hostnameOf(); the tunnel/relay host is added below
  // once it's known.
  ALLOWED_ORIGIN_HOSTS.add('127.0.0.1');
  ALLOWED_ORIGIN_HOSTS.add('localhost');
  ALLOWED_ORIGIN_HOSTS.add(hostnameOf(`[::1]:${BROWSER_PORT}`));
  if (BROWSER_HOST !== '127.0.0.1' && BROWSER_HOST !== 'localhost') {
    ALLOWED_ORIGIN_HOSTS.add(hostnameOf(`${BROWSER_HOST}:${BROWSER_PORT}`));
  }

  // Is this daemon exposed beyond the local machine? Tunnel, relay, or a
  // non-loopback bind all mean a remote peer can reach us — which flips
  // the PreToolUse no-listener failsafe to fail CLOSED (deny).
  //
  // CAVEAT (be honest about the trade-off): while exposed AND no UI
  // client is attached, this fail-closed default DENIES every Claude
  // PreToolUse tool call until a browser connects — Claude's tools are
  // blocked, not silently allowed. That's the safe posture for an
  // internet-reachable terminal, but it does mean "exposed + nobody
  // watching = tools denied". An explicit POCKET_T_HOOK_FAILSAFE
  // (approve|deny|passthrough) always overrides this exposure-derived
  // default, so an operator who understands the risk can opt back into
  // approve/passthrough.
  const exposed =
       !!opts.tunnel
    || !!opts.relayUrl
    || (BROWSER_HOST !== '127.0.0.1' && BROWSER_HOST !== 'localhost');
  const failsafeMode = resolveHookFailsafeMode(exposed);

  // Recordings only exist when explicitly opted in. Create the dir 0700
  // (owner-only) so the plaintext keystroke casts aren't world-readable.
  if (RECORDING_ENABLED) {
    // mkdir's mode only applies to a freshly-created dir, so also chmod
    // to remediate a pre-existing recordings dir left world-readable by
    // an earlier build (the .cast files hold plaintext keystrokes).
    try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true, mode: 0o700 }); } catch { /* noop */ }
    try { fs.chmodSync(RECORDINGS_DIR, 0o700); } catch { /* noop */ }
    console.log('[pt-registry] session recording ENABLED (POCKET_T_RECORD) — casts capture every keystroke');
  }

  // Web Push (optional). Enabled only when a VAPID key pair is configured;
  // otherwise it stays null and every push entry point is a no-op.
  pushService = loadPushServiceFromEnv(PUSH_SUBS_FILE);

  const ptServer      = startPtServer();
  const ctlServer     = startCtlServer();
  const browserServer = startBrowserServer();

  // start the Claude Code PreToolUse hook server. Any time
  // Claude wants to run a write/edit/destructive tool, it POSTs here;
  // we turn the request into a bubble event the browser can resolve.
  //
  // CRITICAL: hasViableListener gates whether HookServer should block
  // the Claude tool call waiting for approval. If no browser is
  // connected, blocking is pointless and dangerous — it would hang every
  // Write/Edit globally for the timeout. We bypass the block entirely
  // when no UI client is around. On a loopback-only daemon Claude's own
  // permissions still gate dangerous tools, so approving here is safe;
  // when exposed we fail closed (deny) instead.
  if (failsafeMode === 'passthrough') {
    console.log('[pt-registry] PreToolUse hook server disabled (POCKET_T_HOOK_FAILSAFE=passthrough)');
  } else {
    hookServer = new HookServer({
      port:                HOOK_PORT,
      defaultOnNoListener: failsafeMode,
      hasViableListener:   (sessionId, _toolName) => {
        // "Viable" = at least one browser client is open AND we have a
        // claude-vendor session to attach the approval to. Either
        // condition false → no point blocking; honor the failsafe mode.
        if (browserClients.size === 0) return false;
        // Specific session id from the hook header? Use it if it
        // resolves to one of ours.
        if (sessions.has(sessionId)) return true;
        // Otherwise fall back to "is there any live Claude session?"
        for (const s of sessions.values()) {
          if (s.vendor === 'claude' && !s.detached) return true;
        }
        return false;
      },
    });
    hookServer.start();
    console.log(`[pt-registry] PreToolUse failsafe mode: ${failsafeMode}${exposed ? ' (exposed → fail-closed default)' : ''}`);
  }
  hookServer?.on('approvalRequested', (req: {
    approvalId: string; sessionId: string;
    toolName:   string; toolInput: unknown;
  }) => {
    // The session id Claude tags hooks with rarely matches our pt
    // sessionId (Claude generates its own UUIDs). Fall back to the
    // single active Claude session if there's exactly one — common
    // case for a developer running a single agent on the machine.
    let target = sessions.get(req.sessionId);
    if (!target) {
      const claudeSessions = Array.from(sessions.values())
        .filter(s => s.vendor === 'claude' && !s.detached);
      if (claudeSessions.length === 1) target = claudeSessions[0];
    }
    if (!target) {
      // No matching session — auto-deny so we don't hang the agent.
      console.warn(`[pt-registry] approval ${req.approvalId} for ${req.toolName} has no matching session — denying`);
      hookServer?.resolveApproval(req.approvalId, 'deny');
      return;
    }
    target.pendingApprovals.set(req.approvalId, {
      approvalId: req.approvalId,
      toolName:   req.toolName,
      toolInput:  req.toolInput,
      createdAt:  Date.now(),
    });
    approvalToSession.set(req.approvalId, target.sessionId);
    const ev: BubbleEvent = {
      kind:       'approval',
      role:       'assistant',
      approvalId: req.approvalId,
      tool:       req.toolName,
      parameters: (req.toolInput && typeof req.toolInput === 'object')
        ? req.toolInput as Record<string, unknown>
        : { value: req.toolInput },
      text:       `${req.toolName} requires approval`,
      timestamp:  Date.now(),
    };
    target.events.push(ev);
    if (target.events.length > MAX_ADAPTER_EVENTS) {
      target.events.splice(0, target.events.length - MAX_ADAPTER_EVENTS);
    }
    broadcastEvent(target.sessionId, {
      kind: 'bubble', sessionId: target.sessionId, event: ev,
    });
    // Nobody is watching this session live — push it to the phone so the
    // approval doesn't sit unseen until the agent times out.
    if (pushService && !sessionHasEventWatcher(target.sessionId)) {
      void pushService.notify({
        title: 'pocket-t — approval needed',
        body:  `${req.toolName} requires approval`,
        data:  { sessionId: target.sessionId, tag: `approval-${req.approvalId}` },
      });
    }
  });

  if (opts.relayUrl) {
    connectToRelay(opts.relayUrl);
  }

  await new Promise<void>((resolve) => ptServer.listen(PT_SOCK_PATH, resolve));
  await new Promise<void>((resolve) => ctlServer.listen(CTL_SOCK_PATH, resolve));
  await new Promise<void>((resolve) => browserServer.listen(BROWSER_PORT, BROWSER_HOST, resolve));
  // 0700: only the owner can connect (filesystem-level access control).
  fs.chmodSync(PT_SOCK_PATH,  0o700);
  fs.chmodSync(CTL_SOCK_PATH, 0o700);

  console.log('[pt-registry] listening:');
  console.log(`               pt  socket: ${PT_SOCK_PATH}`);
  console.log(`               ctl socket: ${CTL_SOCK_PATH}`);
  console.log(`               browser:    http://${BROWSER_HOST}:${BROWSER_PORT}/?t=${BROWSER_TOKEN}`);
  console.log(`               hooks:      http://127.0.0.1:${HOOK_PORT}/`);
  console.log(`               recordings: ${RECORDING_ENABLED ? RECORDINGS_DIR : 'disabled (set POCKET_T_RECORD=1 to enable)'}`);
  console.log('[pt-registry] the browser URL carries a required access token — treat it like a password');

  // phone-from-anywhere via Cloudflare Quick Tunnel.
  // Spawn cloudflared (free, no signup) and print the public URL +
  // a scannable QR. This is the default install experience: the user
  // gets a working "open on phone" URL within seconds.
  let tunnel: TunnelHandle | null = null;
  if (opts.tunnel) {
    try {
      console.log('[pt-registry] starting Cloudflare tunnel…');
      tunnel = await startTunnel({ localPort: BROWSER_PORT, token: BROWSER_TOKEN });
      // Allow the tunnel's own Origin through the /ws check (host-only,
      // matching hostnameOf), and print the public URL with the required
      // access token appended.
      try { ALLOWED_ORIGIN_HOSTS.add(hostnameOf(tunnel.url)); } catch { /* noop */ }
      printTunnelBanner(tunnel.url, BROWSER_TOKEN);
    } catch (e) {
      console.warn(`[pt-registry] tunnel failed: ${(e as Error).message}`);
      console.warn('[pt-registry] continuing without tunnel — local browser still works at the URL above');
    }
  } else {
    console.log('[pt-registry] open new Terminal.app windows with the pocket-t profile');
    console.log('[pt-registry] open the browser URL above (or pass --tunnel for phone access)');
  }

  const shutdown = () => {
    console.log('\n[pt-registry] shutting down…');
    // Finalize all live recordings so the .cast files are flushed.
    for (const s of sessions.values()) {
      try { s.recorder?.close(s.exitCode); } catch { /* noop */ }
    }
    // Flush the catalog synchronously so the next `serve` rehydrates the
    // very latest state (the debounced timer may not have fired yet).
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistNow();
    try { tunnel?.stop(); } catch { /* noop */ }
    ptServer.close();
    ctlServer.close();
    browserServer.close();
    for (const p of [PT_SOCK_PATH, CTL_SOCK_PATH]) {
      try { fs.unlinkSync(p); } catch { /* noop */ }
    }
    releaseInstanceLock(LOCK_FILE);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}
