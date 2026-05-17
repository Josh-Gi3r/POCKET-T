import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NohupMdWriter } from './NohupMdWriter.js';
import type { EvidenceRecord } from './EvidenceGate.js';

const rec = (hash: string, count = 2): EvidenceRecord => ({
  patternHash: hash, count, firstSeen: '', lastSeen: '', type: 'error_output',
  examples: [], promoted: true, retrievalCount: 0, lastRetrieved: null,
});

describe('NohupMdWriter', () => {
  let tmpDir: string;
  let writer: NohupMdWriter;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'nohup-test-')); writer = new NohupMdWriter(tmpDir); });
  afterEach(()  => { rmSync(tmpDir, { recursive: true, force: true }); });

  test('creates both sections', () => {
    writer.appendTimeline({ id: 'abc', timestamp: new Date().toISOString(), type: 'error_output', summary: 'test', salience: 0.6 });
    writer.write();
    const c = readFileSync(join(tmpDir, 'NOHUP.md'), 'utf-8');
    expect(c).toContain('=== COMPILED TRUTH ===');
    expect(c).toContain('=== TIMELINE ===');
  });

  test('caps at 4 per category', () => {
    for (let i = 0; i < 6; i++) writer.addOrUpdateItem(rec(`h${i}`), `Item ${i}`, 'constraint', 0.9, true);
    writer.write();
    expect((readFileSync(join(tmpDir, 'NOHUP.md'), 'utf-8').match(/- \[h\d\]/g) ?? []).length).toBeLessThanOrEqual(4);
  });

  test('locked items show 🔒', () => {
    writer.addOrUpdateItem(rec('aaa'), 'Never force push', 'constraint', 0.9, true);
    writer.write();
    expect(readFileSync(join(tmpDir, 'NOHUP.md'), 'utf-8')).toContain('🔒');
  });

  test('reconsolidation rewrites in place', () => {
    writer.addOrUpdateItem(rec('r01'), 'Original content', 'pattern', 0.6, false);
    writer.reconsolidate('r01', 'Corrected content', 'user said stop');
    writer.write();
    const c = readFileSync(join(tmpDir, 'NOHUP.md'), 'utf-8');
    expect(c).toContain('Corrected content');
    expect(c).not.toContain('Original content');
    expect((c.match(/r01/g) ?? []).length).toBe(1);
  });

  test('timeline newest first', () => {
    writer.appendTimeline({ id: 'old', timestamp: '2026-05-16T10:00:00Z', type: 'e', summary: 'Old', salience: 0.6 });
    writer.appendTimeline({ id: 'new', timestamp: '2026-05-17T10:00:00Z', type: 'e', summary: 'New', salience: 0.6 });
    writer.write();
    const c = readFileSync(join(tmpDir, 'NOHUP.md'), 'utf-8');
    expect(c.indexOf('New')).toBeLessThan(c.indexOf('Old'));
  });

  test('persists across instances', () => {
    writer.addOrUpdateItem(rec('p01'), 'Persisted', 'constraint', 0.85, false);
    new NohupMdWriter(tmpDir).write();
    expect(readFileSync(join(tmpDir, 'NOHUP.md'), 'utf-8')).toContain('Persisted');
  });
});
