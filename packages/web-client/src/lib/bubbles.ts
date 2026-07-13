import type { BubbleEvent } from './types';

/**
 * Pure bubble-accumulation reducers, kept side-effect-free so they can be
 * unit-tested in isolation from the Svelte store and the socket transport.
 *
 * The daemon replays a session's full adapter-event history on every
 * SUBSCRIBE, so the browser rebuilds a session's bubble list from scratch
 * each time it (re)subscribes. `resetSession` clears the slate; `appendBubble`
 * grows it. Reconnect resync = resetSession → replayed appendBubble stream,
 * which reproduces the same list rather than doubling it.
 */
export type BubbleMap = Record<string, BubbleEvent[]>;

/** Return a new map with `ev` appended to `sessionId`'s bubble list. */
export function appendBubble(map: BubbleMap, sessionId: string, ev: BubbleEvent): BubbleMap {
  const arr = map[sessionId] ? [...map[sessionId]] : [];
  arr.push(ev);
  return { ...map, [sessionId]: arr };
}

/** Return a new map with `sessionId`'s bubble list emptied, ready for a
 *  fresh SUBSCRIBE replay to repopulate it. */
export function resetSession(map: BubbleMap, sessionId: string): BubbleMap {
  return { ...map, [sessionId]: [] };
}
