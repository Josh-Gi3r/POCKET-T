import { describe, expect, it } from 'vitest';
import { parseExistingApps, parseExistingTmux } from './existing-terminals.js';

describe('existing-terminal inventory', () => {
  it('discovers already-open Terminal and iTerm2 tabs without injecting input', () => {
    const inventory = JSON.stringify([
      { source: 'terminal', tty: '/dev/ttys001', title: 'Project Alpha', processes: ['zsh', 'claude'] },
      { source: 'iterm2', tty: '/dev/ttys003', title: 'Production', processes: ['zsh'] },
    ]);
    expect(parseExistingApps(inventory)).toEqual([
      { sessionId: 'existing:terminal:/dev/ttys001', source: 'terminal',
        tty: '/dev/ttys001', title: 'Project Alpha', cwd: '', capabilities: ['discover'] },
      { sessionId: 'existing:iterm2:/dev/ttys003', source: 'iterm2',
        tty: '/dev/ttys003', title: 'Production', cwd: '', capabilities: ['discover'] },
    ]);
  });

  it('filters managed pt windows, duplicate tabs and invalid injected TTYs', () => {
    const raw = JSON.stringify([
      { source: 'terminal', tty: '/dev/ttys007', title: 'Managed', processes: ['/usr/local/bin/pt'] },
      { source: 'terminal', tty: '/dev/ttys002', title: 'Safe', processes: ['zsh'] },
      { source: 'terminal', tty: '/dev/ttys002', title: 'Duplicate', processes: ['zsh'] },
      { source: 'iterm2', tty: '/dev/ttys002;rm -rf ~', title: 'Injected', processes: [] },
      { source: 'other', tty: '/dev/ttys005', title: 'Unsupported', processes: [] },
    ]);
    const result = parseExistingApps(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe('Safe');
    expect(result[0]?.capabilities).toEqual(['discover']);
  });

  it('parses existing unmanaged tmux panes and safely ignores invalid rows', () => {
    const raw = '%0\twork\tserver\t/Users/me/app\n%1\tdev\tvim\t/tmp\nnot-a-pane\tx\ty\tz\n';
    const panes = parseExistingTmux(raw);
    expect(panes.map((s) => s.sessionId)).toEqual(['existing:tmux:%0', 'existing:tmux:%1']);
    expect(panes[0]?.cwd).toBe('/Users/me/app');
    expect(panes[1]?.capabilities).toEqual(['discover']);
  });

  it('handles missing or malformed app metadata without raising', () => {
    expect(parseExistingApps('not JSON')).toEqual([]);
    expect(parseExistingApps('{}')).toEqual([]);
    expect(parseExistingApps('[null,{},{"source":"terminal","tty":22}]')).toEqual([]);
  });
});
