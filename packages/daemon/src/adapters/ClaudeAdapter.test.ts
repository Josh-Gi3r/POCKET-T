import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import type { BubbleEvent } from './Adapter.js';

// recordToEvents() is a pure function on Anthropic's transcript record
// shape. We don't need a real transcript file on disk — just hand it
// JSONL-parsed objects and check the typed BubbleEvents it returns.
//
// new ClaudeAdapter('/tmp') is enough to get a recordToEvents() handle —
// start() isn't called here, so no fs watchers / intervals fire.

function map(rec: any): BubbleEvent[] {
  return new ClaudeAdapter('/tmp').recordToEvents(rec);
}

describe('ClaudeAdapter.recordToEvents', () => {
  it('maps a user text block to a chat bubble (role=user)', () => {
    const events = map({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('chat');
    expect(events[0]!.role).toBe('user');
    expect(events[0]!.text).toBe('hi');
  });

  it('maps an assistant thinking block to a thought bubble', () => {
    const events = map({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm…' }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('thought');
    expect(events[0]!.text).toBe('hmm…');
  });

  it('maps tool_use to an action bubble with parameters', () => {
    const events = map({
      type: 'assistant',
      message: { role: 'assistant', content: [{
        type: 'tool_use', name: 'Bash',
        input: { command: 'npm test' }, id: 'tu_1',
      }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('action');
    expect(events[0]!.tool).toBe('Bash');
    expect(events[0]!.parameters).toEqual({ command: 'npm test' });
    expect(events[0]!.toolUseId).toBe('tu_1');
  });

  it('maps tool_result to a tool_result bubble (text content)', () => {
    const events = map({
      type: 'user',
      message: { role: 'user', content: [{
        type: 'tool_result', tool_use_id: 'tu_1',
        content: '18 passing',
      }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('tool_result');
    expect(events[0]!.output).toBe('18 passing');
    expect(events[0]!.toolUseId).toBe('tu_1');
  });

  it('emits a cost bubble whenever an assistant turn carries usage', () => {
    const events = map({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input_tokens: 1_000,
          output_tokens: 200,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });
    // 1 cost + 1 chat (cost always comes first)
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('cost');
    expect(events[0]!.model).toBe('claude-opus-4-7');
    expect(events[0]!.inputTokens).toBe(1_000);
    expect(events[0]!.outputTokens).toBe(200);
    // Opus pricing: $5 input + $25 output per million → 0.005 + 0.005 = 0.010
    expect(events[0]!.turnCostUSD).toBeCloseTo(0.010, 4);
    expect(events[0]!.cumulativeCostUSD).toBeCloseTo(0.010, 4);
    expect(events[1]!.kind).toBe('chat');
  });

  it('re-bills a repeated message.id last-wins (final usage replaces the partial)', () => {
    const adapter = new ClaudeAdapter('/tmp');
    // Claude Code emits the same assistant message twice under one id: a
    // streamed partial first, then the final complete usage. The final must
    // win — a first-wins scheme would lock in the (smaller) partial.
    const partial = {
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-opus-4-7', id: 'msg_stream_1',
        content: [{ type: 'text', text: 'thinking…' }],
        usage: { input_tokens: 1_000, output_tokens: 200 },  // → $0.010
      },
    };
    const final = {
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-opus-4-7', id: 'msg_stream_1',
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1_000, output_tokens: 1_000 },  // → $0.030
      },
    };
    const firstCost = adapter.recordToEvents(partial).find(e => e.kind === 'cost')!;
    expect(firstCost.cumulativeCostUSD).toBeCloseTo(0.010, 4);
    const secondCost = adapter.recordToEvents(final).find(e => e.kind === 'cost')!;
    // Last-wins: the final record's full cost, not the sum (0.040) and not the
    // first-wins partial (0.010).
    expect(secondCost.turnCostUSD).toBeCloseTo(0.030, 4);
    expect(secondCost.cumulativeCostUSD).toBeCloseTo(0.030, 4);
  });

  it('accumulates cumulativeCostUSD across multiple turns', () => {
    const adapter = new ClaudeAdapter('/tmp');
    const turn = {
      type: 'assistant',
      message: {
        role: 'assistant', model: 'claude-sonnet-4',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    };
    // Sonnet: $3 input / $15 output per million → $3 per turn
    adapter.recordToEvents(turn);
    const second = adapter.recordToEvents(turn);
    const cost = second.find(e => e.kind === 'cost')!;
    expect(cost.turnCostUSD).toBeCloseTo(3, 4);
    expect(cost.cumulativeCostUSD).toBeCloseTo(6, 4);
  });

  it('drops unknown record types silently', () => {
    expect(map({ type: 'system', message: { role: 'system', content: 'init' } }))
      .toEqual([]);
    expect(map({ type: 'user', message: { role: 'user', content: '' } }))
      .toEqual([]);  // empty content → no bubble
  });

  it('treats string content as a single chat block', () => {
    const events = map({
      type: 'assistant',
      message: { role: 'assistant', content: 'short reply' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('chat');
    expect(events[0]!.role).toBe('assistant');
    expect(events[0]!.text).toBe('short reply');
  });
});
