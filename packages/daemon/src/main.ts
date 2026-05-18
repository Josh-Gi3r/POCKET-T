import os from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig, saveConfig } from './config.js';
import { TmuxHost } from './tmux/TmuxHost.js';
import { PtyHost } from './pty/PtyHost.js';
import { RelayClient } from './uplink/RelayClient.js';
import { HookServer } from './hooks/HookServer.js';
import { McpServer } from './mcp/McpServer.js';
import { scanProcesses } from './discover/ProcessScanner.js';
import { resolveProject, initProject } from './discover/ProjectResolver.js';
import { MementoEngine } from './memento/index.js';
import { DreamCycle } from './memento/DreamCycle.js';
import { McpServer as MementoMcpServer } from './memento/McpServer.js';
import type { Session } from '@pocket-t/shared';

// A rejected tmux cmd() (e.g. tmux %error) must never take the daemon down
// — log and keep the daemon alive so the phone stays connected.
process.on('unhandledRejection', (reason) => {
  console.error('[pocket-t] unhandledRejection:', reason);
});

const RELAY_URL =
  process.env.POCKET_T_RELAY_URL ??
  (process.env.POCKET_T_REGION === 'us'
    ? 'wss://iad.relay.pocket-t.ai'
    : 'wss://relay.pocket-t.ai');
const HOOK_PORT  = 7621;
const CLAUDE_SETTINGS = join(os.homedir(), '.claude', 'settings.json');

const [,, command, ...rest] = process.argv;

// ─── Memento standalone test mode ─────────────────────────────────────────
const mementoEnabled = process.argv.includes('--memento');
const testMode       = process.argv.includes('--test');

if (testMode && mementoEnabled) {
  const projectRoot = process.cwd();
  const sessionId   = 'test-' + Date.now().toString(36);
  const engine      = new MementoEngine({ projectRoot, sessionId });
  const lines = [
    '✓ Read file: src/auth.ts',
    'Thinking... I need to install bcrypt',
    "Error: Cannot find module 'bcrypt'",
    "Error: Cannot find module 'bcrypt'",
    '$ npm install bcrypt',
    '✓ Wrote file: src/auth.ts',
    'Never modify the database migrations directly',
  ];
  console.log('\n[test] Feeding simulated PTY lines:');
  for (const line of lines) { console.log(`  > ${line}`); engine.onLine(line); }
  console.log('\n[test] Triggering session end...');
  engine.onSessionEnd();
  const nohupPath = join(projectRoot, 'NOHUP.md');
  if (existsSync(nohupPath)) {
    console.log('\n[test] ✓ NOHUP.md written:\n');
    console.log(readFileSync(nohupPath, 'utf-8'));
  } else {
    console.error('[test] ✗ NOHUP.md not found');
    process.exit(1);
  }
  process.exit(0);
}

// ─── pocket-t auth <token> ────────────────────────────────────────────────
if (command === 'auth') {
  const oneTimeToken = rest[0];
  if (!oneTimeToken) {
    console.error('Usage: pocket-t auth <one-time-token>');
    console.error('Get your token at https://app.pocket-t.ai/dashboard');
    process.exit(1);
  }
  const httpUrl = RELAY_URL.replace('wss://', 'https://').replace('ws://', 'http://');
  console.log('[pocket-t] Authenticating...');
  let data: any;
  try {
    const res = await fetch(`${httpUrl}/api/daemon/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oneTimeToken }),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  } catch (e: any) {
    console.error('[pocket-t] Auth failed:', e.message);
    process.exit(1);
  }
  if (!data.daemonJwt || !data.daemonId) {
    console.error('[pocket-t] Auth failed: invalid response from relay');
    process.exit(1);
  }
  await saveConfig({
    daemonId:   data.daemonId,
    accountId:  data.accountId,
    token:      data.daemonJwt,
    relayUrl:   RELAY_URL,
    e2eEnabled: false,
  });
  console.log('\n[pocket-t] ✓ Authenticated! Daemon ID:', data.daemonId);
  process.exit(0);
}

// ─── pocket-t init [name] ─────────────────────────────────────────────────
if (command === 'init') {
  const project = initProject(process.cwd(), rest[0]);
  console.log(`\n[pocket-t] ✓ Project initialized`);
  console.log(`[pocket-t] Name: ${project.name}`);
  console.log(`[pocket-t] Run: pocket-t run --memento\n`);
  process.exit(0);
}

// ─── pocket-t scan ────────────────────────────────────────────────────────
if (command === 'scan') {
  const procs = (await scanProcesses()).filter(p => p.interesting);
  if (procs.length === 0) {
    console.log('No interesting processes found.');
  } else {
    console.log(`\nFound ${procs.length} interesting processes:\n`);
    for (const p of procs) console.log(`  [${p.pid}] ${p.cmd}  —  ${p.args.slice(0, 80)}`);
  }
  process.exit(0);
}

// ─── pocket-t skill ───────────────────────────────────────────────────────
if (command === 'skill') {
  console.log(
    `# pocket-t — Terminal Supervisor\n\n` +
    `Hook server: http://127.0.0.1:${HOOK_PORT}/hook/preToolUse\n` +
    `If NOHUP.md exists in project root, read it at session start.\n` +
    `Project memory is injected via PreToolUse hook context automatically.\n`,
  );
  process.exit(0);
}

// ─── pocket-t dream ───────────────────────────────────────────────────────
if (command === 'dream') {
  const cycle  = new DreamCycle(process.cwd());
  const result = await cycle.run();
  console.log('[dream] Result:', JSON.stringify(result, null, 2));
  process.exit(result.error ? 1 : 0);
}

// ─── pocket-t serve-mcp (Memento memory as MCP) ───────────────────────────
if (command === 'serve-mcp') {
  const server = new MementoMcpServer(process.cwd());
  server.serve();  // blocks on stdin
}

// ─── pocket-t mcp (session supervisor MCP) ────────────────────────────────
else if (command === 'mcp') {
  const config  = await loadConfig();
  const project = resolveProject(process.cwd());
  const host = new PtyHost(config.daemonId, config.accountId, {
    onChunk: () => {}, onStatusChange: () => {}, onApproval: () => {}, onExit: () => {},
  }, project?.mementoEnabled ? project.root : undefined);
  const hookServer = new HookServer({ port: HOOK_PORT + 1, projectRoot: project?.root });
  hookServer.start();
  const mcp = new McpServer(host, null as any, hookServer);
  mcp.start();
  console.error('[pocket-t] MCP server ready. Listening on stdio.');
}

// ─── pocket-t run (default) ───────────────────────────────────────────────
else if (command === 'run' || command === undefined) {
  const config  = await loadConfig();
  const project = resolveProject(process.cwd());
  const mementoRoot =
    (mementoEnabled && project?.mementoEnabled) ? project.root : undefined;

  // Configure Claude Code hooks (non-destructive, idempotent)
  if (existsSync(join(os.homedir(), '.claude'))) {
    try {
      let settings: any = {};
      if (existsSync(CLAUDE_SETTINGS)) {
        settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      }
      settings.hooks ??= {};
      const prev = Array.isArray(settings.hooks.PreToolUse)
        ? settings.hooks.PreToolUse
        : [];
      // Tag every hook call with the pocket-t session it belongs to so the
      // relay can route the approval back to the right phone. tmux exports
      // $TMUX_PANE (e.g. "%3") into every pane's environment; Claude Code
      // (and its hook subprocess) inherit it. ${TMUX_PANE#%} strips the
      // leading '%', yielding the same id TmuxHost.paneToSessionId builds:
      // tmux-<daemonId>-<paneNum>. Without this the relay saw 'unknown'
      // and silently dropped the approval.
      const hookCmd =
        `curl -sf -X POST http://127.0.0.1:${HOOK_PORT}/hook/preToolUse ` +
        `-H 'Content-Type: application/json' ` +
        `-H "x-session: tmux-${config.daemonId}-` + '${TMUX_PANE#%}"' + ` ` +
        `--data @-`;
      const MARK = '/hook/preToolUse';
      const isOurs = (h: any): boolean => {
        if (!h || typeof h !== 'object') return false;
        if (typeof h.command === 'string' && h.command.includes(MARK)) return true;
        return Array.isArray(h.hooks)
          && h.hooks.some((x: any) =>
            typeof x?.command === 'string' && x.command.includes(MARK));
      };
      // Drop every entry we previously authored (including the old broken
      // `{matcher, command}` shape that lacked the required `hooks` array
      // and was duplicated on every restart — the launch-time validation
      // dump). Leave the user's own hooks untouched.
      const cleaned = prev.filter((h: any) => !isOurs(h));
      // Re-add exactly one entry in the schema Claude Code expects:
      // { matcher, hooks: [{ type: 'command', command }] }; "" = all tools.
      cleaned.push({
        matcher: '',
        hooks: [{ type: 'command', command: hookCmd }],
      });
      settings.hooks.PreToolUse = cleaned;
      writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
      console.log('[pocket-t] ✓ Claude Code hooks configured (cleaned + revalidated)');
    } catch (e) {
      console.warn('[pocket-t] Could not configure Claude Code hooks:', e);
    }
  }

  let relayClient: RelayClient;

  const hookServer = new HookServer({
    port:        HOOK_PORT,
    timeoutMs:   5 * 60 * 1000,
    projectRoot: mementoRoot ?? process.cwd(),
  });

  // PtyHost — phone-initiated spawns that bypass tmux (rare)
  const ptyHost = new PtyHost(config.daemonId, config.accountId, {
    onChunk: (sessionId, ev) =>
      relayClient.emitChunk(sessionId, ev.text, ev.rawVt, ev.seq),
    onChunkEncrypted: (sessionId, ev) =>
      relayClient.emitChunkEncrypted(sessionId, ev.encrypted, ev.seq),
    onStatusChange: (session) =>
      relayClient.emitSessionUpdate(session),
    onApproval: (sessionId, ev) =>
      relayClient.emitApproval(sessionId, ev.messageId, ev.options),
    onExit: (sessionId, ev) =>
      relayClient.emitExit(sessionId, ev.exitCode),
  }, mementoRoot, config.e2eEnabled);

  // TmuxHost — every terminal you open (auto-attached to the pocket-t tmux
  // server via the shell snippet) shows up here as a session.
  const tmuxHost = new TmuxHost(config.daemonId, config.accountId, {
    onChunk: (sessionId, text, rawVt, seq) =>
      relayClient.emitChunk(sessionId, text, rawVt, seq),
    onSessionAdded: (session: Session) =>
      relayClient.emitSessionUpdate(session),
    onSessionRemoved: (sessionId: string) =>
      relayClient.emitExit(sessionId, 0),
    onSessionUpdate: (sessionId, status, lastOutput) =>
      relayClient.emitSessionUpdate({
        id: sessionId, daemonId: config.daemonId, accountId: config.accountId,
        name: sessionId, cmd: '', cwd: '', status,
        lastOutput: lastOutput ?? '', lastActiveAt: Date.now(), seq: 0,
      } as Session),
    onApproval: (sessionId, messageId, options) =>
      relayClient.emitApproval(sessionId, messageId, options),
  });

  relayClient = new RelayClient(config.relayUrl, config.token, ptyHost, hookServer);

  relayClient.onConnect = () => {
    const sessions = tmuxHost.allSessions();
    if (sessions.length) relayClient.emitAllSessions(sessions);
    console.log(`[pocket-t] announced ${sessions.length} tmux sessions`);
  };

  relayClient.onInput = async (sessionId, text) => {
    if (sessionId.startsWith('tmux-')) await tmuxHost.sendInput(sessionId, text);
    else ptyHost.write(sessionId, text + '\r');
  };

  relayClient.onSpawn = async (name, cmd, cwd) => {
    try { await tmuxHost.spawnWindow(name, cmd, cwd); }
    catch (e) { console.error('[relay] spawn error:', e); }
  };

  relayClient.onKill = async (sessionId) => {
    if (sessionId.startsWith('tmux-')) await tmuxHost.killSession(sessionId);
    else ptyHost.kill(sessionId);
  };

  relayClient.onAttach = async (sessionId) => {
    if (sessionId.startsWith('tmux-')) {
      const snap = await tmuxHost.snapshot(sessionId);
      if (snap) {
        relayClient.emitSnapshot(sessionId, snap.plainText, snap.rawVt);
      }
      return;
    }
    const s = ptyHost.get(sessionId);
    if (s) {
      const snap = s.snapshot();
      relayClient.emitSnapshot(sessionId, snap.plainText, snap.rawVt);
    }
  };

  hookServer.on('approvalRequested', (payload: any) =>
    relayClient.emitHookApproval(payload));

  hookServer.start();
  relayClient.connect();

  try {
    await tmuxHost.start();
    console.log('[pocket-t] tmux capture active — every terminal you open appears on your phone');
  } catch (e) {
    console.warn('[pocket-t] tmux not available:', (e as Error).message);
    console.warn('[pocket-t] spawn-only mode. Restart your Mac after install to enable auto-capture.');
  }

  console.log('\n[pocket-t] Daemon running');
  console.log(`[pocket-t] Relay:  ${config.relayUrl}`);
  console.log(`[pocket-t] Hooks:  http://127.0.0.1:${HOOK_PORT}`);
  if (mementoRoot) console.log(`[pocket-t] Memory: ${mementoRoot}/NOHUP.md`);
  console.log('[pocket-t] Waiting for phone...\n');

  const shutdown = () => {
    console.log('\n[pocket-t] Shutting down...');
    tmuxHost.stop();
    for (const s of ptyHost.all()) s.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

else {
  console.error(`Unknown command: ${command}`);
  console.error('Commands: auth, init, scan, skill, dream, serve-mcp, mcp, run');
  process.exit(1);
}
