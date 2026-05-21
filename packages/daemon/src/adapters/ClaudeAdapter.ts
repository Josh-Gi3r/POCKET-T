// ClaudeAdapter — tails Claude Code's JSONL transcript and emits typed
// BubbleEvents. Successor to agent/ClaudeTranscript.ts: same tail
// mechanics, richer event vocabulary (chat / thought / action /
// tool_result / cost) suitable for bubble UI rendering.
//
// Why tail the JSONL instead of scraping the TUI:
//   - Claude Code uses alt-screen + cursor positioning; scraping the
//     pane gives spinner + box glyphs + redraws, not a clean stream.
//   - The JSONL is the agent's own source of truth — exact role,
//     content, tool calls, and per-turn token usage.
//   - It survives screen redraws, doesn't need ANSI parsing, and
//     contains structured fields we can map 1:1 to bubbles.
//
// File location:
//   ~/.claude/projects/<slug-of-cwd>/<session-uuid>.jsonl

import { EventEmitter } from 'node:events';
import {
  existsSync, readdirSync, statSync, createReadStream,
} from 'node:fs';
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import type { Adapter, BubbleEvent } from './Adapter.js';
import { costOfUsage } from './pricing.js';

const PROJECTS = join(os.homedir(), '.claude', 'projects');

export function projectDirForCwd(cwd: string): string | null {
  if (!cwd) return null;
  // Claude Code's slug rule: every non-alphanumeric becomes '-'.
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = join(PROJECTS, slug);
  return existsSync(dir) ? dir : null;
}

function newestTranscript(dir: string): { path: string; mtime: number } | null {
  let best: { path: string; mtime: number } | null = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      const st = statSync(join(dir, f));
      if (!best || st.mtimeMs > best.mtime) {
        best = { path: join(dir, f), mtime: st.mtimeMs };
      }
    } catch { /* race */ }
  }
  return best;
}

/** Has Claude written something for this cwd within the last `withinMs`?
 *  Used by detect.ts to decide whether to bind a ClaudeAdapter. */
export function hasActiveTranscript(cwd: string, withinMs = 30_000): boolean {
  const dir = projectDirForCwd(cwd);
  if (!dir) return false;
  const t = newestTranscript(dir);
  return !!t && Date.now() - t.mtime < withinMs;
}

// Claude content blocks (Anthropic message format).
interface Block {
  type:      string;
  text?:     string;
  thinking?: string;
  name?:     string;
  input?:    unknown;
  id?:       string;
  tool_use_id?: string;
  content?:  unknown;
}

interface Rec {
  type?:    string;
  message?: {
    role?:    string;
    content?: unknown;
    model?:   string;
    usage?: {
      input_tokens?:               number;
      output_tokens?:              number;
      cache_read_input_tokens?:    number;
      cache_creation_input_tokens?: number;
    };
  };
  timestamp?: string;
}

export class ClaudeAdapter extends EventEmitter implements Adapter {
  readonly vendor = 'claude';

  private file:    string | null = null;
  private offset = 0;
  private buf    = '';
  private watcher: FSWatcher | null = null;
  private rescan:  ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private cumulativeCostUSD = 0;

  constructor(private readonly cwd: string) { super(); }

  start(): boolean {
    const dir = projectDirForCwd(this.cwd);
    if (!dir) return false;
    const t = newestTranscript(dir);
    if (!t) return false;
    this.file = t.path;
    // Forward-only tail: we don't replay all prior conversation
    // (would flood the browser with stale bubbles). Newly-attaching
    // browsers get the terminal SNAPSHOT_VT instead, which captures
    // the current visible TUI state.
    try { this.offset = statSync(this.file).size; } catch { this.offset = 0; }
    this.attachWatcher();
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
    } catch { /* fall back to rescan poll */ }
    this.drain();
  }

  private maybeSwitch(dir: string): void {
    if (this.stopped) return;
    const t = newestTranscript(dir);
    if (t && t.path !== this.file) {
      // A new `claude` run in the same cwd writes a fresh transcript.
      this.file   = t.path;
      this.offset = 0;
      this.buf    = '';
      this.cumulativeCostUSD = 0;
      this.attachWatcher();
    } else {
      this.drain();
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
    rs.on('data',  (d) => { got += d; });
    rs.on('error', (e) => this.emit('error', e));
    rs.on('end',   () => {
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
    for (const ev of this.recordToEvents(rec)) {
      this.emit('event', ev);
    }
  }

  // Pure mapping — exported via a static helper for unit testing.
  recordToEvents(rec: Rec): BubbleEvent[] {
    const role    = rec.message?.role;
    const ts      = rec.timestamp ? Date.parse(rec.timestamp) : Date.now();
    const isUser  = rec.type === 'user'      || role === 'user';
    const isAsst  = rec.type === 'assistant' || role === 'assistant';
    if (!isUser && !isAsst) return [];

    const content = rec.message?.content;
    const out: BubbleEvent[] = [];

    // Cost: each assistant turn carries a `usage` block.
    if (isAsst && rec.message?.usage) {
      const u = rec.message.usage;
      const turnCost = costOfUsage(rec.message?.model, u);
      this.cumulativeCostUSD += turnCost;
      out.push({
        kind:               'cost',
        model:              rec.message?.model,
        inputTokens:        u.input_tokens,
        outputTokens:       u.output_tokens,
        cacheReadTokens:    u.cache_read_input_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens,
        turnCostUSD:        turnCost,
        cumulativeCostUSD:  this.cumulativeCostUSD,
        timestamp:          ts,
      });
    }

    // String content (rare — usually it's an array of blocks).
    if (typeof content === 'string') {
      const t = content.trim();
      if (t) {
        out.push({
          kind:      'chat',
          role:      isUser ? 'user' : 'assistant',
          text:      t,
          timestamp: ts,
        });
      }
      return out;
    }
    if (!Array.isArray(content)) return out;

    for (const b of content as Block[]) {
      if (!b || typeof b !== 'object') continue;
      switch (b.type) {
        case 'text': {
          const t = (b.text ?? '').trim();
          if (!t) break;
          out.push({
            kind:      'chat',
            role:      isUser ? 'user' : 'assistant',
            text:      t,
            timestamp: ts,
          });
          break;
        }
        case 'thinking': {
          const t = (b.thinking ?? b.text ?? '').toString().trim();
          if (!t) break;
          out.push({
            kind:      'thought',
            role:      'assistant',
            text:      t,
            timestamp: ts,
          });
          break;
        }
        case 'tool_use': {
          out.push({
            kind:       'action',
            role:       'assistant',
            tool:       b.name ?? 'tool',
            parameters: (b.input && typeof b.input === 'object')
              ? b.input as Record<string, unknown>
              : { value: b.input },
            toolUseId:  b.id,
            timestamp:  ts,
          });
          break;
        }
        case 'tool_result': {
          const text = typeof b.content === 'string'
            ? b.content
            : Array.isArray(b.content)
              ? (b.content as Block[]).map(x => x?.text ?? '').join('').trim()
              : '';
          out.push({
            kind:       'tool_result',
            role:       isUser ? 'user' : 'assistant',
            toolUseId:  b.tool_use_id,
            output:     text,
            timestamp:  ts,
          });
          break;
        }
        case 'image':
          out.push({
            kind:      'chat',
            role:      isUser ? 'user' : 'assistant',
            text:      '🖼 [image]',
            timestamp: ts,
          });
          break;
        default:
          // Unknown block types are intentionally dropped.
          break;
      }
    }
    return out;
  }
}
