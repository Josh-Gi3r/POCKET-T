// Wraps TmuxClient and feeds pane output into the existing relay pipeline.
// Panes appear as sessions on the phone — same as spawned PTY sessions.
//
// Mapping:
//   tmux pane  →  pocket-t session
//   pane ID    →  session ID ("tmux-<daemonId>-<paneNum>")
//   pane output →  session chunks (streamed to relay)

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { TmuxClient, type TmuxPane } from './TmuxClient.js';
import { VtStream, type VtChunk, type VtApproval } from '../stream/VtStream.js';
import { ClaudeTranscript, hasActiveTranscript, type Turn } from '../agent/ClaudeTranscript.js';
import type { Session, ApprovalOption, MessageKind, MessageRole } from '@pocket-t/shared';

export interface TmuxHostCallbacks {
  // kind/role absent → raw terminal stream (unchanged). Present → a typed
  // agent turn → its own bubble on the phone.
  onChunk:        (sessionId: string, text: string, rawVt: string, seq: number, kind?: MessageKind, role?: MessageRole) => void;
  onSessionAdded: (session: Session) => void;
  onSessionRemoved: (sessionId: string) => void;
  onSessionUpdate: (sessionId: string, status: Session['status'], lastOutput?: string) => void;
  onApproval?:    (sessionId: string, messageId: string, options: ApprovalOption[]) => void;
}

function looksLikeClaudeCommand(command: string): boolean {
  const base = command.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  // Claude Code commonly appears as `node` in tmux's pane_current_command
  // because the `claude` launcher is a Node CLI. The live transcript check
  // still has to pass before agent mode starts.
  return base === 'claude' || base === 'claude-code' || base === 'node';
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
  private streams    = new Map<string, VtStream>();    // paneId → VT stream
  // Panes whose pane is running Claude Code: streamed from the structured
  // on-disk transcript instead of the scraped TUI screen (the spinner/box
  // /ANSI garbage). Presence in this map = "agent mode" → VT is suppressed.
  private agents     = new Map<string, ClaudeTranscript>();  // paneId → tail
  private agentScan: ReturnType<typeof setInterval> | null = null;
  private agentScanRunning = false;
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
    // Detect Claude Code panes and switch them to transcript mode.
    if (!this.agentScan) this.agentScan = setInterval(() => { void this.scanAgents(); }, 4000);
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.agentScan) { clearInterval(this.agentScan); this.agentScan = null; }
    for (const a of this.agents.values()) a.stop();
    this.agents.clear();
    for (const c of this.clients.values()) {
      try { c.disconnect(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }

  // Per-pane: if it is actually running Claude Code and its cwd has a live
  // transcript, stream structured turns from disk and suppress the TUI screen.
  // Cwd alone is not enough: a normal shell in `/Users/josh` can share the
  // same project transcript and must keep rendering as a terminal.
  private async scanAgents(): Promise<void> {
    if (this.agentScanRunning) return;
    this.agentScanRunning = true;
    try {
      for (const [paneId, pane] of [...this.panes]) {
        const client = this.paneOwner.get(paneId);
        const fresh = await client?.refreshPane(paneId);
        const current = fresh ?? pane;
        this.panes.set(paneId, current);

        const commandIsClaude = looksLikeClaudeCommand(current.currentCommand);
        if (this.agents.has(paneId)) {
          if (!commandIsClaude) {
            this.agents.get(paneId)?.stop();
            this.agents.delete(paneId);
            console.log(`[tmux-host] agent mode off: ${paneId} (${current.currentCommand || 'unknown'})`);
          }
          continue;
        }

        if (!commandIsClaude || !hasActiveTranscript(current.currentPath, 30 * 60_000)) continue;
        const sessionId = this.paneToSessionId(paneId);
        const ct = new ClaudeTranscript(current.currentPath);
        if (!ct.start()) continue;
        ct.on('turn', (t: Turn) => {
          const seq = (this.seqMap.get(sessionId) ?? 0) + 1;
          this.seqMap.set(sessionId, seq);
          this.callbacks.onChunk(sessionId, t.text, '', seq, t.kind, t.role);
          this.callbacks.onSessionUpdate(sessionId, 'running');
        });
        ct.on('error', (e: Error) =>
          console.error(`[tmux-host] transcript error [${paneId}]:`, e.message));
        this.agents.set(paneId, ct);
        this.disposeStream(paneId);     // stop emitting the scraped screen
        console.log(`[tmux-host] agent mode: ${paneId} (Claude transcript) ${current.currentPath}`);
      }
    } finally {
      this.agentScanRunning = false;
    }
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
      this.disposeStream(paneId);
      this.agents.get(paneId)?.stop();
      this.agents.delete(paneId);
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
    // Responding clears the waiting latch so the next prompt is detected,
    // and flips the session back to running (mirrors pty/Session.write).
    this.streams.get(paneId)?.clearWaiting();
    this.callbacks.onSessionUpdate(sessionId, 'running');
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

  // Called by ChatPage when user attaches to a session — send current
  // screen. Prefer the live VT's serialized screen (accurate, includes
  // base64 rawVt for the desktop terminal view); fall back to a one-shot
  // capture-pane if the stream isn't up yet.
  async snapshot(sessionId: string): Promise<{ plainText: string; rawVt: string } | null> {
    const paneId = this.sessionToPaneId(sessionId);
    if (!paneId) return null;
    if (this.agents.has(paneId)) return null;
    const st = this.streams.get(paneId);
    if (st) return st.snapshot();
    const client = this.paneOwner.get(paneId);
    if (!client) return null;
    try {
      const buf = await client.capturePane(paneId);
      if (!buf.length) return null;
      const seed = new VtStream();
      seed.seed(buf);
      const snap = seed.snapshot();
      seed.dispose();
      return snap;
    } catch (e) {
      console.error('[tmux-host] snapshot failed:', (e as Error).message);
      return null;
    }
  }

  // Get all current sessions (for relay:sessions on client connect)
  allSessions(): Session[] {
    return Array.from(this.panes.values()).map(p => this.paneToSession(p));
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  // Lazily create the per-pane VT stream and wire its events to the
  // session callbacks. Seeded from a capture-pane so a pane that existed
  // before the daemon attached has correct VT state for the first snapshot.
  private ensureStream(paneId: string): VtStream | undefined {
    const pane = this.panes.get(paneId);
    if (!pane) return undefined;
    let st = this.streams.get(paneId);
    if (st) return st;

    st = new VtStream(pane.width || 120, pane.height || 40);
    this.streams.set(paneId, st);
    const sessionId = this.paneToSessionId(paneId);

    st.on('chunk', (c: VtChunk) => {
      this.seqMap.set(sessionId, c.seq);
      this.callbacks.onChunk(sessionId, c.text, c.rawVt, c.seq);
    });
    st.on('approval', (a: VtApproval) => {
      this.callbacks.onSessionUpdate(sessionId, 'waiting');
      this.callbacks.onApproval?.(sessionId, a.messageId, a.options);
    });
    st.on('quiescent', () => {
      const stream = this.streams.get(paneId);
      this.callbacks.onSessionUpdate(sessionId, 'idle', stream?.lastPreview);
    });

    const client = this.paneOwner.get(paneId);
    client?.capturePane(paneId, 200)
      .then((buf) => { if (buf.length) this.streams.get(paneId)?.seed(buf); })
      .catch(() => { /* pane may have closed */ });

    return st;
  }

  private disposeStream(paneId: string): void {
    const st = this.streams.get(paneId);
    if (!st) return;
    st.flushNow();
    st.dispose();
    this.streams.delete(paneId);
  }

  private wireEvents(client: TmuxClient): void {
    // Feed the raw %output byte stream into a real headless VT and emit an
    // append-only normalized delta (see stream/VtStream.ts). The old
    // capture-pane snapshot+string-diff re-emitted the whole screen on
    // every scroll and deleted history on every clear for alternate-screen
    // apps (Claude Code, vim, …) — the core streaming bug.
    client.on('paneOutput', (paneId: string, bytes: Buffer) => {
      // Claude Code panes are streamed from the structured transcript, not
      // the redrawing TUI — never feed their scraped bytes to the VT.
      if (this.agents.has(paneId)) return;
      this.ensureStream(paneId)?.write(bytes);
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
      this.disposeStream(paneId);
      this.agents.get(paneId)?.stop();
      this.agents.delete(paneId);
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

  // Stable bidirectional ID mapping. The id is namespaced by daemonId:
  // `sessions.id` is a single global TEXT primary key, so a bare
  // `tmux-<paneNum>` (pane ids reset to %0,%1,... per server) collides
  // across two Macs on the same account. Prefixing the daemonId makes it
  // globally unique. main.ts still routes on the `tmux-` prefix, and the
  // Claude Code hook builds the identical id from $TMUX_PANE.
  private get idPrefix(): string {
    return `tmux-${this.daemonId}-`;
  }

  private paneToSessionId(paneId: string): string {
    return `${this.idPrefix}${paneId.replace('%', '')}`;
  }

  private sessionToPaneId(sessionId: string): string | undefined {
    if (!sessionId.startsWith(this.idPrefix)) return undefined;
    const num = sessionId.slice(this.idPrefix.length);
    if (!/^\d+$/.test(num)) return undefined;
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

// ─── Default tmux.conf for pocket-t's isolated server ────────────────────────

const TMUX_CONF = `
# pocket-t tmux server config — isolated from user's own tmux

set -g default-terminal "tmux-256color"
set -g escape-time 25
set -g focus-events on
# The auto-attach wrap makes this tmux THE Mac terminal's scrollback —
# 5000 truncated real user history ("terminals getting cut"). Keep large.
set -g history-limit 200000
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
