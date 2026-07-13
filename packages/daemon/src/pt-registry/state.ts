// Daemon session-registry persistence.
//
// The pt session catalog lives in an in-memory Map in server.ts and used
// to DIE with the daemon: a `pt-registry serve` restart lost every
// session, and the advertised detach-grace resume was unreachable
// because there was nothing to reattach to.
//
// This module persists the registry to ~/.pocket-t/state.json so the
// daemon can rehydrate the catalog on restart. The PTY itself is owned by
// the `pt` shim process (forkpty), which SURVIVES a daemon restart — so
// on rehydrate we only need to remember the session metadata and re-accept
// the surviving shim when it re-dials the socket with its stable UUID.
//
// Writes are ATOMIC: serialize to <file>.tmp, fsync, then rename() over
// the real file. rename() is atomic on POSIX, so a crash mid-write can
// never leave a half-written state.json that would wipe the catalog.

import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Bump when the on-disk shape changes incompatibly. A state.json written
// by a different version is ignored (treated as "no prior state") rather
// than mis-parsed.
export const STATE_VERSION = 1;

// Private tmux server label backing pocket-t sessions. Kept in sync with
// TMUX_SOCKET_LABEL in packages/pt-shim/src/main.rs. Sessions live on this
// dedicated server so they never collide with the user's own tmux and so
// the registry can enumerate exactly the pocket-t sessions.
export const TMUX_SOCKET = 'pocket-t';
const TMUX_SESSION_PREFIX = 'pocket-t-';

/** Deterministic tmux session name for a pocket-t session id. */
export function tmuxSessionName(sessionId: string): string {
  return `${TMUX_SESSION_PREFIX}${sessionId}`;
}

/** Recover the pocket-t session id from a tmux session name, or null. */
export function sessionIdFromTmuxName(name: string): string | null {
  return name.startsWith(TMUX_SESSION_PREFIX)
    ? name.slice(TMUX_SESSION_PREFIX.length)
    : null;
}

/**
 * List the names of all sessions on the pocket-t tmux server. Returns an
 * empty array when tmux is absent or no server/session exists — the caller
 * treats that as "nothing to rehydrate", never an error.
 */
export function listTmuxSessions(): string[] {
  try {
    const out = execFileSync(
      'tmux',
      ['-L', TMUX_SOCKET, 'list-sessions', '-F', '#{session_name}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Is the tmux session backing this pocket-t session id still alive? */
export function tmuxSessionAlive(sessionId: string): boolean {
  return listTmuxSessions().includes(tmuxSessionName(sessionId));
}

/**
 * Kill the tmux session backing a pocket-t session id — the correct way to
 * end a tmux-backed session, since the shell lives in the tmux server and
 * outlives any attached client. Best-effort: a missing session is a no-op.
 */
export function killTmuxSession(sessionId: string): void {
  try {
    execFileSync(
      'tmux',
      ['-L', TMUX_SOCKET, 'kill-session', '-t', tmuxSessionName(sessionId)],
      { stdio: 'ignore' },
    );
  } catch {
    /* already gone */
  }
}

// A serialized adapter bubble event. Stored loosely (the rich BubbleEvent
// type lives in the adapter layer, above this module); it round-trips
// through JSON untouched and is replayed to a re-attaching browser so the
// conversation and the running cost survive a daemon restart.
export type PersistedEvent = Record<string, unknown>;

// One persisted session. Only the fields we can meaningfully restore
// without the live socket / headless terminal / adapter (all rebuilt at
// runtime). The PID lets us verify on rehydrate that the owning shim is
// still alive before we resurrect the session.
export interface PersistedSession {
  sessionId:    string;
  cwd:          string;
  pid:          number;
  rows:         number;
  cols:         number;
  shell:        string;
  vendor:       string | null;
  registeredAt: number;
  lastActiveAt: number;
  detached:     boolean;
  detachedAt:   number | null;
  exitCode:     number | null;
  // True when the shell runs inside a tmux session (survives shim exit).
  // On rehydrate such sessions are kept alive by tmux liveness rather than
  // the shim pid, since the shim may be long gone while the shell lives on.
  tmux:         boolean;
  // Last serialized VT screen (SerializeAddon output). Writing it back into
  // a fresh headless terminal on rehydrate reproduces the screen, so a
  // browser that re-attaches after a restart is painted the last frame
  // instead of a blank terminal. Absent when no snapshot was captured.
  snapshot?:    string | null;
  // Bounded tail of the adapter event history — the most recent bubbles and
  // the latest cost update — replayed on rehydrate. Capped by the writer.
  events?:      PersistedEvent[];
}

export interface PersistedState {
  version:  number;
  savedAt:  number;
  sessions: PersistedSession[];
}

/**
 * Atomically persist the registry. Writes a sibling temp file, fsyncs it,
 * then renames it over the target — so a reader (or a crash) never sees a
 * partially-written file. Best-effort: a filesystem hiccup must never
 * crash the daemon hot path, so callers wrap this defensively too.
 */
export function writeStateAtomic(stateFile: string, sessions: PersistedSession[]): void {
  const state: PersistedState = {
    version:  STATE_VERSION,
    savedAt:  Date.now(),
    sessions,
  };
  const tmp = `${stateFile}.tmp`;
  // 0600 — the catalog leaks cwd + shell paths; keep it owner-only, matching
  // the rest of ~/.pocket-t.
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, stateFile);
}

/**
 * Load persisted state. Returns null on a missing / unreadable / malformed
 * / wrong-version file — every one of which means "start with an empty
 * catalog", never a crash.
 */
export function readState(stateFile: string): PersistedState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(stateFile, 'utf8');
  } catch {
    return null; // no prior state
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const st = parsed as Partial<PersistedState>;
    if (st.version !== STATE_VERSION) return null;
    if (!Array.isArray(st.sessions)) return null;
    // Shallow-validate each entry; drop anything that isn't a plausible
    // session record so one corrupt entry can't poison the rehydrate.
    const sessions = st.sessions.filter((s): s is PersistedSession =>
      !!s && typeof s === 'object'
      && typeof (s as PersistedSession).sessionId === 'string'
      && typeof (s as PersistedSession).pid === 'number');
    return { version: STATE_VERSION, savedAt: Number(st.savedAt) || 0, sessions };
  } catch {
    return null;
  }
}

/**
 * Acquire a single-instance lock so only one daemon owns the socket
 * catalog at a time. Two daemons sharing ~/.pocket-t would each unlink and
 * re-bind the other's sockets, splitting the session catalog in half.
 *
 * The lock is a pidfile created with O_EXCL (atomic "create only if
 * absent"). If the file already exists we read its pid: a live pid means
 * another daemon is running and we refuse to start; a dead pid means the
 * previous daemon crashed without cleanup, so we reclaim the stale lock.
 *
 * Returns the pid of the live holder when the lock is NOT acquired, or
 * null when the lock is now held by this process.
 */
export function acquireInstanceLock(lockFile: string): number | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, String(process.pid));
      } finally {
        fs.closeSync(fd);
      }
      return null; // lock acquired
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder = 0;
      try {
        holder = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
      } catch {
        holder = 0;
      }
      if (holder && holder !== process.pid && pidAlive(holder)) {
        return holder; // another daemon owns it
      }
      // Stale or unreadable lock — remove it and try to claim it once more.
      try { fs.unlinkSync(lockFile); } catch { /* raced with another reclaim */ }
    }
  }
  // A concurrent starter won the reclaim race; treat as "not ours".
  try {
    const holder = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (holder && holder !== process.pid) return holder;
  } catch { /* gone again */ }
  return null;
}

/** Release a lock previously taken by this process. A no-op if the lock is
 *  missing or now held by someone else, so we never delete a live peer's
 *  lock. */
export function releaseInstanceLock(lockFile: string): void {
  try {
    const holder = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (holder === process.pid) fs.unlinkSync(lockFile);
  } catch {
    /* already gone */
  }
}

/**
 * Is the given pid still a live process? Used on rehydrate to distinguish
 * "the shim survived our restart, resume its session" from "the shim died
 * while we were down, drop the stale entry".
 *
 * kill(pid, 0) sends no signal but performs the existence + permission
 * check: success or EPERM (exists, not ours) → alive; ESRCH → gone.
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
