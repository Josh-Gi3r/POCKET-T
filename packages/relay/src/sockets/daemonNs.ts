import type { Server, Socket } from 'socket.io';
import { verifyJwt, type DaemonTokenPayload } from '../auth/jwt.js';
import {
  upsertSession,
  saveMessage,
  updateSession,
  resolveApproval,
  audit,
} from '../db/queries.js';
import sql from '../db/client.js';
import {
  notifyApproval,
  notifyDead,
} from '../push/notify.js';
import type { ApprovalOption, Session } from '@pocket-t/shared';

export function setupDaemonNamespace(io: Server) {
  const ns = io.of('/daemon');

  // ── Auth middleware ──────────────────────────────────────────────────
  ns.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('no token'));

      const payload = await verifyJwt(token);
      if (payload.scope !== 'daemon') return next(new Error('wrong scope'));

      socket.data.accountId = payload.accountId;
      socket.data.daemonId  = (payload as DaemonTokenPayload).daemonId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  ns.on('connection', async (socket: Socket) => {
    const { accountId, daemonId } = socket.data as {
      accountId: string;
      daemonId:  string;
    };

    console.log(`[daemon] connected: ${daemonId}`);
    socket.join(`account:${accountId}`);
    socket.join(`daemon:${daemonId}`);

    // Update last seen
    await sql`
      UPDATE daemons
      SET last_seen_at = NOW(),
          hostname     = ${
            (socket.handshake.headers['x-hostname'] as string) ?? null
          }
      WHERE id = ${daemonId}
    `.catch(() => {});

    // Notify browser clients this daemon is online
    io.of('/client')
      .to(`account:${accountId}`)
      .emit('relay:daemon:status', { daemonId, online: true });

    // ── Full session list (on connect) ──────────────────────────────
    socket.on('daemon:sessions', async ({ sessions }: { sessions: Session[] }) => {
      for (const s of sessions) {
        await upsertSession(s).catch(() => {});
      }
      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:sessions', { sessions });
    });

    // ── Session update ───────────────────────────────────────────────
    socket.on('daemon:session:update', async ({
      session,
    }: { session: Partial<Session> & { id: string } }) => {
      if (session.id && session.status) {
        await updateSession(session.id, session.status, session.lastOutput)
          .catch(() => {});
      }
      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:session:update', { session });
    });

    // ── PTY chunk: persist + fan out ────────────────────────────────
    socket.on('daemon:session:chunk', async ({
      sessionId, text, rawVt, seq,
    }: { sessionId: string; text: string; rawVt: string; seq: number }) => {
      // Persist asynchronously (don't block the stream)
      saveMessage({
        sessionId,
        accountId,
        role: 'cli',
        kind: 'text',
        text,
        rawVt,
        seq,
      }).catch(() => {});

      updateSession(sessionId, 'running', text, seq).catch(() => {});

      // Fan out only to clients attached to this session
      io.of('/client')
        .to(`session:${sessionId}`)
        .emit('relay:session:chunk', { sessionId, text, rawVt, seq });
    });

    // ── Snapshot (for newly attached clients) ────────────────────────
    socket.on('daemon:session:snapshot', ({
      sessionId, plainText, rawVt,
    }: { sessionId: string; plainText: string; rawVt: string }) => {
      io.of('/client')
        .to(`session:${sessionId}:pending`)
        .emit('relay:session:snapshot', { sessionId, plainText, rawVt });
    });

    // ── Approval prompt ──────────────────────────────────────────────
    socket.on('daemon:session:approval', async ({
      sessionId, messageId, options,
    }: {
      sessionId: string;
      messageId: string;
      options:   ApprovalOption[];
    }) => {
      await saveMessage({
        sessionId,
        accountId,
        role:            'cli',
        kind:            'approval',
        text:            options.map((o) => o.label).join(' / '),
        seq:             Date.now(),
        approvalOptions: options,
        approvalPending: true,
      }).catch(() => {});

      await updateSession(sessionId, 'waiting').catch(() => {});

      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:session:update', {
          session: { id: sessionId, status: 'waiting' as const },
        });

      // Push if no client is attached
      const room = io.of('/client').adapter.rooms.get(`session:${sessionId}`);
      if (!room?.size) {
        const [row] = await sql`
          SELECT name FROM sessions WHERE id = ${sessionId}
        `;
        if (row) {
          await notifyApproval(
            accountId, row.name, sessionId, messageId, options,
          ).catch(() => {});
        }
      }

      await audit({
        accountId,
        sessionId,
        event: 'approval_requested',
        meta:  { messageId },
      });
    });

    // ── Session exit ─────────────────────────────────────────────────
    socket.on('daemon:session:exit', async ({
      sessionId, exitCode,
    }: { sessionId: string; exitCode: number }) => {
      await updateSession(sessionId, 'dead').catch(() => {});

      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:session:update', {
          session: { id: sessionId, status: 'dead' as const },
        });

      // Push if no client attached
      const room = io.of('/client').adapter.rooms.get(`session:${sessionId}`);
      if (!room?.size) {
        const [row] = await sql`
          SELECT name FROM sessions WHERE id = ${sessionId}
        `;
        if (row) {
          await notifyDead(accountId, row.name, sessionId).catch(() => {});
        }
      }
    });

    // ── Hook approval request (V2 blocking approval) ─────────────────
    socket.on('daemon:hook:approval', async ({
      approvalId, sessionId, toolName, toolInput,
    }: {
      approvalId: string;
      sessionId:  string;
      toolName:   string;
      toolInput:  string;
    }) => {
      // Fan out to all clients watching this account
      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:hook:approval', {
          approvalId, sessionId, toolName, toolInput,
        });

      // Push notification for hook approvals too
      const room = io.of('/client').adapter.rooms.get(`session:${sessionId}`);
      if (!room?.size) {
        const [row] = await sql`
          SELECT name FROM sessions WHERE id = ${sessionId}
        `;
        if (row) {
          await notifyApproval(
            accountId, row.name, sessionId, approvalId,
            [
              { key: 'approve', label: `Allow ${toolName}`, variant: 'primary' },
              { key: 'deny',    label: 'Deny',               variant: 'danger'  },
            ],
          ).catch(() => {});
        }
      }
    });

    // ── Disconnect ───────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[daemon] disconnected: ${daemonId} (${reason})`);
      io.of('/client')
        .to(`account:${accountId}`)
        .emit('relay:daemon:status', { daemonId, online: false });
    });
  });
}
