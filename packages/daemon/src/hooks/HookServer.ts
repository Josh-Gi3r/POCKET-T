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
  projectRoot?: string;  // for NOHUP.md injection
}

export class HookServer extends EventEmitter {
  private server:   http.Server;
  private pending = new Map<string, PendingApproval>();
  private timeoutMs: number;
  private defaultOnTimeout: ApprovalDecision;
  private projectRoot?: string;

  constructor(private opts: HookServerOpts) {
    super();
    this.timeoutMs         = opts.timeoutMs        ?? 5 * 60 * 1000;
    this.defaultOnTimeout  = opts.defaultOnTimeout  ?? 'deny';
    this.projectRoot       = opts.projectRoot;
    this.server            = http.createServer(this.handle.bind(this));
  }

  start() {
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

      // Always inject NOHUP.md context if available
      const nohupContext = this.loadNohupContext();

      // Check if this tool requires approval
      const needsApproval = this.toolRequiresApproval(toolName, toolInput);

      if (!needsApproval) {
        // Auto-approve with context injection
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          decision: 'approve',
          context:  nohupContext,
        }));
        return;
      }

      // Block and wait for user decision
      const approvalId = randomUUID();
      const decision   = await this.requestApproval(
        approvalId, sessionId, toolName, toolInput,
      );

      const approved = decision === 'approve';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        decision: approved ? 'approve' : 'deny',
        context:  approved ? nohupContext : undefined,
        reason:   decision === 'timeout'
          ? `No response after ${this.timeoutMs / 1000}s — auto-${this.defaultOnTimeout}d`
          : undefined,
      }));
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

  // Tools that always require approval
  private toolRequiresApproval(toolName: string, input: any): boolean {
    const ALWAYS_APPROVE = new Set([
      'bash', 'computer', 'str_replace_editor',
    ]);
    const NEVER_APPROVE = new Set([
      'read_file', 'list_directory', 'web_search', 'web_fetch',
    ]);

    if (NEVER_APPROVE.has(toolName)) return false;
    if (ALWAYS_APPROVE.has(toolName)) return true;

    // Bash: require approval for destructive commands
    if (toolName === 'bash') {
      const cmd = (input?.command ?? '').toLowerCase();
      const DESTRUCTIVE = [
        'rm ', 'rmdir', 'dd ', 'mkfs', 'fdisk', 'format',
        'git push', 'git force', 'npm publish', 'heroku',
        'kubectl delete', 'terraform destroy', 'fly destroy',
        'docker rm', 'docker rmi',
      ];
      return DESTRUCTIVE.some((d) => cmd.includes(d));
    }

    // Write operations always need approval
    if (toolName.includes('write') || toolName.includes('create') ||
        toolName.includes('delete') || toolName.includes('move')) {
      return true;
    }

    return false;
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
