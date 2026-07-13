import { describe, expect, it } from 'vitest';
import { appendBubble, resetSession, type BubbleMap } from './bubbles';
import type { BubbleEvent } from './types';

const chat = (text: string): BubbleEvent => ({ kind: 'chat', role: 'assistant', text });

/** Simulate the daemon replaying a session's full event history on SUBSCRIBE. */
function replay(map: BubbleMap, sessionId: string, history: BubbleEvent[]): BubbleMap {
  let next = map;
  for (const ev of history) next = appendBubble(next, sessionId, ev);
  return next;
}

describe('bubble reconnect reducers', () => {
  const sid = 's-1';
  const history = [chat('one'), chat('two'), chat('three')];

  it('builds the list on first connect', () => {
    const map = replay({}, sid, history);
    expect(map[sid]).toHaveLength(3);
    expect(map[sid].map((b) => b.text)).toEqual(['one', 'two', 'three']);
  });

  it('reconnect that resets-then-replays does NOT duplicate history', () => {
    // first connect
    let map = replay({}, sid, history);
    expect(map[sid]).toHaveLength(3);

    // auto-reconnect: clear the session, then the daemon replays the same
    // history in response to the re-SUBSCRIBE.
    map = resetSession(map, sid);
    expect(map[sid]).toHaveLength(0);
    map = replay(map, sid, history);

    expect(map[sid]).toHaveLength(3);
  });

  it('reconnect that replays WITHOUT resetting doubles the history', () => {
    // Guards the fix: this is the failure mode we are preventing. Skipping
    // the reset before replay is exactly what caused unbounded growth.
    let map = replay({}, sid, history);
    map = replay(map, sid, history); // no reset
    expect(map[sid]).toHaveLength(6);
  });

  it('repeated reconnects stay bounded when each resets first', () => {
    let map = replay({}, sid, history);
    for (let i = 0; i < 20; i++) {
      map = resetSession(map, sid);
      map = replay(map, sid, history);
    }
    expect(map[sid]).toHaveLength(3);
  });

  it('resetSession leaves other sessions untouched', () => {
    let map = replay({}, 's-1', [chat('a')]);
    map = replay(map, 's-2', [chat('b'), chat('c')]);
    map = resetSession(map, 's-1');
    expect(map['s-1']).toHaveLength(0);
    expect(map['s-2']).toHaveLength(2);
  });

  it('appendBubble returns a new map and does not mutate the input', () => {
    const before: BubbleMap = { [sid]: [chat('x')] };
    const after = appendBubble(before, sid, chat('y'));
    expect(before[sid]).toHaveLength(1);
    expect(after[sid]).toHaveLength(2);
    expect(after).not.toBe(before);
  });
});
