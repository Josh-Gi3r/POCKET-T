import { describe, test, expect } from 'vitest';
import { DecayEngine } from './DecayEngine.js';
import type { CompiledTruthItem } from './NohupMdWriter.js';

const item = (id: string, weight: number, locked = false): CompiledTruthItem => ({
  id, weight, content: `Item ${id}`, category: 'pattern',
  addedAt: '', corroborations: 2, locked, notability: locked ? 'high' : 'medium',
});

describe('DecayEngine', () => {
  const engine = new DecayEngine();

  test('locked items do not decay', () => {
    const r = engine.computeDecay([item('l', 0.9, true)], new Map([['l', 10]]), new Map([['l', 0]]));
    expect(r[0].newWeight).toBe(0.9);
  });

  test('unlocked items decay over time', () => {
    const r = engine.computeDecay([item('d', 0.9)], new Map([['d', 5]]), new Map([['d', 0]]));
    expect(r[0].newWeight).toBeLessThan(0.9);
  });

  test('retrieval slows decay', () => {
    const noRet  = engine.computeDecay([item('a', 0.8)], new Map([['a', 3]]), new Map([['a', 0]]));
    const withRet = engine.computeDecay([item('b', 0.8)], new Map([['b', 3]]), new Map([['b', 5]]));
    expect(withRet[0].newWeight).toBeGreaterThan(noRet[0].newWeight);
  });

  test('floor at 0.15 — never zero', () => {
    const r = engine.computeDecay([item('o', 0.2)], new Map([['o', 100]]), new Map([['o', 0]]));
    expect(r[0].newWeight).toBeGreaterThanOrEqual(0.15);
  });
});
