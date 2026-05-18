import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { normalizeChunk, detectApproval } from '../normalizer/ansi.js';
import type { ApprovalOption } from '@pocket-t/shared';

// Same timing/contract as the PTY path (pty/Session.ts) so every CLI —
// tmux-captured or daemon-spawned — streams through one uniform pipeline:
// raw VT bytes in → coalesced, ANSI-normalized, readable chat text out,
// plus base64 rawVt for the optional desktop terminal view.
const COALESCE_MS   = 80;   // batch rapid writes before normalizing
const QUIESCENCE_MS = 500;  // silence threshold → idle

export interface VtChunk    { text: string; rawVt: string; seq: number; }
export interface VtApproval { messageId: string; options: ApprovalOption[]; }

/**
 * A headless-terminal-backed stream for one pane/process.
 *
 * Replaces the old capture-pane snapshot+string-diff model, which on
 * alternate-screen apps (Claude Code, vim, etc.) re-emitted the whole
 * screen on every scroll and deleted history on every clear. Feeding the
 * raw byte stream into a real VT and emitting an append-only normalized
 * delta is lossless and never regenerates.
 */
export class VtStream extends EventEmitter {
  private readonly headless:   Terminal;
  private readonly serializer: SerializeAddon;

  private rawBuffer  = '';
  private seq        = 0;
  private waiting    = false;
  private disposed   = false;
  private hasWritten = false;
  private coalesceTimer?: NodeJS.Timeout;
  private quiesceTimer?:  NodeJS.Timeout;

  /** Last normalized text tail — used for the session list preview. */
  lastPreview = '';

  constructor(cols = 120, rows = 40, scrollback = 5000) {
    super();
    this.headless = new Terminal({
      cols, rows, scrollback, allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.headless.loadAddon(this.serializer);
  }

  /**
   * Seed the screen without emitting a chunk — used to prime VT state from
   * a capture-pane when attaching to a pane that existed before the daemon.
   */
  seed(bytes: Buffer | string): void {
    // Ignore a late capture-pane seed once live output has started — it
    // would otherwise overwrite/corrupt the live screen.
    if (this.disposed || this.hasWritten) return;
    const s = typeof bytes === 'string' ? bytes : bytes.toString('utf-8');
    if (s) this.headless.write(s);
  }

  /** Feed live raw VT bytes (tmux %output payload / pty data). */
  write(bytes: Buffer | string): void {
    if (this.disposed) return;
    const s = typeof bytes === 'string' ? bytes : bytes.toString('utf-8');
    if (!s) return;

    this.hasWritten = true;
    this.headless.write(s);
    this.rawBuffer += s;

    clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => this.flush(), COALESCE_MS);

    clearTimeout(this.quiesceTimer);
    this.quiesceTimer = setTimeout(() => {
      if (!this.disposed) this.emit('quiescent');
    }, QUIESCENCE_MS);
  }

  private flush(): void {
    if (this.disposed || !this.rawBuffer.length) return;
    const raw = this.rawBuffer;
    this.rawBuffer = '';

    const text = normalizeChunk(raw, this.headless.cols);
    if (!text.trim()) return;

    this.lastPreview = text.slice(-120);
    const seq = ++this.seq;

    this.emit('chunk', {
      text,
      rawVt: Buffer.from(raw, 'utf-8').toString('base64'),
      seq,
    } satisfies VtChunk);

    const det = detectApproval(text);
    if (det.isPrompt && det.options?.length && !this.waiting) {
      this.waiting = true;
      this.emit('approval', {
        messageId: randomUUID(),
        options:   det.options,
      } satisfies VtApproval);
    }
  }

  /** Flush any buffered output immediately (e.g. on pane close). */
  flushNow(): void {
    clearTimeout(this.coalesceTimer);
    this.flush();
  }

  clearWaiting(): void { this.waiting = false; }

  resize(cols: number, rows: number): void {
    if (this.disposed || cols <= 0 || rows <= 0) return;
    try { this.headless.resize(cols, rows); } catch { /* noop */ }
  }

  /** Current rendered screen — for a newly attached client. */
  snapshot(): { plainText: string; rawVt: string } {
    const rawVt = this.serializer.serialize();
    return {
      plainText: normalizeChunk(rawVt, this.headless.cols),
      rawVt:     Buffer.from(rawVt, 'utf-8').toString('base64'),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.coalesceTimer);
    clearTimeout(this.quiesceTimer);
    try { this.headless.dispose(); } catch { /* noop */ }
    this.removeAllListeners();
  }
}
