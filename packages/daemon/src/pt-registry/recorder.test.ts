import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Recorder } from './recorder.js';

describe('Recorder (asciinema v2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-recorder-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function read(rec: Recorder): string[] {
    return fs.readFileSync(rec.path, 'utf-8').split('\n').filter(Boolean);
  }

  it('writes a valid v2 header on first open', () => {
    const rec = new Recorder({ dir, sessionId: 's1', cols: 80, rows: 24,
                               shell: '/bin/zsh', cwd: '/tmp' });
    rec.close();

    const lines = read(rec);
    expect(lines).toHaveLength(1);

    const header = JSON.parse(lines[0]!);
    expect(header.version).toBe(2);
    expect(header.width).toBe(80);
    expect(header.height).toBe(24);
    expect(typeof header.timestamp).toBe('number');
    expect(header.env.SHELL).toBe('/bin/zsh');
    expect(header['x-pocket-t']?.cwd).toBe('/tmp');
  });

  it('writes output / input / resize records in asciinema shape', () => {
    const rec = new Recorder({ dir, sessionId: 's2', cols: 80, rows: 24,
                               shell: '/bin/zsh', cwd: '/tmp' });
    rec.writeOutput(Buffer.from('hello'));
    rec.writeInput(Buffer.from('x'));
    rec.writeResize(120, 30);
    rec.writeOutput(Buffer.from(' world\n'));
    rec.close();

    const lines = read(rec);
    // header + 4 records
    expect(lines).toHaveLength(5);

    const recs = lines.slice(1).map(l => JSON.parse(l));
    expect(recs[0][1]).toBe('o'); expect(recs[0][2]).toBe('hello');
    expect(recs[1][1]).toBe('i'); expect(recs[1][2]).toBe('x');
    expect(recs[2][1]).toBe('r'); expect(recs[2][2]).toBe('120x30');
    expect(recs[3][1]).toBe('o'); expect(recs[3][2]).toBe(' world\n');
    // monotonic non-decreasing timestamps
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i][0]).toBeGreaterThanOrEqual(recs[i - 1][0]);
    }
  });

  it('appends to an existing file without duplicating the header', () => {
    const opts = { dir, sessionId: 's3', cols: 80, rows: 24,
                   shell: '/bin/zsh', cwd: '/tmp' };
    const a = new Recorder(opts);
    a.writeOutput(Buffer.from('first'));
    a.close();

    const b = new Recorder(opts);  // re-opens; should NOT add a second header
    b.writeOutput(Buffer.from('second'));
    b.close();

    const lines = read(b);
    // 1 header + 2 records
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!).version).toBe(2);
    expect(JSON.parse(lines[1]!)[2]).toBe('first');
    expect(JSON.parse(lines[2]!)[2]).toBe('second');
  });

  it('writes nothing after close() — idempotent shutdown', () => {
    const rec = new Recorder({ dir, sessionId: 's4', cols: 80, rows: 24,
                               shell: '/bin/zsh', cwd: '/tmp' });
    rec.writeOutput(Buffer.from('before'));
    rec.close();
    const bytesAfterFirstClose = fs.statSync(rec.path).size;

    rec.writeOutput(Buffer.from('after'));  // should be a no-op
    rec.close();                            // also a no-op

    expect(fs.statSync(rec.path).size).toBe(bytesAfterFirstClose);
  });
});
