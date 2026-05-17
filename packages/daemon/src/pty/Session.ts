import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { normalizeChunk, detectApproval } from '../normalizer/ansi.js';
import type { Session as SessionMeta, SessionStatus, ApprovalOption } from '@pocket-t/shared';
import type { MementoEngine } from '../memento/index.js';
import type { KeyManager } from '../crypto/KeyManager.js';
import type { EncryptedChunk } from '@pocket-t/shared';

// Timing constants
const COALESCE_MS   = 80;   // batch rapid PTY writes before normalizing
const QUIESCENCE_MS = 500;  // silence threshold → idle state
const COLS          = 120;
const ROWS          = 40;
const SCROLLBACK    = 5000;

export interface ChunkEvent {
  text:  string;
  rawVt: string;  // base64 of raw PTY bytes (for xterm.js)
  seq:   number;
}

export interface EncryptedChunkEvent {
  encrypted: EncryptedChunk;
  seq:       number;
}

export interface ApprovalEvent {
  messageId: string;
  options:   ApprovalOption[];
}

export interface ExitEvent {
  exitCode: number;
  signal?:  number;
}

export class Session extends EventEmitter {
  readonly id:   string;
  readonly name: string;
  readonly cmd:  string;
  readonly cwd:  string;
  readonly pid:  number;

  private readonly ptyProc:    pty.IPty;
  private readonly headless:   Terminal;
  private readonly serializer: SerializeAddon;

  private seq              = 0;
  private rawBuffer        = '';
  private coalesceTimer?:  NodeJS.Timeout;
  private quiesceTimer?:   NodeJS.Timeout;
  private _status:         SessionStatus = 'running';
  private lastOutputPreview = '';
  private lastActiveAt     = Date.now();

  constructor(
    id:   string,
    name: string,
    cmd:  string,
    args: string[],
    cwd:  string,
    private readonly mementoEngine?: MementoEngine,
    private readonly keyManager?: KeyManager,
    private readonly e2eEnabled  = false,
  ) {
    super();
    this.id   = id;
    this.name = name;
    this.cmd  = [cmd, ...args].join(' ');
    this.cwd  = cwd;

    // Headless terminal for VT state tracking and snapshots
    this.headless = new Terminal({
      cols:              COLS,
      rows:              ROWS,
      scrollback:        SCROLLBACK,
      allowProposedApi:  true,
    });
    this.serializer = new SerializeAddon();
    this.headless.loadAddon(this.serializer);

    // Spawn the actual process
    this.ptyProc = pty.spawn(cmd, args, {
      name:             'xterm-256color',
      cols:             COLS,
      rows:             ROWS,
      cwd,
      env: {
        ...process.env,
        TERM:        'xterm-256color',
        COLORTERM:   'truecolor',
        FORCE_COLOR: '1',
        LINES:       String(ROWS),
        COLUMNS:     String(COLS),
      },
      handleFlowControl: true,
    });

    this.pid = this.ptyProc.pid;
    this.bindEvents();
  }

  private bindEvents() {
    this.ptyProc.onData((chunk) => {
      // Write to headless terminal to keep VT state accurate
      this.headless.write(chunk);
      this.rawBuffer  += chunk;
      this.lastActiveAt = Date.now();

      // Coalesce rapid writes (e.g. fast build output)
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = setTimeout(
        () => this.processBuffer(),
        COALESCE_MS,
      );

      // Quiescence: extended silence → idle
      clearTimeout(this.quiesceTimer);
      this.quiesceTimer = setTimeout(
        () => this.onQuiescent(),
        QUIESCENCE_MS,
      );
    });

    this.ptyProc.onExit(({ exitCode, signal }) => {
      clearTimeout(this.coalesceTimer);
      clearTimeout(this.quiesceTimer);
      // Flush any remaining buffer
      if (this.rawBuffer) this.processBuffer();
      this.mementoEngine?.onSessionEnd();  // flush NOHUP.md before rest of exit
      this._status = 'dead';
      this.emit('exit', { exitCode, signal } satisfies ExitEvent);
    });
  }

  private processBuffer() {
    if (!this.rawBuffer.length) return;
    const raw = this.rawBuffer;
    this.rawBuffer = '';

    const text = normalizeChunk(raw, COLS);
    if (!text.trim()) return;

    this.lastOutputPreview = text.slice(-120);
    const seq = ++this.seq;

    // Emit chunk — encrypted transport when E2E is enabled (V2),
    // otherwise the plaintext V1 path.
    if (this.keyManager && this.e2eEnabled) {
      this.emit('chunkEncrypted', {
        encrypted: this.keyManager.encrypt(text),
        seq,
      } satisfies EncryptedChunkEvent);
    } else {
      this.emit('chunk', {
        text,
        rawVt: Buffer.from(raw).toString('base64'),
        seq,
      } satisfies ChunkEvent);
    }

    // Feed Memento after relay emit — non-blocking, non-crashing
    if (this.mementoEngine) {
      for (const line of text.split('\n')) {
        this.mementoEngine.onLine(line);
      }
    }

    // Detect approval / input prompts (V3 heuristic detector)
    const detection = detectApproval(text);
    if (detection.isPrompt && detection.options?.length && this._status !== 'waiting') {
      this._status = 'waiting';
      this.emit('approval', {
        messageId: randomUUID(),
        options:   detection.options,
      } satisfies ApprovalEvent);
      this.emit('statusChange', 'waiting' as SessionStatus);
    }
  }

  private onQuiescent() {
    if (this._status === 'running') {
      this._status = 'idle';
      this.emit('statusChange', 'idle' as SessionStatus);
    }
  }

  write(input: string) {
    if (this._status === 'dead') throw new Error('Session is dead');
    this._status = 'running';
    this.emit('statusChange', 'running' as SessionStatus);
    this.ptyProc.write(input);
  }

  resize(cols: number, rows: number) {
    this.ptyProc.resize(cols, rows);
    this.headless.resize(cols, rows);
  }

  kill(signal: string = 'SIGTERM') {
    try { this.ptyProc.kill(signal); } catch { /* already dead */ }
  }

  clearWaiting() {
    if (this._status === 'waiting') {
      this._status = 'running';
      this.emit('statusChange', 'running' as SessionStatus);
    }
  }

  get status(): SessionStatus { return this._status; }

  /**
   * Current screen content as plain text.
   * Used when a new client attaches to an existing session.
   */
  snapshot(): { plainText: string; rawVt: string } {
    const rawVt    = this.serializer.serialize();
    const plainText = normalizeChunk(rawVt, COLS);
    return { plainText, rawVt: Buffer.from(rawVt).toString('base64') };
  }

  toMeta(daemonId: string, accountId: string): SessionMeta {
    return {
      id:           this.id,
      daemonId,
      accountId,
      name:         this.name,
      cmd:          this.cmd,
      cwd:          this.cwd,
      status:       this._status,
      lastOutput:   this.lastOutputPreview,
      lastActiveAt: this.lastActiveAt,
      seq:          this.seq,
      pid:          this.pid,
    };
  }
}
