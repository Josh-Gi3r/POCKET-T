// Claude Code writes a structured, append-only JSONL transcript per session
// to ~/.claude/projects/<cwd-slug>/<sessionUuid>.jsonl. That file already
// contains clean user / assistant / tool turns — the exact data a chat UI
// wants. Tailing it gives a faithful conversation WITHOUT scraping Claude
// Code's redrawing TUI (the source of the spinner/box/ANSI garbage) and
// WITHOUT changing how the user launches `claude` (no wrapper).
//
// This is display only. Live tool approvals stay on the hook path
// (HookServer :7621); typed input stays on the existing pane-stdin path.

import { EventEmitter } from 'node:events';
import {
  existsSync, readdirSync, statSync, createReadStream,
} from 'node:fs';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const PROJECTS = join(os.homedir(), '.claude', 'projects');

// Claude Code slugifies the cwd by replacing every non-alphanumeric char
// with '-' (verified against on-disk dirs, e.g. `/Users/josh` →
// `-Users-josh`, `/Users/josh/Desktop/sera-crm (1)` →
// `-Users-josh-Desktop-sera-crm--1-`).
export function projectDirForCwd(cwd: string): string | null {
  if (!cwd) return null;
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = join(PROJECTS, slug);
  return existsSync(dir) ? dir : null;
}

// The session Claude is actively writing = newest *.jsonl in the project
// dir. (A new `claude` run in the same cwd creates a newer file; we follow
// the freshest.)
function newestTranscript(dir: string, minMtimeMs = 0): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      const st = statSync(join(dir, f));
      const m = st.mtimeMs;
      if (m < minMtimeMs) continue;
      if (!best || m > best.mtime) best = { path: join(dir, f), mtime: m };
    } catch { /* race: file vanished */ }
  }
  return best;
}

/** Is there a *recently active* Claude transcript for this cwd? */
export function hasActiveTranscript(cwd: string, withinMs = 20_000): boolean {
  const dir = projectDirForCwd(cwd);
  if (!dir) return false;
  const t = newestTranscript(dir);
  return !!t && Date.now() - t.mtime < withinMs;
}

interface Block { type: string; text?: string; name?: string; input?: unknown; }
interface Rec { type?: string; message?: { role?: string; content?: unknown }; }

export class ClaudeTranscript extends EventEmitter {
  // Events: 'chunk' (text: string)  ·  'error' (Error)
  private file: string | null = null;
  private offset = 0;          // bytes consumed
  private buf = '';            // partial-line carry
  private watcher: FSWatcher | null = null;
  private rescan: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly cwd: string, private readonly minMtimeMs = 0) { super(); }

  /** Resolve the active transcript and start tailing forward-only.
   *  Returns false if this cwd has no Claude transcript (caller falls
   *  back to the VT screen path). */
  start(): boolean {
    const dir = projectDirForCwd(this.cwd);
    if (!dir) return false;
    const t = newestTranscript(dir, this.minMtimeMs);
    if (!t) return false;

    this.file = t.path;
    // Forward-only: don't replay the whole history as a flood of bubbles.
    try { this.offset = statSync(this.file).size; } catch { this.offset = 0; }

    this.attachWatcher();
    // A new `claude` run writes a NEW jsonl — poll for a fresher file and
    // switch to it (also covers watchers that miss events on some FS).
    this.rescan = setInterval(() => this.maybeSwitch(dir), 3000);
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.rescan) { clearInterval(this.rescan); this.rescan = null; }
  }

  private attachWatcher(): void {
    if (!this.file) return;
    this.watcher?.close();
    try {
      this.watcher = watch(this.file, () => this.drain());
    } catch { /* fall back to the rescan interval */ }
    this.drain();
  }

  private maybeSwitch(dir: string): void {
    if (this.stopped) return;
    const t = newestTranscript(dir, this.minMtimeMs);
    if (t && t.path !== this.file) {
      this.file = t.path;
      this.offset = 0;          // a fresh session — read it from the top
      this.buf = '';
      this.attachWatcher();
    } else {
      this.drain();             // belt-and-suspenders for missed fs events
    }
  }

  private drain(): void {
    if (this.stopped || !this.file) return;
    let size: number;
    try { size = statSync(this.file).size; } catch { return; }
    if (size <= this.offset) return;

    const rs = createReadStream(this.file, {
      start: this.offset, end: size - 1, encoding: 'utf-8',
    });
    let got = '';
    rs.on('data', (d) => { got += d; });
    rs.on('error', (e) => this.emit('error', e));
    rs.on('end', () => {
      this.offset = size;
      this.buf += got;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });
  }

  private handleLine(line: string): void {
    let rec: Rec;
    try { rec = JSON.parse(line); } catch { return; }
    for (const turn of render(rec)) this.emit('turn', turn);
  }
}

// A typed conversation turn. role/kind drive the phone's bubble styling:
//   role 'user'              → your message (right, accent)
//   role 'cli' kind 'text'   → the agent talking (left, readable prose)
//   role 'cli' kind 'tool-call' → the agent DOING something (action card)
export interface Turn { role: 'user' | 'cli'; kind: 'text' | 'tool-call'; text: string; }

// Exported for unit testing the pure mapping (no fs/tail involved).
// Map one transcript record to typed turns, or [] to skip.
// Deliberately minimal: human turns, assistant prose, one-line tool
// markers. Thinking blocks, tool_result echoes, snapshots and metadata
// are dropped — that noise is exactly what we're escaping.
export function render(rec: Rec): Turn[] {
  const role = rec.message?.role;
  if (rec.type !== 'user' && rec.type !== 'assistant') return [];
  const isUser = role === 'user';
  const content = rec.message?.content;

  if (typeof content === 'string') {
    const t = content.trim();
    if (!t) return [];
    return [{ role: isUser ? 'user' : 'cli', kind: 'text', text: t }];
  }
  if (!Array.isArray(content)) return [];

  // A `user`-role record carrying a tool_result is a tool echo, not a
  // human turn — skip it entirely.
  if (isUser && content.some((b: Block) => b?.type === 'tool_result')) return [];

  const out: Turn[] = [];
  for (const b of content as Block[]) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && b.text?.trim()) {
      out.push({ role: isUser ? 'user' : 'cli', kind: 'text', text: b.text.trim() });
    } else if (b.type === 'tool_use' && b.name) {
      out.push({ role: 'cli', kind: 'tool-call', text: `${b.name}${oneLine(b.input)}` });
    } else if (b.type === 'image') {
      out.push({ role: isUser ? 'user' : 'cli', kind: 'text', text: '🖼 [image]' });
    }
    // thinking / tool_result / anything else → dropped on purpose
  }
  return out;
}

function oneLine(input: unknown): string {
  if (input == null) return '';
  try {
    const o = input as Record<string, unknown>;
    const k = o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.url;
    if (typeof k === 'string') {
      return ` ${k.length > 80 ? k.slice(0, 77) + '…' : k}`;
    }
    const s = JSON.stringify(input);
    return s && s !== '{}' ? ` ${s.length > 80 ? s.slice(0, 77) + '…' : s}` : '';
  } catch { return ''; }
}
