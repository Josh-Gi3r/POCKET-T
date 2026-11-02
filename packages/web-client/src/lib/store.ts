import { writable, get } from 'svelte/store';
import { PTConnection } from './connection';
import { appendBubble, resetSession } from './bubbles';
import type { ApprovedApp, AppLaunchResult, BubbleEvent, ConnStatus, CostState, DirectoryListing, EventEnvelope, ExistingTerminal, FileRoot, FileState, SessionInfo } from './types';

export const status = writable<ConnStatus>('connecting');
export const sessions = writable<SessionInfo[]>([]);
export const current = writable<string | null>(null);
export const bubbles = writable<Record<string, BubbleEvent[]>>({});
export const cost = writable<Record<string, CostState>>({});
export const existingTerminals = writable<ExistingTerminal[]>([]);
export const joinState = writable<{
  status: 'idle' | 'joining' | 'ready' | 'error';
  requestId: string;
  joinedSessionId: string | null;
  message: string;
}>({ status: 'idle', requestId: '', joinedSessionId: null, message: '' });
export const spawnState = writable<{
  status: 'idle' | 'starting' | 'ready' | 'error';
  requestId: string;
  sessionId: string | null;
  message: string;
}>({ status: 'idle', requestId: '', sessionId: null, message: '' });

export const fileRoots = writable<FileRoot[]>([]);
export const fileState = writable<FileState>({ requestId: '', loading: false, listing: null, error: null });
export const approvedApps = writable<ApprovedApp[]>([]);
export const appLaunch = writable<AppLaunchResult | null>(null);
let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return 'req' + Date.now().toString(36) + '_' + requestCounter.toString(36);
}


// Only the currently selected live xterm receives PTY frames. A newly
// mounted terminal requests the current VT snapshot to restore real state.
interface TermSink {
  write(bytes: Uint8Array): void;
  snapshot(text: string): void;
}
let termSink: TermSink | null = null;
export function setTermSink(sink: TermSink | null): void {
  termSink = sink;
}

const sessionMap = new Map<string, SessionInfo>();
let restoredSaved = false;

function refreshSessionList(): void {
  sessions.set([...sessionMap.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
}

function pushBubble(sessionId: string, ev: BubbleEvent): void {
  bubbles.update((b) => appendBubble(b, sessionId, ev));
}

function clearBubbles(sessionId: string): void {
  bubbles.update((b) => resetSession(b, sessionId));
  cost.update((c) => {
    const next = { ...c };
    delete next[sessionId];
    return next;
  });
}

export const conn = new PTConnection({
  onStatus: (s) => {
    status.set(s);
    if (s !== 'open') {
      joinState.update((state) => state.status === 'joining'
        ? { ...state, status: 'error', message: 'Connection lost before the join completed' }
        : state);
      spawnState.update((state) => state.status === 'starting'
        ? { ...state, status: 'error', message: 'Connection lost before the new shell registered' }
        : state);
    }
  },
  onStdout: (sessionId, bytes) => {
    if (sessionId === get(current)) termSink?.write(bytes);
  },
  onSnapshot: (sessionId, text) => {
    if (sessionId === get(current)) termSink?.snapshot(text);
  },
  onEvent: (sessionId, json) => handleEvent(sessionId, json as EventEnvelope),
  // On every auto-reconnect the daemon replays the session's full event
  // history in response to our re-SUBSCRIBE. Clear the local bubble list
  // first so the replay rebuilds it instead of appending a second copy.
  onResync: (sessionId) => clearBubbles(sessionId),
});

function handleEvent(frameSessionId: string, env: EventEnvelope): void {
  if (!env || typeof env !== 'object') return;
  switch (env.kind) {
    case 'sessionAdded':
    case 'sessionUpdated': {
      sessionMap.set(env.session.sessionId, env.session);
      refreshSessionList();
      // Join is complete only after a real pt-shim REGISTER, not merely
      // because macOS accepted a spawn request.
      const joining = get(joinState);
      if (joining.status === 'joining' && joining.joinedSessionId === env.session.sessionId) {
        attach(env.session.sessionId);
        joinState.set({ ...joining, status: 'ready', message: 'Joined existing tmux session' });
        break;
      }
      const starting = get(spawnState);
      if (starting.status === 'starting' && starting.sessionId === env.session.sessionId) {
        attach(env.session.sessionId);
        spawnState.set({ ...starting, status: 'ready', message: 'Terminal ready' });
        break;
      }
      // Prefer restoring the previous selection, but don't leave the UI
      // permanently blank when that old session no longer exists.
      const saved = readSaved();
      if (!get(current)) attach(env.session.sessionId);
      else if (saved && saved === env.session.sessionId && get(current) !== saved && !restoredSaved) {
        restoredSaved = true;
        attach(saved);
      }
      break;
    }
    case 'sessionRemoved': {
      sessionMap.delete(env.sessionId);
      refreshSessionList();
      if (get(current) === env.sessionId) {
        current.set(null);
        try {
          localStorage.removeItem('pt-session');
        } catch {
          /* private mode */
        }
      }
      break;
    }
    case 'existingTerminals': {
      existingTerminals.set(env.sessions);
      break;
    }
    case 'spawnSessionResult': {
      const pending = get(spawnState);
      if (pending.status !== 'starting' || pending.requestId !== env.requestId) break;
      if (!env.ok || !env.sessionId) {
        spawnState.set({ ...pending, status: 'error', message: env.message ?? 'Unable to open shell' });
        break;
      }
      const next = { ...pending, sessionId: env.sessionId };
      if (sessionMap.has(env.sessionId)) {
        attach(env.sessionId);
        spawnState.set({ ...next, status: 'ready', message: 'Terminal ready' });
      } else spawnState.set(next);
      break;
    }
    case 'joinExistingTmuxResult': {
      const pending = get(joinState);
      if (pending.requestId !== env.requestId || pending.status !== 'joining') break;
      if (!env.ok || !env.joinedSessionId) {
        joinState.set({ ...pending, status: 'error', message: env.message ?? 'Unable to join tmux' });
        break;
      }
      const next = { ...pending, joinedSessionId: env.joinedSessionId };
      // Registration can arrive before the spawn acknowledgement.
      if (sessionMap.has(env.joinedSessionId)) {
        attach(env.joinedSessionId);
        joinState.set({ ...next, status: 'ready', message: 'Joined existing tmux session' });
      } else joinState.set(next);
      break;
    }
    case 'fileRoots': {
      fileRoots.set(env.roots);
      break;
    }
    case 'fileListing': {
      fileState.update((state) => state.requestId === env.requestId
        ? { requestId: env.requestId, loading: false, listing: env.listing, error: null } : state);
      break;
    }
    case 'fileBrowseError': {
      fileState.update((state) => state.requestId === env.requestId
        ? { ...state, loading: false, error: env.message } : state);
      break;
    }
    case 'approvedApps': {
      approvedApps.set(env.apps);
      break;
    }
    case 'appLaunchResult': {
      appLaunch.set({ requestId: env.requestId, ok: env.ok, message: env.message });
      break;
    }
    case 'bubble': {
      const ev = env.event;
      if (ev.kind === 'cost') {
        cost.update((c) => ({
          ...c,
          [env.sessionId]: { cumulativeCostUSD: ev.cumulativeCostUSD, model: ev.model },
        }));
      } else {
        pushBubble(env.sessionId, ev);
      }
      // Approval prompts buzz the device regardless of which session is open.
      if (ev.kind === 'approval' && ev.approvalId && !/^[✓✗]/.test(ev.text ?? '')) {
        fireNotification(ev);
      }
      break;
    }
    default:
      break;
  }
}

export function attach(sessionId: string): void {
  if (get(current) === sessionId) return;
  current.set(sessionId);
  clearBubbles(sessionId); // daemon replays history on SUBSCRIBE
  try {
    localStorage.setItem('pt-session', sessionId);
  } catch {
    /* private mode */
  }
  conn.attach(sessionId);
}

/** Ask the daemon to re-send the VT snapshot + event history for the
 *  current session. Clears local bubbles first so the replay repopulates
 *  cleanly (no duplicates). Called when the Terminal tab mounts late. */
export function requestResync(): void {
  const c = get(current);
  if (!c) return;
  clearBubbles(c);
  conn.resubscribe();
}

export function resolveApproval(sessionId: string, approvalId: string, decision: 'approve' | 'deny'): void {
  conn.resolveApproval(sessionId, approvalId, decision);
}

/** Metadata-only, explicitly opt-in local filesystem browsing. */
export function fetchFileRoots(): void {
  conn.sendJsonEvent('', { kind: 'listFileRoots' });
}

export function browseFolder(rootId: string, relativePath: string): void {
  const requestId = nextRequestId();
  fileState.set({ requestId, loading: true, listing: null, error: null });
  conn.sendJsonEvent('', { kind: 'browseFiles', requestId, rootId, relativePath });
}

export function fetchApprovedApps(): void {
  conn.sendJsonEvent('', { kind: 'listApprovedApps' });
}

export function requestAppLaunch(bundleId: string): string {
  const requestId = nextRequestId();
  appLaunch.set(null);
  conn.sendJsonEvent('', { kind: 'launchApprovedApp', requestId, bundleId });
  return requestId;
}

export function discoverExistingTerminals(): void {
  conn.sendJsonEvent('', { kind: 'discoverExistingTerminals' });
}

/** Join a real, pre-existing tmux session; do not create a new shell. */
export function joinExistingTmux(existingSessionId: string): void {
  if (get(status) !== 'open' || get(joinState).status === 'joining') return;
  const requestId = nextRequestId();
  joinState.set({ status: 'joining', requestId, joinedSessionId: null, message: '' });
  conn.sendJsonEvent('', { kind: 'joinExistingTmux', sessionId: existingSessionId, requestId });
  // A spawned process can fail before it registers. No fake success state.
  setTimeout(() => {
    joinState.update((state) => state.requestId === requestId && state.status === 'joining'
      ? { ...state, status: 'error', message: 'The tmux client did not register. Check the Mac daemon and pt installation.' }
      : state);
  }, 15_000);
}

export function spawnSession(cwd?: string): void {
  if (get(status) !== 'open' || get(spawnState).status === 'starting') return;
  const requestId = nextRequestId();
  spawnState.set({ status: 'starting', requestId, sessionId: null, message: '' });
  conn.spawnSession(cwd, requestId);
  setTimeout(() => {
    spawnState.update((state) => state.requestId === requestId && state.status === 'starting'
      ? { ...state, status: 'error', message: 'Native terminal did not register; check the Mac helper and daemon.' }
      : state);
  }, 15_000);
}

export function killSession(sessionId: string): void {
  conn.killSession(sessionId);
}

function readSaved(): string | null {
  try {
    return localStorage.getItem('pt-session');
  } catch {
    return null;
  }
}

function fireNotification(ev: BubbleEvent): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const body = (ev.tool ? `${ev.tool} — ` : '') + (ev.text ?? 'tool wants to run');
    new Notification('pocket-t · approval needed', { body, tag: ev.approvalId });
  } catch {
    /* notifications unsupported */
  }
}
