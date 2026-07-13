import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ApprovalDecision = 'approve' | 'deny' | 'timeout';

export interface PendingApproval {
  id:         string;
  sessionId:  string;
  toolName:   string;
  toolInput:  unknown;
  createdAt:  number;
  resolve:    (decision: ApprovalDecision) => void;
}

export interface HookServerOpts {
  port:         number;
  timeoutMs?:   number;  // default: 5 minutes
  defaultOnTimeout?: ApprovalDecision;  // default: 'deny'
  /**
   * Called per-request. Return true if there's a real UI client (browser
   * tab, mobile PWA, …) that can respond to the approval prompt. When
   * this returns false, HookServer SKIPS the block-and-wait path entirely
   * and resolves with `defaultOnNoListener` (default: 'approve').
   *
   * Why this exists: pt-registry always attaches an internal listener
   * to `approvalRequested`, so a naive `listenerCount()` check is
   * useless. The daemon owns the answer ("is any browser actually
   * subscribed?") and hands it back via this callback.
   *
   * Without this, every Claude Code Write/Edit/destructive Bash call
   * across the user's entire machine hangs for `timeoutMs` waiting on
   * a UI that may never connect — which is exactly the bug we just
   * lived through.
   */
  hasViableListener?: (sessionId: string, toolName: string) => boolean;
  /** Decision returned when `hasViableListener` says no one's home.
   *  Default: 'deny' — fail CLOSED. The caller (pt-registry) computes an
   *  exposure-aware value and passes it explicitly (loopback → 'approve',
   *  tunnel/relay/non-loopback → 'deny'); this conservative fallback only
   *  applies if a caller forgets to. Denying still responds immediately,
   *  so it never reintroduces the global block-and-hang regression. */
  defaultOnNoListener?: ApprovalDecision;
  projectRoot?: string;  // for NOHUP.md injection
}

export class HookServer extends EventEmitter {
  private server:   http.Server;
  private pending = new Map<string, PendingApproval>();
  private timeoutMs: number;
  private defaultOnTimeout: ApprovalDecision;
  private defaultOnNoListener: ApprovalDecision;
  private hasViableListener: (sessionId: string, toolName: string) => boolean;
  private projectRoot?: string;

  constructor(private opts: HookServerOpts) {
    super();
    this.timeoutMs            = opts.timeoutMs           ?? 5 * 60 * 1000;
    this.defaultOnTimeout     = opts.defaultOnTimeout    ?? 'deny';
    this.defaultOnNoListener  = opts.defaultOnNoListener ?? 'deny';
    // Default to "no one is home" so when pt-registry isn't running or
    // hasn't wired a real check yet, we never block-and-hang a Claude
    // tool call — we resolve immediately via defaultOnNoListener (which
    // itself defaults to the fail-closed 'deny').
    this.hasViableListener    = opts.hasViableListener   ?? (() => false);
    this.projectRoot          = opts.projectRoot;
    this.server               = http.createServer(this.handle.bind(this));
  }

  /** Late-binding setter — pt-registry calls this once it knows how
   *  to answer the question (i.e. it can see browserClients). */
  setViableListenerCheck(fn: (sessionId: string, toolName: string) => boolean): void {
    this.hasViableListener = fn;
  }

  start() {
    // Fail-soft on EADDRINUSE: another pt-registry might still be alive,
    // or a stale process is squatting the port. Log loudly so the user
    // notices (approvals won't work until they free it) but don't take
    // the daemon down — the terminal-control half is the critical path.
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(
          `[hooks] port ${this.opts.port} in use — approval routing disabled. ` +
          `kill the squatting process or set POCKET_T_HOOK_PORT to a free port.`,
        );
      } else {
        console.warn(`[hooks] server error:`, err.message);
      }
    });
    this.server.listen(this.opts.port, '127.0.0.1', () => {
      console.log(`[hooks] listening on 127.0.0.1:${this.opts.port}`);
    });
  }

  // Called by RelayClient when user responds to approval on mobile
  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;
    this.pending.delete(approvalId);
    pending.resolve(decision);
    return true;
  }

  pendingCount(): number { return this.pending.size; }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    // Health check
    if (req.url === '/healthz') {
      res.writeHead(200).end('ok');
      return;
    }

    // Approval response from local (not relay — relay uses resolveApproval())
    if (req.method === 'POST' && req.url === '/hook/approve') {
      const body = await readBody(req);
      try {
        const { approvalId, decision } = JSON.parse(body) as {
          approvalId: string;
          decision:   ApprovalDecision;
        };
        const ok = this.resolveApproval(approvalId, decision);
        res.writeHead(ok ? 200 : 404).end(JSON.stringify({ ok }));
      } catch {
        res.writeHead(400).end('Bad request');
      }
      return;
    }

    // PreToolUse hook — the main path
    if (req.method === 'POST' && req.url === '/hook/preToolUse') {
      const body = await readBody(req);
      let payload: any = {};
      try { payload = JSON.parse(body || '{}'); } catch { /* ok */ }

      const sessionId = (req.headers['x-session'] as string) ?? 'unknown';
      const toolName  = payload?.tool_name ?? 'unknown';
      const toolInput = payload?.tool_input ?? {};

      const nohupContext = this.loadNohupContext();
      const needsApproval = this.toolRequiresApproval(toolName, toolInput);

      // Read-only / non-mutating tools never block.
      if (!needsApproval) {
        respondAllow(res, nohupContext);
        return;
      }

      // CRITICAL SAFETY VALVE: if nobody is actually watching for
      // approvals (no browser tab open, no relay connection alive),
      // do NOT block the Claude tool call. That's the regression that
      // hung every Write/Edit call globally on 2026-05-21. Fall
      // through to defaultOnNoListener (default: 'approve' — Claude's
      // own permission system still gates dangerous tools).
      if (!this.hasViableListener(sessionId, toolName)) {
        if (this.defaultOnNoListener === 'approve') {
          respondAllow(res, nohupContext, 'no UI listener — auto-approved');
        } else {
          respondDeny(res, 'no UI listener — auto-denied');
        }
        return;
      }

      // Real approval path: block waiting on a UI client.
      const approvalId = randomUUID();
      const decision   = await this.requestApproval(
        approvalId, sessionId, toolName, toolInput,
      );

      if (decision === 'approve') {
        respondAllow(res, nohupContext);
      } else {
        const reason = decision === 'timeout'
          ? `No response after ${this.timeoutMs / 1000}s — auto-${this.defaultOnTimeout}d`
          : 'denied by user';
        respondDeny(res, reason);
      }
      return;
    }

    res.writeHead(404).end();
  }

  private requestApproval(
    approvalId: string,
    sessionId:  string,
    toolName:   string,
    toolInput:  unknown,
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const pending: PendingApproval = {
        id: approvalId, sessionId, toolName, toolInput,
        createdAt: Date.now(),
        resolve,
      };
      this.pending.set(approvalId, pending);

      // Emit to RelayClient so it can push to the mobile UI
      this.emit('approvalRequested', {
        approvalId,
        sessionId,
        toolName,
        toolInput,
      });

      // Auto-resolve on timeout
      setTimeout(() => {
        if (this.pending.has(approvalId)) {
          this.pending.delete(approvalId);
          console.log(
            `[hooks] Approval ${approvalId} timed out → ${this.defaultOnTimeout}`
          );
          resolve(this.defaultOnTimeout);
        }
      }, this.timeoutMs);
    });
  }

  // Decide whether a tool call must be approved by the user.
  //
  // Claude Code sends PascalCase tool names (`Bash`, `Edit`, `Write`,
  // `MultiEdit`, `Read`, ...). The old lowercase-only matching never
  // matched, so the destructive-command gate failed OPEN and every write
  // auto-approved. Normalize case, gate write/edit tools explicitly, and
  // fail CLOSED: anything not provably read-only requires approval.
  private toolRequiresApproval(toolName: string, input: any): boolean {
    const t = String(toolName ?? '').toLowerCase();

    // Provably read-only / non-mutating — safe to auto-approve.
    const READ_ONLY = new Set([
      'read', 'glob', 'grep', 'ls', 'websearch', 'webfetch',
      'todowrite', 'notebookread',
      // legacy / API tool names
      'read_file', 'list_directory', 'web_search', 'web_fetch',
    ]);
    if (READ_ONLY.has(t)) return false;

    // Write / edit / filesystem-mutating tools always need approval.
    const WRITE_LIKE = new Set([
      'write', 'edit', 'multiedit', 'notebookedit',
      'str_replace_editor', 'computer',
    ]);
    if (
      WRITE_LIKE.has(t) ||
      t.includes('write')  || t.includes('edit')   ||
      t.includes('create') || t.includes('delete') || t.includes('move')
    ) {
      return true;
    }

    // Bash / shell: approve destructive commands. Fail closed if we cannot
    // read the command string (can't prove it's safe → require approval).
    if (t === 'bash' || t === 'shell' || t === 'sh') {
      const cmd = input?.command;
      if (typeof cmd !== 'string') return true;
      const lc = cmd.toLowerCase();
      const DESTRUCTIVE = [
        'rm ', 'rmdir', 'dd ', 'mkfs', 'fdisk', 'format',
        'git push', 'git force', 'npm publish', 'heroku',
        'kubectl delete', 'terraform destroy', 'fly destroy',
        'docker rm', 'docker rmi',
      ];
      return DESTRUCTIVE.some((d) => lc.includes(d));
    }

    // Unknown tool → fail closed (require approval).
    return true;
  }

  private loadNohupContext(): string {
    if (!this.projectRoot) return '';
    const nohupPath = join(this.projectRoot, 'NOHUP.md');
    if (!existsSync(nohupPath)) return '';
    try {
      const content = readFileSync(nohupPath, 'utf-8');
      return content.slice(0, 3000)
        ? `\n\n[Session Memory — read before proceeding]\n${content.slice(0, 3000)}`
        : '';
    } catch { return ''; }
  }
}

// Claude Code's hook output schema (current as of mid-2026):
//   {
//     "hookSpecificOutput": {
//       "hookEventName": "PreToolUse",
//       "permissionDecision":       "allow" | "deny" | "ask",
//       "permissionDecisionReason": "<string>",     // optional
//       "additionalContext":         "<string>"      // optional, only on allow
//     }
//   }
//
// Anything else (older `{decision, context, reason}` top-level shape, or
// extra unknown top-level fields) currently fails strict JSON validation
// and produces "Hook JSON output validation failed — (root): Invalid
// input". So we ONLY emit the new shape from these helpers.
function respondAllow(res: http.ServerResponse, additionalContext: string, reason?: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const out: any = {
    hookSpecificOutput: {
      hookEventName:      'PreToolUse',
      permissionDecision: 'allow',
    },
  };
  if (reason) out.hookSpecificOutput.permissionDecisionReason = reason;
  if (additionalContext) out.hookSpecificOutput.additionalContext = additionalContext;
  res.end(JSON.stringify(out));
}
function respondDeny(res: http.ServerResponse, reason: string): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    hookSpecificOutput: {
      hookEventName:            'PreToolUse',
      permissionDecision:        'deny',
      permissionDecisionReason:  reason,
    },
  }));
}

// A-014: cap the local hook request body (1 MiB) — destroy the socket if
// a caller streams more so a local process can't exhaust daemon memory.
const MAX_HOOK_BODY = 1024 * 1024;
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    let size = 0;
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_HOOK_BODY) { req.destroy(); resolve(body); return; }
      body += d.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(body));
  });
}
