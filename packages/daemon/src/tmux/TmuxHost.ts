// Wraps TmuxClient and feeds pane output into the existing relay pipeline.
// Panes appear as sessions on the phone — same as spawned PTY sessions.
//
// Mapping:
//   tmux pane  →  pocket-t session
//   pane ID    →  session ID (prefixed "tmux-")
//   pane output →  session chunks (streamed to relay)

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
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
  private client: TmuxClient;
  private seqMap  = new Map<string, number>();  // sessionId → chunk sequence number
  private confPath: string;

  // Reconnect control. A tmux server death used to trigger an unbounded
  // 3s-interval respawn loop; each failed pty.spawn leaked a pseudo-tty,
  // exhausting the macOS pty pool until *nothing* could fork (the relay,
  // the user's own shells — the whole machine degraded). Bounded
  // exponential backoff + a hard cap + reaping the dead client first.
  private stopped     = false;
  private retries     = 0;
  private readonly maxRetries = 6;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly daemonId:   string,
    private readonly accountId:  string,
    private readonly callbacks:  TmuxHostCallbacks,
  ) {
    this.confPath = this.ensureConf();
    this.client   = new TmuxClient(this.confPath);
    this.wireEvents();
  }

  async start(): Promise<void> {
    await this.client.connect();
    this.retries = 0;            // a clean connect resets the backoff
    console.log('[tmux-host] connected');
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.client.disconnect();
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
      // Reap the dead pty + rebuild a fresh client so connect() state
      // (startup barrier, seed flags) doesn't carry over and no pty leaks.
      try { this.client.disconnect(); } catch { /* already gone */ }
      this.client = new TmuxClient(this.confPath);
      this.wireEvents();
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
    await this.client.sendInput(paneId, text);
    await this.client.sendEnter(paneId);
  }

  // Called by RelayClient when mobile user spawns a new session
  async spawnWindow(name: string, command: string, cwd?: string): Promise<string> {
    const windowId = await this.client.spawnWindow({ name, command, cwd });
    // Pane events will fire via TmuxClient → callbacks automatically
    return windowId;
  }

  // Called by RelayClient when mobile user kills a session
  async killSession(sessionId: string): Promise<void> {
    const paneId = this.sessionToPaneId(sessionId);
    if (!paneId) return;
    await this.client.killPane(paneId);
  }

  // Called by ChatPage when user attaches to a session — send current screen
  async capturePane(sessionId: string): Promise<Buffer> {
    const paneId = this.sessionToPaneId(sessionId);
    if (!paneId) return Buffer.alloc(0);
    return this.client.capturePane(paneId);
  }

  // Get all current sessions (for relay:sessions on client connect)
  allSessions(): Session[] {
    return Array.from(this.client.panes.values()).map(p =>
      this.paneToSession(p)
    );
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private wireEvents(): void {
    this.client.on('paneOutput', (paneId: string, data: Buffer) => {
      const sessionId = this.paneToSessionId(paneId);
      const seq       = (this.seqMap.get(sessionId) ?? 0) + 1;
      this.seqMap.set(sessionId, seq);

      const text  = stripAnsi(data.toString('utf-8'));
      const rawVt = data.toString('base64');

      if (text.trim()) {
        this.callbacks.onChunk(sessionId, text, rawVt, seq);
      }
    });

    this.client.on('paneAdded', (pane: TmuxPane) => {
      const session = this.paneToSession(pane);
      this.callbacks.onSessionAdded(session);
      console.log(`[tmux-host] pane added: ${pane.id} (${pane.currentCommand})`);
    });

    this.client.on('paneRemoved', (paneId: string) => {
      const sessionId = this.paneToSessionId(paneId);
      this.callbacks.onSessionRemoved(sessionId);
      console.log(`[tmux-host] pane removed: ${paneId}`);
    });

    this.client.on('ready', () => {
      for (const pane of this.client.panes.values()) {
        this.callbacks.onSessionAdded(this.paneToSession(pane));
      }
    });

    this.client.on('exit', () => {
      console.log('[tmux-host] tmux server exited');
      this.scheduleReconnect();
    });

    this.client.on('error', (err: Error) => {
      console.error('[tmux-host] error:', err.message);
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
    return this.client.panes.has(paneId) ? paneId : undefined;
  }

  private paneToSession(pane: TmuxPane): Session {
    const sessionId = this.paneToSessionId(pane.id);
    return {
      id:           sessionId,
      daemonId:     this.daemonId,
      accountId:    this.accountId,
      name:         pane.title || pane.currentCommand || pane.id,
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
    if (!existsSync(path)) {
      writeFileSync(path, TMUX_CONF, 'utf-8');
      console.log('[tmux-host] created tmux.conf at', path);
    }
    return path;
  }
}

// ─── ANSI stripper for chat bubbles ──────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|\x1b[()][0-9A-Za-z]|\r(?!\n)/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '').replace(/\x00/g, '');
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
set -g mouse off
set -g visual-bell off
set -g visual-activity off
set -g visual-silence off
setw -g monitor-activity off
set -g bell-action none
`.trim();
