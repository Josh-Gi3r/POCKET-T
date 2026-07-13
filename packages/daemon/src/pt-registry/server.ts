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
// is the foundation for Model B-lite resume (a new pt with the same
// sessionId can pick up where the old one left off — see ResumeOpts).
const DETACH_GRACE_MS = 60_000;

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
  socket:        net.Socket;
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
    pendingApprovals: s.pendingApprovals.size,
  };
}

// Module-level HookServer instance — created in runServer() and
// referenced by the ctl + ws-v3 approval handlers.
let hookServer: HookServer | null = null;

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

function writeFrame(sock: net.Socket, type: number, payload: Buffer | Uint8Array = Buffer.alloc(0)): void {
  if (sock.destroyed || !sock.writable) return;
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
                broadcastEvent(sessionId, { kind: 'sessionUpdated', session: publicView(existing) });
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
      console.log(`[pt-registry] ⌛ ${s.sessionId} detached — grace ${DETACH_GRACE_MS / 1000}s`);
      broadcastEvent(s.sessionId, { kind: 'sessionUpdated', session: publicView(s) });
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
  // approvalDecision) — is dropped. This closes the --relay bypass where
  // an unauthenticated hub peer could inject keystrokes / kill sessions.
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

function startBrowserServer(): http.Server {
  const httpServer = http.createServer((req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { /* noop */ }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      if (!tokenOk(req)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unauthorized — open the URL the daemon printed (it carries ?t=<token>).');
        return;
      }
      // Hand the token to the browser as a same-origin cookie so the
      // ws-v3 handshake (opened without a query string by the static
      // client) authenticates automatically. HttpOnly keeps it out of
      // page JS; SameSite=Strict keeps it off cross-site requests, so a
      // drive-by ws attempt from another site carries no token.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': `${TOKEN_COOKIE}=${encodeURIComponent(BROWSER_TOKEN)}; Path=/; SameSite=Strict; HttpOnly`,
      });
      res.end(BROWSER_PAGE_HTML);
      return;
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

// Browser UI — single-page HTML served at the root. Lives in ui/index.html
// for editor friendliness (syntax highlighting, prettier, no template-
// literal escape ceremony). Loaded once at module init.
const BROWSER_PAGE_HTML = fs.readFileSync(
  new URL('./ui/index.html', import.meta.url),
  'utf-8',
);

// ─── CLI ───────────────────────────────────────────────────────────────────

function ensureSocketDir(): void {
  if (!fs.existsSync(POCKET_T_DIR)) {
    fs.mkdirSync(POCKET_T_DIR, { recursive: true });
  }
}

export async function runServer(opts: { relayUrl?: string; tunnel?: boolean } = {}): Promise<void> {
  ensureSocketDir();
  // Remove stale sockets from a prior run.
  for (const p of [PT_SOCK_PATH, CTL_SOCK_PATH]) {
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* noop */ }
    }
  }

  // Mint the per-daemon bearer token BEFORE any surface is served so no
  // request is ever answered with an empty (accept-nothing) token. This
  // is what gates /ws and the page route; the tunnel/relay paths inherit
  // it unconditionally (no loopback exemption — see the auth section).
  BROWSER_TOKEN = crypto.randomBytes(32).toString('hex');

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
  // approve/passthrough. (Prose docs owned by the docs lane.)
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

  const ptServer      = startPtServer();
  const ctlServer     = startCtlServer();
  const browserServer = startBrowserServer();

  // start the Claude Code PreToolUse hook server. Any time
  // Claude wants to run a write/edit/destructive tool, it POSTs here;
  // we turn the request into a bubble event the browser can resolve.
  //
  // CRITICAL: hasViableListener gates whether HookServer should block
  // the Claude tool call waiting for approval. If no browser is
  // connected, blocking is pointless and dangerous — it hangs every
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
    try { tunnel?.stop(); } catch { /* noop */ }
    ptServer.close();
    ctlServer.close();
    browserServer.close();
    for (const p of [PT_SOCK_PATH, CTL_SOCK_PATH]) {
      try { fs.unlinkSync(p); } catch { /* noop */ }
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}
