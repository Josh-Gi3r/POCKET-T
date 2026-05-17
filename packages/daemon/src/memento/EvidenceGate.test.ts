import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EvidenceGate } from './EvidenceGate.js';
import { tagEvent } from './EventTagger.js';

describe('EvidenceGate', () => {
  let tmpDir: string;
  let gate:   EvidenceGate;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ev-test-')); gate = new EvidenceGate(tmpDir); });
  afterEach(()  => { rmSync(tmpDir, { recursive: true, force: true }); });

  test('no promote on first observation', () =>
    expect(gate.observe(tagEvent('Error: bcrypt missing', 'sess1'))).toBe(false));

  test('promotes on second same-pattern observation', () => {
    // Real Node.js errors use single quotes around module names
    gate.observe(tagEvent("Error: Cannot find module 'bcrypt'", 'sess1'));
    expect(gate.observe(tagEvent("Error: Cannot find module 'lodash'", 'sess1'))).toBe(true);
  });

  test('low-salience never promotes', () => {
    gate.observe(tagEvent('some log line', 'sess1'));
    expect(gate.observe(tagEvent('some log line', 'sess1'))).toBe(false);
  });

  test('pattern normalization strips variable parts', () => {
    // Quoted paths — patternKey normalizes quoted strings to <str>
    const k1 = gate.patternKey("Error: ENOENT '/home/user/a.ts' line 42", 'error_output');
    const k2 = gate.patternKey("Error: ENOENT '/home/other/b.ts' line 17", 'error_output');
    expect(k1).toBe(k2);
  });

  test('persists across instances', () => {
    // Quoted strings so patternKey normalizes them to the same key
    gate.observe(tagEvent("Error: test 'error pattern'", 'sess1'));
    const gate2 = new EvidenceGate(tmpDir);
    expect(gate2.observe(tagEvent("Error: test 'error variant'", 'sess2'))).toBe(true);
  });

  test('does not re-promote already promoted', () => {
    gate.observe(tagEvent('Error: repeating 1', 'sess1'));
    expect(gate.observe(tagEvent('Error: repeating 2', 'sess1'))).toBe(true);
    expect(gate.observe(tagEvent('Error: repeating 3', 'sess1'))).toBe(false);
  });
});
