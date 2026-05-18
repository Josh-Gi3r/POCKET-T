import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
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

  // Resolve the daemon that owns a session so commands target ONLY that
  // daemon's socket room (`daemon:<id>`) instead of fanning out to every
  // Mac on the account (`account:<id>`), which made a spawn/input/kill run
  // on all of an account's machines.
  async function ownerDaemon(
    sessionId: string,
    accountId: string,
  ): Promise<string | null> {
    const [row] = await sql`
      SELECT daemon_id AS "daemonId" FROM sessions
      WHERE id = ${sessionId} AND account_id = ${accountId}
    `;
    return row?.daemonId ?? null;
  }

  // Online daemons for an account (a daemon socket joins both
  // `account:<id>` and `daemon:<id>` in the /daemon namespace).
  function onlineDaemons(accountId: string): string[] {
    const ids: string[] = [];
    for (const dsock of io.of('/daemon').sockets.values()) {
      const d = dsock.data as { accountId?: string; daemonId?: string };
      if (d?.accountId === accountId && d?.daemonId) ids.push(d.daemonId);
    }
    return ids;
  }

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
      // Bind the live socket to its web_session so logout can force-drop
      // it. verifyClientToken only revalidates on (re)connect, so without
      // this an open socket keeps streaming after the session is revoked.
      socket.data.sessHash  =
        createHash('sha256').update(token).digest('hex');
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

    // Register all socket.on(...) handlers synchronously before any await
    // (Socket.IO drops events that arrive before their listener is bound).
    // The initial session snapshot is emitted afterwards.

    // ── Attach to session ────────────────────────────────────────────
    socket.on('client:session:attach', async ({
      sessionId, lastSeq,
    }: { sessionId: string; lastSeq?: number }) => {
      // Ownership check — critical security gate
      const daemonId = await ownerDaemon(sessionId, accountId);
      if (!daemonId) {
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

      // Ask ONLY the owning daemon for the current screen snapshot
      io.of('/daemon')
        .to(`daemon:${daemonId}`)
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
      // A-014: bound stdin payloads (32 KiB) before persisting/forwarding.
      if (typeof text !== 'string' || text.length > 32 * 1024) {
        socket.emit('relay:error', { code: 'BAD_INPUT', message: 'Input too large' });
        return;
      }
      if (!await limiter.inputWrite(accountId, sessionId)) {
        socket.emit('relay:error', { code: 'RATE_LIMITED', message: 'Slow down' });
        return;
      }

      const daemonId = await ownerDaemon(sessionId, accountId);
      if (!daemonId) return;

      await saveMessage({
        sessionId,
        accountId,
        role: 'user',
        kind: 'text',
        text,
        seq:  Date.now(),
      }).catch(() => {});

      // Forward raw text to the owning daemon ONLY. Submit (Enter) is owned
      // by the daemon: PtyHost appends \r, the tmux path sends a dedicated
      // Enter key — appending \r here too caused a double-submit.
      io.of('/daemon')
        .to(`daemon:${daemonId}`)
        .emit('relay:cmd:input', { sessionId, text });

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
      // A-005: bind resolution to caller's account + session + approval
      // kind, AND require `choice` to be one of the stored option keys —
      // an arbitrary string here is injected straight into the pane.
      const resolved = await resolveApprovalScoped(messageId, sessionId, accountId, choice);
      if (!resolved) return; // not owned, not an approval, bad choice, or resolved

      const daemonId = await ownerDaemon(sessionId, accountId);
      if (!daemonId) return;

      io.of('/daemon')
        .to(`daemon:${daemonId}`)
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
      // A-014: bound spawn fields before forwarding to the daemon.
      if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 4096 ||
          (name != null && (typeof name !== 'string' || name.length > 256)) ||
          (cwd  != null && (typeof cwd  !== 'string' || cwd.length  > 4096))) {
        socket.emit('relay:error', { code: 'BAD_INPUT', message: 'Invalid spawn request' });
        return;
      }
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

      // No session exists yet, so route by an online daemon for the
      // account rather than broadcasting the spawn to every Mac.
      const online = onlineDaemons(accountId);
      if (online.length === 0) {
        socket.emit('relay:error', {
          code:    'NO_DAEMON',
          message: 'No Mac is online to start a session',
        });
        return;
      }
      io.of('/daemon')
        .to(`daemon:${online[0]}`)
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
      const daemonId = await ownerDaemon(sessionId, accountId);
      if (!daemonId) return;

      io.of('/daemon')
        .to(`daemon:${daemonId}`)
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
      // Verify session ownership + resolve the owning daemon
      const daemonId = await ownerDaemon(sessionId, accountId);
      if (!daemonId) return;

      // Route to the owning daemon ONLY
      io.of('/daemon')
        .to(`daemon:${daemonId}`)
        .emit('relay:cmd:approveHook', { approvalId, decision });

      await audit({
        accountId, userId, sessionId,
        event: 'hook_approval',
        meta:  { approvalId, decision, toolName: 'unknown' },
      });
    });

    // ── Initial snapshot (now that every handler is bound) ───────────
    const sessions = await getSessionsByAccount(accountId);
    socket.emit('relay:sessions', { sessions });

    // Tell this client which of its daemons are already online. Without
    // this, a client that connects AFTER its daemon never learns the
    // daemon is up (relay:daemon:status is only emitted on daemon connect).
    for (const dsock of io.of('/daemon').sockets.values()) {
      const d = dsock.data as { accountId?: string; daemonId?: string };
      if (d?.accountId === accountId && d?.daemonId) {
        socket.emit('relay:daemon:status', { daemonId: d.daemonId, online: true });
      }
    }
  });
}
