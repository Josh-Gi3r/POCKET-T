import { writable, get } from 'svelte/store';
import { PTConnection } from './connection';
import { appendBubble, resetSession } from './bubbles';
import type { BubbleEvent, ConnStatus, CostState, EventEnvelope, SessionInfo } from './types';

export const status = writable<ConnStatus>('connecting');
export const sessions = writable<SessionInfo[]>([]);
export const current = writable<string | null>(null);
export const bubbles = writable<Record<string, BubbleEvent[]>>({});
export const cost = writable<Record<string, CostState>>({});

// Terminal sink — the lazy-loaded TerminalView registers write/snapshot/reset
// callbacks here so raw STDOUT/SNAPSHOT_VT frames reach xterm only when the
// terminal tab is actually mounted. Until then, stdout is simply dropped
// (bubbles are the primary view; the terminal replays via snapshot on attach).
interface TermSink {
  write(bytes: Uint8Array): void;
  snapshot(text: string): void;
}
let termSink: TermSink | null = null;
export function setTermSink(sink: TermSink | null): void {
  termSink = sink;
}

const sessionMap = new Map<string, SessionInfo>();

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
  onStatus: (s) => status.set(s),
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
      // Auto-attach the first session we learn about so a fresh load lands
      // somewhere useful. Prefer a previously-open session across reloads.
      if (get(current) === null) {
        const saved = readSaved();
        if (saved && env.session.sessionId === saved) attach(saved);
        else if (!saved) attach(env.session.sessionId);
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

export function spawnSession(cwd?: string): void {
  conn.spawnSession(cwd);
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
