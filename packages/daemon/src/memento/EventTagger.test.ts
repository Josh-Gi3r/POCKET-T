import { describe, test, expect } from 'vitest';
import { tagEvent, isSnapshotBoundary, escalateSalience } from './EventTagger.js';

describe('EventTagger', () => {
  test('tool call result → salience 1.0', () => {
    const e = tagEvent('✓ Read file: src/auth.ts', 'sess1');
    expect(e.type).toBe('tool_call_result');
    expect(e.salience).toBe(1.0);
    expect(e.id).toHaveLength(8);
  });
  test('error output → salience 0.6', () => {
    expect(tagEvent('Error: Cannot find module bcrypt', 'sess1').type).toBe('error_output');
  });
  test('approval request → salience 0.85', () => {
    expect(tagEvent('? Approve write to .env? (y/n)', 'sess1').salience).toBe(0.85);
  });
  test('log noise → salience 0.2', () => {
    expect(tagEvent('some random log output', 'sess1').type).toBe('log_noise');
  });
  test('stable ID for same content + timestamp', () => {
    const ts = new Date('2026-05-17T00:00:00Z');
    expect(tagEvent('Error: test', 'sess1', ts).id).toBe(tagEvent('Error: test', 'sess1', ts).id);
  });
  test('snapshot boundary detection', () => {
    expect(isSnapshotBoundary('✓ Task complete')).toBe(true);
    expect(isSnapshotBoundary('? Approve write? (y/n)')).toBe(true);
    expect(isSnapshotBoundary('some random line')).toBe(false);
  });
  test('salience escalation to 1.0 at 3+', () => {
    expect(escalateSalience(0.6, 3)).toBe(1.0);
  });
});
