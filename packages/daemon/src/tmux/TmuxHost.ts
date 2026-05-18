// Wraps TmuxClient and feeds pane output into the existing relay pipeline.
// Panes appear as sessions on the phone — same as spawned PTY sessions.
//
// Mapping:
//   tmux pane  →  pocket-t session
//   pane ID    →  session ID (prefixed "tmux-")
//   pane output →  session chunks (streamed to relay)

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { TmuxClient, type TmuxPane } from './TmuxClient.js';
import type { Session } from '@pocket-t/shared';

export interface TmuxHostCallbacks {
  onChunk:        (sessionId: string, text: string, rawVt: string, seq: number) => void;
  onSessionAdded: (session: Session) => void;
  onSessionRemoved: (sessionId: string) => void;
  onSessionUpdate: (sessionId: string, status: Session['status'], lastOutput?: string) => void;
}

export class TmuxHost {
  // One control client per tmux session (a tmux -CC client only receives
  // %output for its attached session). `primary` is the daemon's own
  // `pocket-t` session and additionally does discovery; every other
  // session gets its own attach-only client. All feed the same callbacks.
  private primary!: TmuxClient;
  private clients = new Map<string, TmuxClient>();   // session name → client

  // Unified pane registry across all clients (pane IDs are server-unique).
  private panes      = new Map<string, TmuxPane>();    // paneId → pane
  private paneOwner  = new Map<string, TmuxClient>();  // paneId → its client
  private seqMap     = new Map<string, number>();      // sessionId → seq
  private captureTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastCapture   = new Map<string, string>();   // paneId → last screen
  private confPath: string;

  // Reconnect control for the PRIMARY (server death). A tmux server death
  // used to trigger an unbounded 3s respawn loop that leaked a pty per
  // failed spawn and exhausted the macOS pty pool. Bounded backoff + cap.
  private stopped     = false;
  private retries     = 0;
  private readonly maxRetries = 6;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  // Reconcile serialization — %sessions-changed can fire in bursts.
  private reconciling   = false;
  private reconcileAgain = false;

  constructor(
    private readonly daemonId:   string,
    private readonly accountId:  string,
    private readonly callbacks:  TmuxHostCallbacks,
  ) {
    this.confPath = this.ensureConf();
    this.primary  = new TmuxClient(this.confPath, 'pocket-t', true);
    this.clients.set('pocket-t', this.primary);
    this.wireEvents(this.primary);
  }

  async start(): Promise<void> {
    await this.primary.connect();
    this.retries = 0;            // a clean connect resets the backoff
    console.log('[tmux-host] primary connected');
    await this.reconcileSessions();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    for (const c of this.clients.values()) {
      try { c.disconnect(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }

  // Spawn/teardown per-session clients so the live set matches the server.
  private async reconcileSessions(): Promise<void> {
    if (this.reconciling) { this.reconcileAgain = true; return; }
    this.reconciling = true;
    try {
      const names = await this.primary.listSessions();
      const live  = new Set(names);

      // New sessions → spawn a dedicated attach-only client.
      for (const name of names) {
        if (this.clients.has(name)) continue;
        const client = new TmuxClient(this.confPath, name, false);
        this.clients.set(name, client);
        this.wireEvents(client);
        try {
          await client.connect();
          console.log(`[tmux-host] session client up: ${name}`);
        } catch (e) {
          console.error(`[tmux-host] session client failed (${name}):`, (e as Error).message);
          this.clients.delete(name);
          try { client.disconnect(); } catch { /* noop */ }
        }
      }

      // Vanished sessions → tear the client down (primary never removed).
      for (const [name, client] of [...this.clients]) {
        if (name === 'pocket-t' || live.has(name)) continue;
        try { client.disconnect(); } catch { /* noop */ }
        this.clients.delete(name);
        this.dropClientPanes(client);
        console.log(`[tmux-host] session client gone: ${name}`);
      }
    } finally {
      this.reconciling = false;
      if (this.reconcileAgain) {
        this.reconcileAgain = false;
        setTimeout(() => this.reconcileSessions().catch(() => {}), 150);
      }
    }
  }

  private dropClientPanes(client: TmuxClient): void {
    for (const [paneId, owner] of [...this.paneOwner]) {
      if (owner !== client) continue;
      this.paneOwner.delete(paneId);
      this.panes.delete(paneId);
      this.callbacks.onSessionRemoved(this.paneToSessionId(paneId));
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.restartTimer) return;
    if (this.retries >= this.maxRetries) {
      console.error(
        `[tmux-host] tmux server failed ${this.retries} times — giving up ` +
        `auto-capture (spawn-only still works). Restart the daemon to retry.`
      );
      return;
    }
    const delay = Math.min(30_000, 2_000 * 2 ** this.retries);
    this.retries++;
    console.log(`[tmux-host] reconnecting in ${delay}ms (attempt ${this.retries}/${this.maxRetries})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      // Server died → every client is dead. Reap them all and rebuild
      // from a fresh primary so no connect()-state carries over / leaks.
      for (const c of this.clients.values()) {
        try { c.disconnect(); } catch { /* noop */ }
      }
      this.clients.clear();
      this.panes.clear();
      this.paneOwner.clear();
      this.primary = new TmuxClient(this.confPath, 'pocket-t', true);
      this.clients.set('pocket-t', this.primary);
      this.wireEvents(this.primary);
      this.start().catch((e) => {
        console.error('[tmux-host] reconnect failed:', (e as Error).message);
        this.scheduleReconnect();
      });
    }, delay);
  }

  // Called by RelayClient when mobile user sends input to a tmux pane session
  async sendInput(sessionId: string, text: string): Promise<void> {
    const paneId = this.sessionToPaneId(sessionId);
    if (!paneId) return;
    const client = this.paneOwner.get(paneId);
    if (!client) return;
    try {
      await client.sendInput(paneId, text);
      await client.sendEnter(paneId);
    } catch (e) {
      console.error('[tmux-host] sendInput failed:', (e as Error).message);
    }
  }

  // Called by RelayClient when mobile user spawns a new session
  async spawnWindow(name: string, command: string, cwd?: string): Promise<string> {
    try {
      const windowId = await this.primary.spawnWindow({ name, command, cwd });
      // Pane events will fire via the relevant client → callbacks
      return windowId;
    } catch (e) {
      console.error('[tmux-host] spawnWindow failed:', (e as Error).message);
      return '';
    }
  }

  // Called by RelayClient when mobile user kills a session
  async killSession(sessionId: string): Promise<void> {
    const paneId = this.sessionToPaneId(sessionId);
    if (!paneId) return;
    const client = this.paneOwner.get(paneId);
    if (!client) return;
    try {
      await client.killPane(paneId);
    } catch (e) {
      console.error('[tmux-host] killSession failed:', (e as Error).message);
    }
  }

  // Called by ChatPage when user attaches to a session — send current screen
  async capturePane(sessionId: string): Promise<Buffer> {
    const paneId = this.sessionToPaneId(sessionId);
    if (!paneId) return Buffer.alloc(0);
    const client = this.paneOwner.get(paneId);
    if (!client) return Buffer.alloc(0);
    try {
      return await client.capturePane(paneId);
    } catch (e) {
      console.error('[tmux-host] capturePane failed:', (e as Error).message);
      return Buffer.alloc(0);
    }
  }

  // Get all current sessions (for relay:sessions on client connect)
  allSessions(): Session[] {
    return Array.from(this.panes.values()).map(p => this.paneToSession(p));
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private wireEvents(client: TmuxClient): void {
    // Raw %output is pre-render bytes (cursor moves, alternate-screen
    // redraws) — meaningless in a chat bubble without a VT renderer, which
    // is what made text overlap/disappear. Debounce, then capture the
    // RENDERED screen and stream that instead.
    client.on('paneOutput', (paneId: string) => {
      const prev = this.captureTimers.get(paneId);
      if (prev) clearTimeout(prev);
      this.captureTimers.set(paneId, setTimeout(async () => {
        this.captureTimers.delete(paneId);
        const sessionId = this.paneToSessionId(paneId);
        const seq       = (this.seqMap.get(sessionId) ?? 0) + 1;
        this.seqMap.set(sessionId, seq);
        try {
          const captured = await client.capturePane(paneId, 100);
          const screen   = stripAnsi(captured.toString('utf-8'))
            .replace(/[ \t]+$/gm, '')   // trailing pad from the grid
            .replace(/\n{3,}/g, '\n\n') // collapse the blank grid rows
            .trimEnd();

          const prevScreen = this.lastCapture.get(paneId) ?? '';
          // Identical capture (TUI idle / spinner-only redraw) → emit
          // nothing. This is what was duplicating the whole conversation
          // every 300ms forever.
          if (screen === prevScreen) return;

          // Append-only delta: if the new screen extends the old one, send
          // just the new tail. Otherwise the screen was redrawn/scrolled —
          // send the new screen once (not stacked infinitely).
          let delta: string;
          if (prevScreen && screen.startsWith(prevScreen)) {
            delta = screen.slice(prevScreen.length);
          } else {
            const pl = longestCommonPrefixLen(prevScreen, screen);
            delta = pl > 0 ? screen.slice(pl) : screen;
          }
          this.lastCapture.set(paneId, screen);

          const out = delta.trim();
          if (out) this.callbacks.onChunk(sessionId, out, '', seq);
        } catch { /* pane may have closed */ }
      }, 300));
    });

    client.on('paneAdded', (pane: TmuxPane) => {
      this.panes.set(pane.id, pane);
      this.paneOwner.set(pane.id, client);
      this.callbacks.onSessionAdded(this.paneToSession(pane));
      console.log(`[tmux-host] pane added: ${pane.id} (${pane.currentCommand}) [${client.sessionName}]`);
    });

    client.on('paneRemoved', (paneId: string) => {
      this.panes.delete(paneId);
      this.paneOwner.delete(paneId);
      this.lastCapture.delete(paneId);
      const t = this.captureTimers.get(paneId);
      if (t) { clearTimeout(t); this.captureTimers.delete(paneId); }
      this.callbacks.onSessionRemoved(this.paneToSessionId(paneId));
      console.log(`[tmux-host] pane removed: ${paneId}`);
    });

    client.on('ready', () => {
      for (const pane of client.panes.values()) {
        this.panes.set(pane.id, pane);
        this.paneOwner.set(pane.id, client);
        this.callbacks.onSessionAdded(this.paneToSession(pane));
      }
    });

    client.on('sessionsChanged', () => {
      // primary only — server session set changed
      this.reconcileSessions().catch((e) =>
        console.error('[tmux-host] reconcile failed:', (e as Error).message));
    });

    client.on('exit', () => {
      if (client === this.primary) {
        console.log('[tmux-host] tmux server exited');
        this.scheduleReconnect();
        return;
      }
      // A per-session client died (its session ended, or transient).
      // Drop its panes; reconcile re-spawns it if the session still exists.
      console.log(`[tmux-host] session client exited: ${client.sessionName}`);
      this.clients.delete(client.sessionName);
      this.dropClientPanes(client);
      this.reconcileSessions().catch(() => {});
    });

    client.on('error', (err: Error) => {
      console.error(`[tmux-host] error [${client.sessionName}]:`, err.message);
    });
  }

  // Stable bidirectional ID mapping
  private paneToSessionId(paneId: string): string {
    return `tmux-${paneId.replace('%', '')}`;
  }

  private sessionToPaneId(sessionId: string): string | undefined {
    if (!sessionId.startsWith('tmux-')) return undefined;
    const num = sessionId.slice('tmux-'.length);
    const paneId = `%${num}`;
    return this.panes.has(paneId) ? paneId : undefined;
  }

  private paneToSession(pane: TmuxPane): Session {
    const sessionId = this.paneToSessionId(pane.id);
    return {
      id:           sessionId,
      daemonId:     this.daemonId,
      accountId:    this.accountId,
      // pane.title defaults to the hostname — useless in the inbox.
      // Show the running command + the working dir's last segment.
      name: pane.currentCommand
        ? `${pane.currentCommand} — ${pane.currentPath.split('/').filter(Boolean).pop() ?? '~'}`
        : pane.id,
      cmd:          pane.currentCommand,
      cwd:          pane.currentPath,
      status:       'running',
      lastOutput:   '',
      lastActiveAt: Date.now(),
      seq:          this.seqMap.get(sessionId) ?? 0,
      pid:          pane.pid,
    };
  }

  // ─── tmux.conf generation ────────────────────────────────────────────────────

  private ensureConf(): string {
    const dir  = join(os.homedir(), '.pocket-t');
    const path = join(dir, 'tmux.conf');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // This file is daemon-owned (header says so) — keep it in sync with
    // TMUX_CONF, otherwise a stale conf (e.g. old `mouse off`) sticks
    // forever after the first run.
    const current = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    if (current !== TMUX_CONF) {
      writeFileSync(path, TMUX_CONF, 'utf-8');
      console.log('[tmux-host] wrote tmux.conf at', path);
    }
    return path;
  }
}

// ─── ANSI stripper for chat bubbles ──────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|\x1b[()][0-9A-Za-z]|\r(?!\n)/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '').replace(/\x00/g, '');
}

// How many leading chars two screens share — used to emit only the part
// of a re-captured screen that's actually new (append-only delta).
function longestCommonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// ─── Default tmux.conf for pocket-t's isolated server ────────────────────────

const TMUX_CONF = `
# pocket-t tmux server config — isolated from user's own tmux

set -g default-terminal "tmux-256color"
set -g escape-time 25
set -g focus-events on
set -g history-limit 5000
set -g window-size latest
set -g status off
# Wheel scrolls THIS pane's own scrollback (copy-mode). With mouse off,
# Terminal.app turns the wheel into ↑/↓ → zsh history → you'd see other
# terminals' commands (shared HISTFILE). mouse on = scroll the terminal.
set -g mouse on
set -g visual-bell off
set -g visual-activity off
set -g visual-silence off
setw -g monitor-activity off
set -g bell-action none
`.trim();
