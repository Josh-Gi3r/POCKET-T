// pt-registry CLI — subcommands that talk to a running daemon over the
// ctl Unix socket, plus the top-level argv dispatch.
//
// The daemon itself lives in ./server.ts. This file is what users
// actually invoke from a terminal:
//
//   pt-registry serve [--tunnel] [--relay <url>]
//   pt-registry list                       — JSON dump of every session
//   pt-registry status [--json]            — uptime / counts / I/O totals
//   pt-registry pending [--json]           — outstanding tool approvals
//   pt-registry approve <id> [approve|deny]— resolve an approval
//   pt-registry recordings [--json]        — list asciinema casts
//   pt-registry replay  <sessionId>        — play a cast back at native rate
//   pt-registry input   <sessionId> <text> — write bytes into a PTY
//   pt-registry kill    <sessionId> [sig]  — signal a session's process group

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CTL_SOCK_PATH, RECORDINGS_DIR, runServer } from './server.js';

// ─── Transport: one-shot JSON request over the ctl socket ────────────────

function ctlRequest(req: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(CTL_SOCK_PATH);
    let buf = '';
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
    sock.on('data',    (chunk) => { buf += chunk.toString('utf8'); });
    sock.on('end',     () => {
      try { resolve(JSON.parse(buf.trim())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e: any) => {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        reject(new Error(`pt-registry server not running (no ${CTL_SOCK_PATH}). Start it with: pt-registry serve`));
      } else {
        reject(e);
      }
    });
  });
}

// ─── Subcommand implementations ──────────────────────────────────────────

async function cliList(): Promise<void> {
  const resp = await ctlRequest({ cmd: 'list' });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  if (resp.sessions.length === 0) {
    console.log('no active pt sessions');
    return;
  }
  console.log(JSON.stringify(resp.sessions, null, 2));
}

async function cliInput(sessionId: string, text: string): Promise<void> {
  const resp = await ctlRequest({ cmd: 'input', sessionId, text });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  console.log(`ok (${resp.bytes} bytes)`);
}

async function cliKill(sessionId: string, signal?: number): Promise<void> {
  const resp = await ctlRequest({ cmd: 'kill', sessionId, signal });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  console.log('ok');
}

async function cliStatus(jsonMode: boolean): Promise<void> {
  const resp = await ctlRequest({ cmd: 'status' });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(resp, null, 2)); return; }

  const fmtBytes = (n: number) => {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
  };
  const fmtUptime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  };

  console.log(`pt-registry — pid ${resp.pid}, up ${fmtUptime(resp.uptimeMs)}`);
  console.log(`  sessions:        ${resp.sessions} (${resp.detached} detached)`);
  console.log(`  browser clients: ${resp.browserClients}`);
  console.log(`  relay link:      ${resp.relayLinks > 0 ? 'connected' : 'not connected'}`);
  console.log(`  bytes in/out:    ${fmtBytes(resp.bytesIn)} / ${fmtBytes(resp.bytesOut)}`);
  console.log(`  pending appr:    ${resp.pendingApprovals}`);
  console.log(`  hooks port:      ${resp.hookServerPort}`);
  console.log(`  recordings:      ${resp.recordingsCount} files, ${fmtBytes(resp.recordingsBytes)} in ${resp.recordingsDir}`);
}

async function cliPending(jsonMode: boolean): Promise<void> {
  const resp = await ctlRequest({ cmd: 'pending' });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(resp.pending, null, 2)); return; }
  if (resp.pending.length === 0) { console.log('no pending approvals'); return; }
  for (const p of resp.pending) {
    const age = Math.floor((Date.now() - p.createdAt) / 1000);
    console.log(`  ${p.approvalId}  session=${p.sessionId}  tool=${p.toolName}  age=${age}s`);
  }
}

async function cliApprove(approvalId: string, decision: 'approve' | 'deny'): Promise<void> {
  const resp = await ctlRequest({ cmd: 'approve', approvalId, decision });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  console.log(`${decision === 'approve' ? '✓ approved' : '✗ denied'} ${approvalId}`);
}

async function cliRecordings(jsonMode: boolean): Promise<void> {
  const resp = await ctlRequest({ cmd: 'recordings' });
  if (!resp.ok) { console.error('error:', resp.error); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(resp.recordings, null, 2)); return; }
  if (resp.recordings.length === 0) { console.log('no recordings'); return; }
  for (const r of resp.recordings) {
    const d = new Date(r.mtime).toISOString().replace('T', ' ').slice(0, 19);
    console.log(`  ${d}  ${(r.size / 1024).toFixed(1)}KB  ${r.path}`);
  }
}

/** Naive built-in cast player. asciinema's own `play` is richer but we
 *  keep the daemon tooling zero-dependency; the .cast format is standard
 *  so any external player works on the same files. */
async function cliReplay(sessionId: string): Promise<void> {
  const file = path.join(RECORDINGS_DIR, `${sessionId}.cast`);
  if (!fs.existsSync(file)) {
    console.error(`no recording for ${sessionId} (looked in ${file})`);
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  if (lines.length === 0) { console.error('empty recording'); process.exit(1); }

  // Line 1 is the JSON header; the rest are [time, "o"|"i"|"r", "bytes"].
  let last = 0;
  for (let i = 1; i < lines.length; i++) {
    try {
      const r = JSON.parse(lines[i]!);
      if (!Array.isArray(r) || r.length < 3) continue;
      const t = Number(r[0]);
      const kind = String(r[1]);
      const data = String(r[2]);
      if (kind !== 'o') continue;  // skip input/resize when replaying visually
      const delayMs = Math.min(1500, Math.max(0, (t - last) * 1000));
      await new Promise((res) => setTimeout(res, delayMs));
      process.stdout.write(data);
      last = t;
    } catch { /* skip malformed line */ }
  }
  process.stdout.write('\n');
}

// ─── Dispatch ────────────────────────────────────────────────────────────

function usage(): never {
  console.error(`usage:
  pt-registry serve [--tunnel] [--relay <wss-url>]
  pt-registry list
  pt-registry status [--json]
  pt-registry pending [--json]
  pt-registry approve <approvalId> [approve|deny]
  pt-registry recordings [--json]
  pt-registry replay  <sessionId>
  pt-registry input   <sessionId> <text...>
  pt-registry kill    <sessionId> [signal]

  --tunnel       Start a Cloudflare Quick Tunnel so a phone on any
                 network can open the pocket-t UI. Requires \`cloudflared\`
                 in PATH (\`brew install cloudflared\`). Free, no signup.

  --relay <url>  Alternative: dial out to a self-hosted ws-v3 hub at
                 <url>. Use this if you've deployed your own relay
                 (docs/self-hosting.md). Example:
                   --relay wss://your-hub.fly.dev/ws/pt?role=daemon&t=mytoken`);
  process.exit(2);
}

export async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case 'serve': {
      let relayUrl: string | undefined;
      let tunnel = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--relay' && i + 1 < args.length) {
          relayUrl = args[i + 1];
          i++;
        } else if (args[i] === '--tunnel') {
          tunnel = true;
        }
      }
      await runServer({ relayUrl, tunnel });
      break;
    }
    case 'list':       await cliList(); break;
    case 'status':     await cliStatus(args.includes('--json')); break;
    case 'pending':    await cliPending(args.includes('--json')); break;
    case 'recordings': await cliRecordings(args.includes('--json')); break;
    case 'approve': {
      if (args.length < 1) usage();
      const [aid, decRaw] = args;
      const dec = decRaw === 'deny' ? 'deny' : 'approve';
      await cliApprove(aid!, dec as 'approve' | 'deny');
      break;
    }
    case 'replay': {
      if (args.length < 1) usage();
      await cliReplay(args[0]!);
      break;
    }
    case 'input': {
      if (args.length < 2) usage();
      const [sessionId, ...rest] = args;
      await cliInput(sessionId!, rest.join(' '));
      break;
    }
    case 'kill': {
      if (args.length < 1) usage();
      const [sessionId, sigStr] = args;
      await cliKill(sessionId!, sigStr ? Number(sigStr) : undefined);
      break;
    }
    default:
      usage();
  }
}
