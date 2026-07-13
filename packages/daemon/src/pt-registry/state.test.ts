import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readState,
  writeStateAtomic,
  pidAlive,
  acquireInstanceLock,
  releaseInstanceLock,
  STATE_VERSION,
  type PersistedSession,
} from './state.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pt-state-'));
}

function sampleSession(over: Partial<PersistedSession> = {}): PersistedSession {
  return {
    sessionId:    'abc-123',
    cwd:          '/Users/x/proj',
    pid:          4242,
    rows:         40,
    cols:         120,
    shell:        '/bin/zsh',
    vendor:       'claude',
    registeredAt: 1_000,
    lastActiveAt: 2_000,
    detached:     false,
    detachedAt:   null,
    exitCode:     null,
    tmux:         false,
    ...over,
  };
}

describe('registry persistence (state.json)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = tmpDir(); file = path.join(dir, 'state.json'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('round-trips sessions through an atomic write', () => {
    const sessions = [sampleSession(), sampleSession({ sessionId: 'def-456', vendor: null })];
    writeStateAtomic(file, sessions);
    const loaded = readState(file);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(STATE_VERSION);
    expect(loaded!.sessions).toHaveLength(2);
    expect(loaded!.sessions[0]).toEqual(sessions[0]);
    expect(loaded!.sessions[1].vendor).toBeNull();
  });

  it('leaves no .tmp file behind and writes owner-only (0600)', () => {
    writeStateAtomic(file, [sampleSession()]);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('a second write fully replaces the first (no stale merge)', () => {
    writeStateAtomic(file, [sampleSession({ sessionId: 'one' })]);
    writeStateAtomic(file, [sampleSession({ sessionId: 'two' })]);
    const loaded = readState(file);
    expect(loaded!.sessions.map(s => s.sessionId)).toEqual(['two']);
  });

  it('returns null for a missing file (fresh install → empty catalog)', () => {
    expect(readState(path.join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for corrupt JSON rather than throwing', () => {
    fs.writeFileSync(file, '{ this is not json');
    expect(readState(file)).toBeNull();
  });

  it('ignores a state file written by a different version', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 999, savedAt: 0, sessions: [sampleSession()] }));
    expect(readState(file)).toBeNull();
  });

  it('drops individually-malformed session entries but keeps valid ones', () => {
    fs.writeFileSync(file, JSON.stringify({
      version:  STATE_VERSION,
      savedAt:  0,
      sessions: [sampleSession({ sessionId: 'good' }), { junk: true }, null, 'nope'],
    }));
    const loaded = readState(file);
    expect(loaded!.sessions.map(s => s.sessionId)).toEqual(['good']);
  });

  it('round-trips a VT snapshot and a bounded event tail', () => {
    const events = [
      { kind: 'chat', role: 'assistant', text: 'hi' },
      { kind: 'cost', cumulativeCostUSD: 0.42 },
    ];
    writeStateAtomic(file, [sampleSession({
      sessionId: 'snap-1',
      snapshot:  '\x1b[2J\x1b[Hrestored screen',
      events,
    })]);
    const loaded = readState(file);
    expect(loaded!.sessions[0].snapshot).toBe('\x1b[2J\x1b[Hrestored screen');
    expect(loaded!.sessions[0].events).toEqual(events);
  });

  it('a session without snapshot/events round-trips with them absent', () => {
    writeStateAtomic(file, [sampleSession({ sessionId: 'no-snap' })]);
    const s = readState(file)!.sessions[0];
    expect(s.snapshot).toBeUndefined();
    expect(s.events).toBeUndefined();
  });
});

describe('single-instance lock', () => {
  let dir: string;
  let lock: string;
  beforeEach(() => { dir = tmpDir(); lock = path.join(dir, 'daemon.lock'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('acquires a free lock and writes our pid', () => {
    expect(acquireInstanceLock(lock)).toBeNull();
    expect(fs.readFileSync(lock, 'utf8').trim()).toBe(String(process.pid));
    expect(fs.statSync(lock).mode & 0o777).toBe(0o600);
  });

  it('reports a live holder (a different live process) and does not steal the lock', () => {
    // The parent process is alive and has a pid distinct from ours — stands
    // in for a first daemon already holding the lock.
    fs.writeFileSync(lock, String(process.ppid));
    expect(acquireInstanceLock(lock)).toBe(process.ppid);
    // Left intact — we never overwrite a live holder's lock.
    expect(fs.readFileSync(lock, 'utf8').trim()).toBe(String(process.ppid));
  });

  it('reclaims a stale lock left by a dead process', () => {
    fs.writeFileSync(lock, '2147400000'); // almost-certainly-dead pid
    expect(acquireInstanceLock(lock)).toBeNull();
    expect(fs.readFileSync(lock, 'utf8').trim()).toBe(String(process.pid));
  });

  it('reclaims an unreadable / empty lock file', () => {
    fs.writeFileSync(lock, '');
    expect(acquireInstanceLock(lock)).toBeNull();
    expect(fs.readFileSync(lock, 'utf8').trim()).toBe(String(process.pid));
  });

  it('release removes only our own lock', () => {
    acquireInstanceLock(lock);
    releaseInstanceLock(lock);
    expect(fs.existsSync(lock)).toBe(false);

    // A lock owned by a different (live) pid is left untouched.
    fs.writeFileSync(lock, String(process.pid + 1));
    releaseInstanceLock(lock);
    expect(fs.existsSync(lock)).toBe(true);
  });
});

describe('pidAlive', () => {
  it('reports the current process as alive', () => {
    expect(pidAlive(process.pid)).toBe(true);
  });

  it('reports an almost-certainly-dead pid as not alive', () => {
    // A very high pid that no process realistically holds. If by cosmic
    // chance it exists, pidAlive returns true — accept either but assert
    // the common case; the function must at minimum not throw.
    const result = pidAlive(2_147_400_000);
    expect(typeof result).toBe('boolean');
    expect(result).toBe(false);
  });

  it('treats non-positive / non-integer pids as not alive', () => {
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(NaN)).toBe(false);
  });
});
