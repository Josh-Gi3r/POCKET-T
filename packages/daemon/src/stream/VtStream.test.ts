import { describe, it, expect } from 'vitest';
import { VtStream, type VtChunk } from './VtStream.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Regression for the streaming redesign. The old capture-pane + string
// diff re-emitted the whole screen on every scroll and deleted history on
// clear. The byte-stream model must be append-only and lossless.
describe('VtStream', () => {
  it('emits readable, append-only chunks (no whole-screen re-emit)', async () => {
    const vt = new VtStream();
    const chunks: VtChunk[] = [];
    vt.on('chunk', (c: VtChunk) => chunks.push(c));

    vt.write('hello world\n');
    await wait(120);
    vt.write('second line\n');
    await wait(120);

    expect(chunks.length).toBe(2);
    expect(chunks[0].text).toContain('hello world');
    // The second chunk must NOT restate the first — that was the bug.
    expect(chunks[1].text).toContain('second line');
    expect(chunks[1].text).not.toContain('hello world');
    expect(chunks[1].seq).toBeGreaterThan(chunks[0].seq);

    // rawVt is base64 of the exact bytes written (for the xterm view).
    expect(Buffer.from(chunks[0].rawVt, 'base64').toString('utf-8'))
      .toBe('hello world\n');

    vt.dispose();
  });

  it('snapshot returns rendered text + base64 rawVt', async () => {
    const vt = new VtStream();
    vt.write('on screen now\n');
    await wait(120);
    const snap = vt.snapshot();
    expect(snap.plainText).toContain('on screen now');
    expect(() => Buffer.from(snap.rawVt, 'base64')).not.toThrow();
    vt.dispose();
  });

  it('seeds before first write but ignores a late seed', async () => {
    const a = new VtStream();
    a.seed('SEEDED_BEFORE\n');
    await wait(40);   // xterm headless parses writes asynchronously
    expect(a.snapshot().plainText).toContain('SEEDED_BEFORE');
    a.dispose();

    const b = new VtStream();
    b.write('live output\n');
    await wait(120);
    b.seed('LATE_SEED_SHOULD_BE_IGNORED\n');
    expect(b.snapshot().plainText).not.toContain('LATE_SEED');
    b.dispose();
  });

  it('stops emitting after dispose', async () => {
    const vt = new VtStream();
    const chunks: VtChunk[] = [];
    vt.on('chunk', (c: VtChunk) => chunks.push(c));
    vt.dispose();
    vt.write('should not emit\n');
    await wait(120);
    expect(chunks.length).toBe(0);
  });
});
