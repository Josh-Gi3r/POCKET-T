import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { verifyClientToken, cookieValue, SESS_COOKIE } from '../auth/session.js';
import {
  getSessionsByAccount,
  getHistory,
  saveMessage,
  resolveApprovalScoped,
  audit,
  updateSession,
  upsertPushSub,
} from '../db/queries.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
// checkSessionLimit (middleware/planGate.ts) is Phase 2 — not enforced yet.
import sql from '../db/client.js';

export function setupClientNamespace(io: Server, redis: Redis) {
  const ns      = io.of('/client');
  const limiter = createRateLimiter(redis);

  // ── Auth middleware (A-001/A-002): authenticate from the httpOnly
  // session cookie and revalidate against web_sessions every connection. ──
  ns.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, SESS_COOKIE);
      if (!token) return next(new Error('no session cookie'));
      const ctx = await verifyClientToken(token);
      socket.data.accountId = ctx.accountId;
      socket.data.userId    = ctx.userId;
      socket.data.email     = ctx.email;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  ns.on('connection', async (socket: Socket) => {
    const { accountId, userId } = socket.data as {
      accountId: string;
      userId:    string;
    };

    socket.join(`account:${accountId}`);

    // Send current sessions immediately
    const sessions = await getSessionsByAccount(accountId);
    socket.emit('relay:sessions', { sessions });

    // ── Attach to session ────────────────────────────────────────────
    socket.on('client:session:attach', async ({
      sessionId, lastSeq,
    }: { sessionId: string; lastSeq?: number }) => {
      // Ownership check — critical security gate
      const [row] = await sql`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND account_id = ${accountId}
      `;
      if (!row) {
        socket.emit('relay:error', {
          code:    'NOT_FOUND',
          message: 'Session not found',
        });
        return;
      }

      socket.join(`session:${sessionId}`);
      socket.join(`session:${sessionId}:pending`);

      // Load history
      const messages = await getHistory(sessionId, 200, lastSeq);
      socket.emit('relay:session:history', {
        sessionId,
        messages,
        hasMore: messages.length === 200,
      });

      // Ask daemon for current screen snapshot
      io.of('/daemon')
        .to(`account:${accountId}`)
        .emit('relay:cmd:attach', { sessionId });

      await audit({ accountId, userId, sessionId, event: 'session_attached' });
    });

    // ── Detach from session ──────────────────────────────────────────
    socket.on('client:session:detach', ({ sessionId }: { sessionId: string }) => {
      socket.leave(`session:${sessionId}`);
      socket.leave(`session:${sessionId}:pending`);
    });

    // ── Send input ───────────────────────────────────────────────────
    socket.on('client:session:input', async ({
      sessionId, text,
    }: { sessionId: string; text: string }) => {
      if (!await limiter.inputWrite(accountId, sessionId)) {
        socket.emit('relay:error', { code: 'RATE_LIMITED', message: 'Slow down' });
        return;
      }

      const [row] = await sql`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND account_id = ${accountId}
      `;
      if (!row) return;

      await saveMessage({
        sessionId,
        accountId,
        role: 'user',
        kind: 'text',
        text,
        seq:  Date.now(),
      }).catch(() => {});

      // Forward to daemon (append \r = Enter key)
      io.of('/daemon')
        .to(`account:${accountId}`)
        .emit('relay:cmd:input', { sessionId, text: text + '\r' });

      await audit({
        accountId,
        userId,
        sessionId,
        event: 'input_sent',
        meta:  { length: text.length },
      });
    });

    // ── Approval response ────────────────────────────────────────────
    socket.on('client:approval:respond', async ({
      sessionId, messageId, choice,
    }: { sessionId: string; messageId: string; choice: string }) => {
      // A-005: bind resolution to caller's account + session + approval kind
      const resolved = await resolveApprovalScoped(messageId, sessionId, accountId, choice);
      if (!resolved) return; // not owned, not an approval, or already resolved

      io.of('/daemon')
        .to(`account:${accountId}`)
        .emit('relay:cmd:input', { sessionId, text: choice });

      await updateSession(sessionId, 'running').catch(() => {});

      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:session:update', {
          session: { id: sessionId, status: 'running' as const },
        });

      // Team: broadcast who resolved the approval
      const [u] = await sql`SELECT email FROM users WHERE id = ${userId}`;
      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:approval:resolved', {
          sessionId,
          messageId,
          choice,
          resolvedBy: u?.email ?? userId,
        });

      await audit({
        accountId,
        userId,
        sessionId,
        event: 'approval_resolved',
        meta:  { choice, messageId },
      });
    });

    // ── Spawn session ────────────────────────────────────────────────
    socket.on('client:session:spawn', async ({
      name, cmd, cwd,
    }: { name: string; cmd: string; cwd: string }) => {
      if (!await limiter.spawn(accountId)) {
        socket.emit('relay:error', {
          code:    'RATE_LIMITED',
          message: 'Too many spawns',
        });
        return;
      }

      // Plan-limit enforcement is Phase 2 (hosted plans). pocket-t is
      // fully free & open source — no session caps. checkSessionLimit()
      // is retained in middleware/planGate.ts for a future phase.

      io.of('/daemon')
        .to(`account:${accountId}`)
        .emit('relay:cmd:spawn', { name, cmd, cwd: cwd || '~' });

      await audit({
        accountId,
        userId,
        event: 'session_spawned',
        meta:  { name, cmd },
      });
    });

    // ── Kill session ─────────────────────────────────────────────────
    socket.on('client:session:kill', async ({
      sessionId, signal,
    }: { sessionId: string; signal?: string }) => {
      const [row] = await sql`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND account_id = ${accountId}
      `;
      if (!row) return;

      io.of('/daemon')
        .to(`account:${accountId}`)
        .emit('relay:cmd:kill', {
          sessionId,
          signal: signal ?? 'SIGTERM',
        });

      await audit({ accountId, userId, sessionId, event: 'session_killed' });
    });

    // ── Push subscription ────────────────────────────────────────────
    socket.on('client:push:subscribe', async ({
      endpoint, p256dh, auth,
    }: { endpoint: string; p256dh: string; auth: string }) => {
      await upsertPushSub(userId, endpoint, p256dh, auth).catch(() => {});
    });

    // ── Hook approval resolution (V2 blocking approval) ──────────────
    socket.on('client:hook:approve', async ({
      approvalId, sessionId, decision,
    }: { approvalId: string; sessionId: string; decision: 'approve' | 'deny' }) => {
      // Verify session ownership
      const [row] = await sql`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND account_id = ${accountId}
      `;
      if (!row) return;

      // Route to daemon
      io.of('/daemon')
        .to(`account:${accountId}`)
        .emit('relay:cmd:approveHook', { approvalId, decision });

      await audit({
        accountId, userId, sessionId,
        event: 'hook_approval',
        meta:  { approvalId, decision, toolName: 'unknown' },
      });
    });
  });
}
