import os from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig, saveConfig } from './config.js';
import { PtyHost } from './pty/PtyHost.js';
import { RelayClient } from './uplink/RelayClient.js';
import { HookServer } from './hooks/HookServer.js';
import { McpServer } from './mcp/McpServer.js';
import { scanProcesses } from './discover/ProcessScanner.js';
import { resolveProject, initProject } from './discover/ProjectResolver.js';
import { MementoEngine } from './memento/index.js';
import { DreamCycle } from './memento/DreamCycle.js';
import { McpServer as MementoMcpServer } from './memento/McpServer.js';

const RELAY_URL =
  process.env.POCKET_T_RELAY_URL ??
  (process.env.POCKET_T_REGION === 'us'
    ? 'wss://iad.relay.pocket-t.app'
    : 'wss://relay.pocket-t.app');   // SIN default
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
    "Error: Cannot find module 'bcrypt'",   // repeat → promotes
    '$ npm install bcrypt',
    '✓ Wrote file: src/auth.ts',
    'Never modify the database migrations directly',  // user constraint
  ];

  console.log('\n[test] Feeding simulated PTY lines:');
  for (const line of lines) {
    console.log(`  > ${line}`);
    engine.onLine(line);
  }

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
    console.error('Get your token at https://app.pocket-t.app/dashboard');
    process.exit(1);
  }
  const httpUrl = RELAY_URL.replace('wss://', 'https://').replace('ws://', 'http://');
  console.log('[pocket-t] Authenticating...');
  let data: any;
  try {
    const res = await fetch(`${httpUrl}/api/daemon/auth`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ oneTimeToken }),
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
    daemonId:  data.daemonId,
    accountId: data.accountId,
    token:     data.daemonJwt,
    relayUrl:  RELAY_URL,
    e2eEnabled: false,
  });
  console.log('[pocket-t] ✓ Authenticated! Daemon ID:', data.daemonId);
  process.exit(0);
}

// ─── pocket-t init [name] ─────────────────────────────────────────────────

if (command === 'init') {
  const project = initProject(process.cwd(), rest[0]);
  console.log(`\n[pocket-t] ✓ Project initialized`);
  console.log(`[pocket-t] Name: ${project.name}`);
  console.log(`[pocket-t] ID:   ${project.id}`);
  console.log(`[pocket-t] Run: pocket-t run --memento\n`);
  process.exit(0);
}

// ─── pocket-t scan ────────────────────────────────────────────────────────

if (command === 'scan') {
  const procs = (await scanProcesses()).filter((p) => p.interesting);
  if (procs.length === 0) {
    console.log('No interesting processes found.');
    console.log('Try starting Claude Code, Aider, or another CLI tool.');
  } else {
    console.log(`\nFound ${procs.length} interesting processes:\n`);
    for (const p of procs) {
      console.log(`  [${p.pid}] ${p.cmd}  —  ${p.args.slice(0, 80)}`);
    }
  }
  process.exit(0);
}

// ─── pocket-t skill ───────────────────────────────────────────────────────

if (command === 'skill') {
  console.log(`# pocket-t — Terminal Supervisor

## What pocket-t is
pocket-t is running on this Mac. It captures all terminal sessions,
routes them to your mobile device, and manages approval flows for
tool calls via the PreToolUse hook.

## PreToolUse hook
The hook server is running at http://127.0.0.1:${HOOK_PORT}/hook/preToolUse
All tool calls POST to this endpoint before executing. The response includes:
- decision: "approve" | "deny"
- context: contents of NOHUP.md if present (project memory)

## Project memory
If NOHUP.md exists in the current directory, read it at session start.
It contains constraints, known failures, and decisions from past sessions.
These facts are injected automatically via the PreToolUse hook context.

## Commands
- pocket-t run            Start daemon (connects to relay)
- pocket-t run --memento  Start daemon with memory enabled
- pocket-t mcp            Start MCP server (stdio)
- pocket-t init           Initialize project memory
- pocket-t scan           List interesting running processes
- pocket-t skill          Print this document
`);
  process.exit(0);
}

// ─── pocket-t dream — manual Memento consolidation cycle ──────────────────

if (command === 'dream') {
  const cycle  = new DreamCycle(process.cwd());
  const result = await cycle.run();
  console.log('[dream] Result:', JSON.stringify(result, null, 2));
  process.exit(result.error ? 1 : 0);
}

// ─── pocket-t serve-mcp — expose Memento as an MCP server ─────────────────

if (command === 'serve-mcp') {
  const server = new MementoMcpServer(process.cwd());
  server.serve();  // blocks on stdin — process stays alive until stdin closes
}

// ─── pocket-t mcp ─────────────────────────────────────────────────────────

else if (command === 'mcp') {
  const config  = await loadConfig();
  const project = resolveProject(process.cwd());

  const host = new PtyHost(config.daemonId, config.accountId, {
    onChunk: () => {}, onStatusChange: () => {}, onApproval: () => {}, onExit: () => {},
  }, project?.mementoEnabled ? project.root : undefined);

  const hookServer = new HookServer({
    port: HOOK_PORT + 1, projectRoot: project?.root,
  });
  hookServer.start();

  const mcp = new McpServer(host, null as any, hookServer);
  mcp.start();
  console.error('[pocket-t] MCP server ready. Listening on stdio.');
}

// ─── pocket-t run ─────────────────────────────────────────────────────────

else if (command === 'run' || command === undefined) {
  const config  = await loadConfig();
  const project = resolveProject(process.cwd());

  if (project) {
    console.log(`[pocket-t] Project: ${project.name} (${project.id})`);
  } else if (mementoEnabled) {
    console.warn('[pocket-t] No .nohup-project found. Run: pocket-t init');
  }

  const mementoRoot =
    (mementoEnabled && project?.mementoEnabled)
      ? project.root
      : undefined;

  // Wire Claude Code hooks (optional, non-destructive)
  if (existsSync(join(os.homedir(), '.claude'))) {
    try {
      let settings: any = {};
      if (existsSync(CLAUDE_SETTINGS)) {
        settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8'));
      }
      settings.hooks ??= {};
      settings.hooks.PreToolUse ??= [];
      const hookCmd = `curl -sf -X POST http://127.0.0.1:${HOOK_PORT}/hook/preToolUse ` +
        `-H 'Content-Type: application/json' --data @-`;
      const alreadySet = settings.hooks.PreToolUse.some(
        (h: any) => typeof h.command === 'string' && h.command.includes('pocket-t'),
      );
      if (!alreadySet) {
        settings.hooks.PreToolUse.push({ matcher: '*', command: hookCmd });
        writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
        console.log('[pocket-t] ✓ Claude Code hooks configured');
      }
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

  const host = new PtyHost(config.daemonId, config.accountId, {
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

  relayClient = new RelayClient(config.relayUrl, config.token, host, hookServer);

  hookServer.on('approvalRequested', (payload) =>
    relayClient.emitHookApproval(payload));

  hookServer.start();
  relayClient.connect();

  console.log('\n[pocket-t] Daemon running');
  console.log(`[pocket-t] Daemon ID: ${config.daemonId}`);
  if (mementoRoot) {
    console.log(`[pocket-t] Memory:    enabled → ${mementoRoot}/NOHUP.md`);
  }
  console.log(`[pocket-t] Relay:     ${config.relayUrl}`);
  console.log(`[pocket-t] Hooks:     http://127.0.0.1:${HOOK_PORT}\n`);

  const shutdown = () => {
    console.log('\n[pocket-t] Shutting down...');
    for (const s of host.all()) s.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

else {
  console.error(`Unknown command: ${command}`);
  console.error('Commands: auth, init, scan, skill, mcp, dream, serve-mcp, run');
  process.exit(1);
}
