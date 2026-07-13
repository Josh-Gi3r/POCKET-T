import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { writeStateAtomic, readState, type PersistedSession } from './state.js';

// Match server.ts: the xterm headless packages ship as CommonJS.
const _require = createRequire(import.meta.url);
const HeadlessTerminal = _require('@xterm/headless').Terminal;
const SerializeAddon = _require('@xterm/addon-serialize').SerializeAddon;

interface HeadlessLike {
  loadAddon(a: unknown): void;
  write(data: string | Uint8Array, cb?: () => void): void;
  dispose(): void;
}
interface SerializerLike {
  serialize(opts?: { scrollback?: number }): string;
}

/** Drive a headless terminal and resolve once every write has drained, so
 *  serialize() sees the final screen (xterm writes are async). */
function newTerminal(cols = 80, rows = 24): { term: HeadlessLike; ser: SerializerLike } {
  const term = new HeadlessTerminal({ cols, rows, scrollback: 2000, allowProposedApi: true }) as HeadlessLike;
  const ser = new SerializeAddon() as SerializerLike;
  term.loadAddon(ser);
  return { term, ser };
}

function write(term: HeadlessLike, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function baseSession(over: Partial<PersistedSession> = {}): PersistedSession {
  return {
    sessionId: 's1', cwd: '/x', pid: 1, rows: 24, cols: 80, shell: '/bin/zsh',
    vendor: 'claude', registeredAt: 1, lastActiveAt: 2, detached: true,
    detachedAt: 3, exitCode: null, tmux: false, ...over,
  };
}

describe('rehydrate replay (snapshot + events)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-rehy-')); file = path.join(dir, 'state.json'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('a persisted VT snapshot repaints a fresh terminal on rehydrate', async () => {
    // 1) A live session draws to its screen; we serialize the frame the way
    //    the daemon persists it.
    const live = newTerminal();
    await write(live.term, 'user@mac ~ % claude\r\nThinking about your request…\r\n');
    const snapshot = live.ser.serialize({ scrollback: 200 });
    live.term.dispose();
    expect(snapshot.length).toBeGreaterThan(0);

    const events = [
      { kind: 'chat', role: 'assistant', text: 'On it.' },
      { kind: 'cost', cumulativeCostUSD: 0.1234 },
    ];
    writeStateAtomic(file, [baseSession({ snapshot, events })]);

    // 2) Daemon restarts: read state, build a fresh terminal, replay the
    //    snapshot into it (exactly what addRehydratedSession does).
    const loaded = readState(file);
    const ps = loaded!.sessions[0];
    expect(ps.snapshot).toBe(snapshot);

    const restored = newTerminal();
    await write(restored.term, ps.snapshot as string);
    const repainted = restored.ser.serialize({ scrollback: 200 });
    restored.term.dispose();

    // The re-attaching browser is painted the last frame, not a blank.
    expect(repainted).toContain('claude');
    expect(repainted).toContain('Thinking about your request');

    // 3) Events (recent bubbles + cost) survive for the Events replay path.
    expect(ps.events).toEqual(events);
    const costEvent = (ps.events as Array<{ kind: string; cumulativeCostUSD?: number }>)
      .find((e) => e.kind === 'cost');
    expect(costEvent?.cumulativeCostUSD).toBe(0.1234);
  });

  it('rehydrate of a session with no snapshot yields a blank replay (no crash)', async () => {
    writeStateAtomic(file, [baseSession({ sessionId: 'blank' })]);
    const ps = readState(file)!.sessions[0];
    expect(ps.snapshot).toBeUndefined();

    // The daemon guards on meta.snapshot before writing; nothing to replay.
    const restored = newTerminal();
    if (ps.snapshot) await write(restored.term, ps.snapshot);
    const out = restored.ser.serialize({ scrollback: 200 });
    restored.term.dispose();
    expect(out).toBe('');
  });
});
