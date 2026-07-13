import { describe, expect, it } from 'vitest';
import { OutboundQueue } from './outbound';

describe('OutboundQueue', () => {
  it('flushes buffered items in FIFO order', () => {
    const q = new OutboundQueue<string>();
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    expect(q.size).toBe(3);

    const sent: string[] = [];
    q.flush((x) => sent.push(x));
    expect(sent).toEqual(['a', 'b', 'c']);
    expect(q.size).toBe(0);
  });

  it('is empty after flush so a second flush sends nothing', () => {
    const q = new OutboundQueue<number>();
    q.enqueue(1);
    q.flush(() => {});
    const sent: number[] = [];
    q.flush((x) => sent.push(x));
    expect(sent).toEqual([]);
  });

  it('drops the oldest item once the bound is exceeded', () => {
    const q = new OutboundQueue<number>(3);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    q.enqueue(4); // evicts 1
    const sent: number[] = [];
    q.flush((x) => sent.push(x));
    expect(sent).toEqual([2, 3, 4]);
  });

  it('drains before send so a re-entrant enqueue is not replayed twice', () => {
    const q = new OutboundQueue<string>();
    q.enqueue('first');
    const sent: string[] = [];
    q.flush((x) => {
      sent.push(x);
      if (x === 'first') q.enqueue('reentrant'); // e.g. produced during flush
    });
    // The re-entrant item stays buffered for the next flush, not sent now.
    expect(sent).toEqual(['first']);
    expect(q.size).toBe(1);
  });

  it('clear() empties the buffer', () => {
    const q = new OutboundQueue<string>();
    q.enqueue('x');
    q.clear();
    expect(q.size).toBe(0);
  });
});
