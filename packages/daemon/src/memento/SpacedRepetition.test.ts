import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SpacedRepetition } from './SpacedRepetition.js';

describe('SpacedRepetition', () => {
  let tmpDir: string;
  let sr: SpacedRepetition;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'sr-test-')); sr = new SpacedRepetition(tmpDir); sr.startSession(); });
  afterEach(()  => { rmSync(tmpDir, { recursive: true, force: true }); });

  test('surfaces box-1 items every session', () => {
    const item = { id: 'b', weight: 0.5, category: 'pattern', locked: false, corroborations: 2, addedAt: '', notability: 'medium' } as any;
    sr.enroll(item);
    sr.startSession();
    expect(sr.getDueItems([item]).length).toBeGreaterThan(0);
  });

  test('demotion on failure — surfaces next session', () => {
    const item = { id: 'c', weight: 0.8, category: 'pattern', locked: false, corroborations: 2, addedAt: '', notability: 'medium' } as any;
    sr.enroll(item);
    sr.onSuccess('c');
    sr.onFailure('c');
    sr.startSession();
    expect(sr.getDueItems([item]).length).toBeGreaterThan(0);
  });

  test('persists session number across instances', () => {
    const n = sr.sessionNumber;
    expect(new SpacedRepetition(tmpDir).sessionNumber).toBe(n);
  });
});
