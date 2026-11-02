/**
 * Read-only discovery of terminal sessions that already existed before pt.
 * No kill, hijack, shell injection, screen capture, or permission bypass.
 * Apple Events discovery runs only on an explicit authenticated UI request
 * and may be denied by macOS Automation / enterprise device policy.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
export interface ExistingTerminal {
  sessionId: string;
  source: 'tmux' | 'terminal' | 'iterm2';
  title: string;
  cwd: string;
  tty?: string;
  pane?: string;
  tmuxSession?: string;
  capabilities: Array<'discover' | 'join'>;
}

type AppEntry = { source?: unknown; tty?: unknown; title?: unknown; processes?: unknown };
function nameOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, ' ').slice(0, 120) : '';
}
function validTty(value: unknown): value is string {
  return typeof value === 'string' && /^\/dev\/ttys[0-9a-z]+$/i.test(value);
}

export function parseExistingApps(text: string): ExistingTerminal[] {
  let arr: AppEntry[];
  try { const parsed: unknown = JSON.parse(text); if (!Array.isArray(parsed)) return []; arr = parsed; }
  catch { return []; }
  const sessions: ExistingTerminal[] = [];
  const seen = new Set<string>();
  for (const e of arr) {
    if (!e || (e.source !== 'terminal' && e.source !== 'iterm2') || !validTty(e.tty)) continue;
    const processes = Array.isArray(e.processes) ? e.processes.filter((x): x is string => typeof x === 'string') : [];
    // Windows using the pt shell shim are already represented by managed sessions.
    if (processes.some((proc) => proc.split('/').pop() === 'pt')) continue;
    const id = 'existing:' + e.source + ':' + e.tty;
    if (seen.has(id)) continue; seen.add(id);
    sessions.push({
      sessionId: id, source: e.source, tty: e.tty,
      title: nameOf(e.title) || (e.source === 'iterm2' ? 'iTerm2 session' : 'Terminal.app tab'),
      cwd: '', capabilities: ['discover'],
    });
  }
  return sessions.slice(0, 120);
}

export function parseExistingTmux(text: string): ExistingTerminal[] {
  const result: ExistingTerminal[] = [];
  const seen = new Set<string>();
  for (const row of text.split('\n')) {
    const [pane, session, window, cwd] = row.replace(/\r$/, '').split('\t');
    if (!pane || !/^%\d+$/.test(pane) || seen.has(pane)) continue;
    seen.add(pane);
    // An existing pane belongs to a tmux session. Joining attaches another
    // real tmux CLIENT to that session, not a new shell and not a screenshot.
    if (!session || session.length > 128 || /[\x00-\x1f\\]/.test(session)) continue;
    result.push({
      sessionId: 'existing:tmux:' + pane, source: 'tmux', pane,
      title: (nameOf(session) || 'tmux') + ' / ' + (nameOf(window) || pane),
      cwd: cwd && cwd.startsWith('/') ? cwd.slice(0, 300) : '',
      tmuxSession: session, capabilities: ['discover', 'join'],
    });
  }
  return result.slice(0, 120);
}

const APP_DISCOVERY_SCRIPT = "function run() {\n  var result = [];\n  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }\n  function visit(name, source) {\n    var app = Application(name);\n    if (!safe(function() { return app.running(); }, false)) return;\n    var windows = safe(function() { return app.windows(); }, []);\n    windows.forEach(function(win) {\n      var title = safe(function() { return String(win.name()); }, name);\n      safe(function() { return win.tabs(); }, []).forEach(function(tab) {\n        if (source === 'terminal') {\n          var tty = safe(function() { return String(tab.tty()); }, '');\n          var processes = safe(function() { return tab.processes().map(String); }, []);\n          result.push({ source: source, tty: tty, title: title, processes: processes });\n        } else {\n          safe(function() { return tab.sessions(); }, []).forEach(function(session) {\n            var tty = safe(function() { return String(session.tty()); }, '');\n            var sessionName = safe(function() { return String(session.name()); }, title);\n            result.push({ source: source, tty: tty, title: sessionName, processes: [] });\n          });\n        }\n      });\n    });\n  }\n  visit('Terminal', 'terminal');\n  visit('iTerm2', 'iterm2');\n  return JSON.stringify(result);\n}";

export async function discoverTmux(): Promise<ExistingTerminal[]> {
  try {
    const format = ['#{pane_id}', '#{session_name}', '#{window_name}', '#{pane_current_path}'].join('\t');
    const { stdout } = await execFile('tmux', ['list-panes', '-a', '-F', format], { timeout: 2500, maxBuffer: 256 * 1024 });
    return parseExistingTmux(stdout);
  } catch { return []; } // No external tmux server is a normal condition.
}

/**
 * Resolve a requested pane against the Mac's current tmux inventory. Never
 * trust an arbitrary browser-supplied session name as a shell command.
 * Only the DEFAULT tmux socket is considered (managed pocket-t uses -L).
 */
export async function resolveExistingTmuxTarget(sessionId: unknown): Promise<ExistingTerminal | null> {
  if (typeof sessionId !== 'string' || !/^existing:tmux:%\d{1,15}$/.test(sessionId)) return null;
  const sessions = await discoverTmux();
  return sessions.find((session) => session.sessionId === sessionId && !!session.tmuxSession) ?? null;
}

export async function discoverExistingTerminals(): Promise<ExistingTerminal[]> {
  if (process.platform !== 'darwin') return [];
  const results = await Promise.allSettled([
    discoverTmux(),
    execFile('osascript', ['-l', 'JavaScript', '-e', APP_DISCOVERY_SCRIPT], { timeout: 6500, maxBuffer: 256 * 1024 }),
  ]);
  const tmux = results[0].status === 'fulfilled' ? results[0].value : [];
  const app = results[1].status === 'fulfilled' ? parseExistingApps(results[1].value.stdout) : [];
  if (results[1].status === 'rejected') {
    console.warn('[existing-terminals] App discovery unavailable (Automation permission may be denied)');
  }
  return [...tmux, ...app].slice(0, 120);
}
