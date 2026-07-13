// Multi-source adapter detection.
//
// When a pt session registers we don't know what's running inside
// (`pt` is a transparent byte proxy — no shell AST awareness). We
// detect what the user is running through several signals, in priority
// order. The strongest signal wins; weaker signals provide labels and
// fallbacks.
//
// Priority order:
//   1. Transcript-file detection — Claude writes a JSONL the moment
//      it starts. If one exists in the cwd, it IS Claude.
//   2. Process tree polling — daemon walks the child process tree of
//      the pt session and matches command names (claude, codex,
//      openclaw, hermes, …). Less exact but useful for labels.
//   3. (Future) OSC 133 / preexec shell markers — emit specific
//      escape sequences when the user runs a known agent CLI.
//   4. (Future) Manual hint — user picks the adapter from the web UI.
//
// No source is required for terminal control to work. Sessions
// without any adapter match render as plain terminal.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Adapter } from './Adapter.js';
import { ClaudeAdapter, hasActiveTranscript } from './ClaudeAdapter.js';
import { GenericAgentAdapter } from './GenericAgentAdapter.js';

const execFileP = promisify(execFile);

export interface DetectionContext {
  sessionId: string;
  cwd:       string;
  pid:       number;
}

/**
 * Vendors recognised by name in the user's process tree. Claude is
 * the only one with a real bubble-event parser today; the rest get
 * the GenericAgentAdapter (sidebar badge + onboarding event + raw
 * Terminal view still works fine). Drop in a real <Vendor>Adapter.ts
 * mirroring ClaudeAdapter.ts to upgrade any of them.
 */
const KNOWN_VENDORS = ['claude', 'codex', 'grok', 'openclaw', 'hermes', 'nanoclaw'] as const;
type KnownVendor = typeof KNOWN_VENDORS[number];

/** Best-effort detection. Returns an unstarted Adapter the caller can
 *  start(), or null if no vendor matched. */
export async function detectAdapter(ctx: DetectionContext): Promise<Adapter | null> {
  // 1. Transcript-file check — strongest signal for Claude.
  if (hasActiveTranscript(ctx.cwd, 60_000)) {
    return new ClaudeAdapter(ctx.cwd);
  }

  // 2. Process tree polling.
  const vendor = await detectVendorFromProcessTree(ctx.pid);
  if (!vendor) return null;
  return adapterFor(vendor, ctx);
}

/** Map a recognised vendor name to its adapter. New parsers slot in
 *  here without touching the rest of the daemon. */
function adapterFor(vendor: KnownVendor, ctx: DetectionContext): Adapter {
  switch (vendor) {
    case 'claude':
      return new ClaudeAdapter(ctx.cwd);
    // codex / grok / openclaw / hermes / nanoclaw — transcript formats
    // aren't parsed yet. Fall through to the generic vendor-tagged
    // adapter so the sidebar still labels and bubble view shows an
    // explicit "no parser yet" onboarding card.
    default:
      return new GenericAgentAdapter(vendor);
  }
}

/** Walk descendants of `rootPid` and look for known agent CLI process
 *  names. macOS / BSD ps doesn't have --forest, so we list everything
 *  with parent-pid info and walk it ourselves. */
async function detectVendorFromProcessTree(rootPid: number): Promise<KnownVendor | null> {
  let out: string;
  try {
    const r = await execFileP('ps', ['-axo', 'pid=,ppid=,comm=']);
    out = r.stdout;
  } catch {
    return null;
  }

  const children = new Map<number, number[]>();   // ppid → [pid]
  const command  = new Map<number, string>();
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid   = Number(m[1]);
    const ppid  = Number(m[2]);
    const cmd   = (m[3] ?? '').split('/').pop() ?? '';
    command.set(pid, cmd.trim().toLowerCase());
    const arr = children.get(ppid) ?? [];
    arr.push(pid);
    children.set(ppid, arr);
  }

  const stack = [rootPid];
  const seen  = new Set<number>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const cmd = command.get(cur) ?? '';
    for (const vendor of KNOWN_VENDORS) {
      // Strict match OR prefix match for variants like 'claude-code'.
      if (cmd === vendor || cmd.startsWith(vendor + '-') || cmd.startsWith(vendor + '.') || cmd.includes(vendor)) {
        return vendor;
      }
    }
    for (const c of children.get(cur) ?? []) stack.push(c);
  }
  return null;
}
