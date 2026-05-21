// Asciinema v2 recorder
//
// Every pt session streams its PTY output to ~/.pocket-t/recordings/
// <sessionId>.cast as an asciinema v2 cast file. The file format is
// well-defined (https://github.com/asciinema/asciinema/blob/master/doc/
// asciicast-v2.md), open-source, and replayable by every existing
// asciinema viewer (terminal `asciinema play`, asciinema.org embeds,
// the `asciinema-player` npm package, etc).
//
// File shape:
//
//   line 1 (header): {"version":2,"width":80,"height":24,"timestamp":<unix>,
//                     "title":"...", "env":{"SHELL":"/bin/zsh","TERM":"..."}}
//   line 2..N:       [<seconds-since-start>, "o", "<bytes>"]
//                    [<seconds-since-start>, "i", "<bytes>"]
//                    [<seconds-since-start>, "r", "<cols>x<rows>"]
//
// The 'r' frames are an asciinema extension some players ignore — we
// emit them anyway so any pt-aware replay tool can reconstruct
// resize events.
//
// Best-effort writes: the recorder never throws into the registry hot
// path. A failed `fs.openSync` just disables itself and logs once.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RecorderOpts {
  dir:       string;
  sessionId: string;
  cols:      number;
  rows:      number;
  shell:     string;
  cwd:       string;
}

export class Recorder {
  private fd:        number | null = null;
  private startedAt: number;
  private closed = false;
  private file:      string;

  constructor(private readonly opts: RecorderOpts) {
    this.startedAt = Date.now();
    this.file = path.join(opts.dir, `${opts.sessionId}.cast`);
    try { fs.mkdirSync(opts.dir, { recursive: true }); } catch { /* noop */ }
    try {
      this.fd = fs.openSync(this.file, 'a');
    } catch (e) {
      console.warn(`[recorder] cannot open ${this.file}:`, (e as Error).message);
      this.fd = null;
      return;
    }

    // Only emit the header if the file is empty — if a session is
    // being resumed we want to append, not duplicate.
    let isEmpty = true;
    try { isEmpty = fs.statSync(this.file).size === 0; } catch { /* noop */ }

    if (isEmpty) {
      const header = {
        version:    2,
        width:      opts.cols,
        height:     opts.rows,
        timestamp:  Math.floor(this.startedAt / 1000),
        title:      `pocket-t ${opts.sessionId}`,
        env: {
          SHELL: opts.shell || '/bin/zsh',
          TERM:  process.env.TERM ?? 'xterm-256color',
        },
        // Custom-but-ignored fields are allowed in v2.
        ['x-pocket-t']: {
          cwd: opts.cwd,
        },
      };
      try {
        fs.writeSync(this.fd, JSON.stringify(header) + '\n');
      } catch (e) {
        console.warn(`[recorder] header write failed:`, (e as Error).message);
      }
    }
  }

  private elapsedSecs(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  /** Append a single record. */
  private writeRecord(kind: 'o' | 'i' | 'r', data: string): void {
    if (this.fd === null || this.closed) return;
    const rec = [this.elapsedSecs(), kind, data];
    try {
      fs.writeSync(this.fd, JSON.stringify(rec) + '\n');
    } catch (e) {
      console.warn(`[recorder] write failed (recorder disabled):`, (e as Error).message);
      try { fs.closeSync(this.fd); } catch { /* noop */ }
      this.fd = null;
    }
  }

  /** PTY output (terminal → user). The vast majority of frames. */
  writeOutput(bytes: Buffer | Uint8Array): void {
    // asciinema strings are UTF-8. A multibyte sequence split across
    // PTY chunks is fine because the player reassembles by concat.
    this.writeRecord('o', Buffer.from(bytes).toString('utf-8'));
  }

  /** User input (keyboard → terminal). Useful for analytics and a
   *  faithful replay of "what did the user type." */
  writeInput(bytes: Buffer | Uint8Array): void {
    this.writeRecord('i', Buffer.from(bytes).toString('utf-8'));
  }

  /** Resize event. */
  writeResize(cols: number, rows: number): void {
    this.writeRecord('r', `${cols}x${rows}`);
  }

  /** Flush + close. Safe to call multiple times. */
  close(_exitCode?: number): void {
    if (this.closed) return;
    this.closed = true;
    if (this.fd === null) return;
    try { fs.fsyncSync(this.fd); } catch { /* noop */ }
    try { fs.closeSync(this.fd); } catch { /* noop */ }
    this.fd = null;
  }

  /** Where the file lives. */
  get path(): string { return this.file; }
}
