import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import sql from '../db/client.js';
import {
  signDaemonJwt,
  signClientJwt,
  verifyJwt,
} from '../auth/jwt.js';
import {
  getUserByEmail,
  createAccount,
  audit,
  upsertPushSub,
} from '../db/queries.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import type { Redis } from 'ioredis';

export async function authRoutes(app: FastifyInstance, redis: Redis) {
  const limiter = createRateLimiter(redis);

  // ── Register ─────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/register',
    async (req, reply) => {
      const { email, password } = req.body;
      if (!email || !password || password.length < 8) {
        return reply.code(400).send({
          error: 'Email and password (min 8 chars) required',
        });
      }

      const existing = await getUserByEmail(email);
      if (existing) {
        return reply.code(409).send({ error: 'Email already registered' });
      }

      const hash = await bcrypt.hash(password, 12);
      const { user, account } = await createAccount(email, hash);

      const token     = await signClientJwt(account.id, user.id);
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expires   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await sql`
        INSERT INTO web_sessions (user_id, token_hash, expires_at, ip)
        VALUES (${user.id}, ${tokenHash}, ${expires}, ${req.ip})
      `;

      reply.setCookie('pocket-t_sess', token, {
        httpOnly: true,
        secure:   true,
        sameSite: 'strict',
        path:     '/',
        expires,
      });

      return { ok: true, plan: 'free' };
    },
  );

  // ── Login ─────────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      if (!await limiter.login(req.ip)) {
        return reply.code(429).send({ error: 'Too many attempts' });
      }

      const { email, password } = req.body;
      const user = await getUserByEmail(email);

      if (!user || !await bcrypt.compare(password, user.passwordHash)) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const token     = await signClientJwt(user.accountId, user.id);
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expires   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await sql`
        INSERT INTO web_sessions (user_id, token_hash, expires_at, ip)
        VALUES (${user.id}, ${tokenHash}, ${expires}, ${req.ip})
      `;

      reply.setCookie('pocket-t_sess', token, {
        httpOnly: true,
        secure:   true,
        sameSite: 'strict',
        path:     '/',
        expires,
      });

      await audit({
        accountId: user.accountId,
        userId:    user.id,
        event:     'login',
        ip:        req.ip,
      });

      return { ok: true, plan: user.plan };
    },
  );

  // ── Logout ────────────────────────────────────────────────────────────
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.['pocket-t_sess'];
    if (token) {
      const hash = createHash('sha256').update(token).digest('hex');
      await sql`DELETE FROM web_sessions WHERE token_hash = ${hash}`.catch(() => {});
    }
    reply.clearCookie('pocket-t_sess', { path: '/' });
    return { ok: true };
  });

  // ── Me ────────────────────────────────────────────────────────────────
  app.get(
    '/api/auth/me',
    { onRequest: [requireAuth] },
    async (req: any) => ({
      userId:    req.userId,
      accountId: req.accountId,
      email:     req.email,
      plan:      req.plan,
    }),
  );

  // ── Generate daemon one-time token ────────────────────────────────────
  app.post(
    '/api/daemon/generate-token',
    { onRequest: [requireAuth] },
    async (req: any) => {
      const token     = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await sql`
        INSERT INTO one_time_tokens (account_id, token_hash, expires_at)
        VALUES (
          ${req.accountId},
          ${tokenHash},
          NOW() + INTERVAL '15 minutes'
        )
      `;
      await audit({
        accountId: req.accountId,
        userId:    req.userId,
        event:     'daemon_token_generated',
        ip:        req.ip,
      });
      return { token };
    },
  );

  // ── Daemon auth (exchange one-time token for JWT) ─────────────────────
  app.post<{ Body: { oneTimeToken: string } }>(
    '/api/daemon/auth',
    async (req, reply) => {
      const { oneTimeToken } = req.body;
      if (!oneTimeToken) {
        return reply.code(400).send({ error: 'Missing token' });
      }

      const tokenHash = createHash('sha256').update(oneTimeToken).digest('hex');
      const [ott]     = await sql`
        SELECT * FROM one_time_tokens
        WHERE token_hash = ${tokenHash}
          AND used = FALSE
          AND expires_at > NOW()
      `;

      if (!ott) {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }

      await sql`
        UPDATE one_time_tokens SET used = TRUE WHERE id = ${ott.id}
      `;

      const daemonId = randomUUID();
      const jti      = randomUUID();

      await sql`
        INSERT INTO daemons (id, account_id, jwt_jti)
        VALUES (${daemonId}, ${ott.accountId}, ${jti})
      `;

      const daemonJwt = await signDaemonJwt(ott.accountId, daemonId, jti);

      await audit({
        accountId: ott.accountId,
        event:     'daemon_authenticated',
        meta:      { daemonId },
        ip:        req.ip,
      });

      return { daemonJwt, daemonId, accountId: ott.accountId };
    },
  );

  // ── List daemons ──────────────────────────────────────────────────────
  app.get(
    '/api/daemons',
    { onRequest: [requireAuth] },
    async (req: any) => {
      const rows = await sql`
        SELECT
          id, name, hostname,
          last_seen_at AS "lastSeenAt",
          created_at   AS "createdAt"
        FROM daemons
        WHERE account_id = ${req.accountId}
        ORDER BY last_seen_at DESC
      `;
      return { daemons: rows };
    },
  );

  // ── Push subscribe ────────────────────────────────────────────────────
  app.post<{
    Body: { endpoint: string; keys: { p256dh: string; auth: string } };
  }>(
    '/api/push/subscribe',
    { onRequest: [requireAuth] },
    async (req: any) => {
      const { endpoint, keys } = req.body;
      await upsertPushSub(req.userId, endpoint, keys.p256dh, keys.auth);
      return { ok: true };
    },
  );

  // ── Session history (REST) ────────────────────────────────────────────
  app.get<{
    Params: { sessionId: string };
    Querystring: { before?: string; limit?: string };
  }>(
    '/api/sessions/:sessionId/messages',
    { onRequest: [requireAuth] },
    async (req: any, reply) => {
      const { sessionId } = req.params;
      const before  = req.query.before ? Number(req.query.before) : undefined;
      const limit   = Math.min(Number(req.query.limit ?? 100), 200);

      const [row] = await sql`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND account_id = ${req.accountId}
      `;
      if (!row) return reply.code(404).send({ error: 'Not found' });

      const { getHistory } = await import('../db/queries.js');
      const messages = await getHistory(sessionId, limit, before);
      return { messages, hasMore: messages.length === limit };
    },
  );

  // ── Approval via REST (from push notification action) ─────────────────
  app.post<{
    Params: { sessionId: string };
    Body: { choice: string; messageId: string };
  }>(
    '/api/sessions/:sessionId/approve',
    { onRequest: [requireAuth] },
    async (req: any, reply) => {
      const { sessionId }         = req.params;
      const { choice, messageId } = req.body;

      const [row] = await sql`
        SELECT id FROM sessions
        WHERE id = ${sessionId} AND account_id = ${req.accountId}
      `;
      if (!row) return reply.code(404).send({ error: 'Not found' });

      const { resolveApproval } = await import('../db/queries.js');
      const resolved = await resolveApproval(messageId, choice);
      if (!resolved) return reply.code(409).send({ error: 'Already resolved' });

      const io = (app as any).io;
      if (io) {
        io.of('/daemon')
          .to(`account:${req.accountId}`)
          .emit('relay:cmd:input', { sessionId, text: choice });
      }

      await audit({
        accountId: req.accountId,
        sessionId,
        event:     'approval_via_push',
        meta:      { choice },
      });

      return { ok: true };
    },
  );

  // ── E2E pairing URL (daemon calls this after connecting) ──────────────
  app.post<{
    Params: { sessionId: string };
    Body: { outputKey: string; inputKey: string };
  }>(
    '/api/sessions/:sessionId/pair',
    { onRequest: [requireDaemonAuth] },
    async (req: any) => {
      const { sessionId } = req.params;
      const { outputKey, inputKey } = req.body as {
        outputKey: string;
        inputKey:  string;
      };

      // Store temporarily in Redis with 5-min TTL
      await redis.setex(
        `pair:${sessionId}`,
        300,
        JSON.stringify({ outputKey, inputKey }),
      );

      const fragment   = `outputKey=${encodeURIComponent(outputKey)}&inputKey=${encodeURIComponent(inputKey)}`;
      const pairingUrl = `${process.env.APP_URL}/pair/${sessionId}#${fragment}`;

      return { pairingUrl };
    },
  );
}

// ── Auth middleware ───────────────────────────────────────────────────────

export async function requireAuth(req: any, reply: any) {
  const token = req.cookies?.['pocket-t_sess'];
  if (!token) return reply.code(401).send({ error: 'Unauthorized' });

  try {
    const payload = await verifyJwt(token) as any;
    if (payload.scope !== 'client') throw new Error('wrong scope');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [sess]    = await sql`
      SELECT ws.*, u.email, a.plan
      FROM web_sessions ws
      JOIN users u ON u.id = ws.user_id
      JOIN accounts a ON a.id = u.account_id
      WHERE ws.token_hash = ${tokenHash}
        AND ws.expires_at > NOW()
    `;
    if (!sess) throw new Error('session expired');

    req.accountId = payload.accountId;
    req.userId    = payload.userId;
    req.plan      = sess.plan;
    req.email     = sess.email;
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Daemon-scoped bearer auth (daemons authenticate with their JWT, not cookies)
export async function requireDaemonAuth(req: any, reply: any) {
  const header = req.headers?.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).send({ error: 'Unauthorized' });

  try {
    const payload = await verifyJwt(token) as any;
    if (payload.scope !== 'daemon') throw new Error('wrong scope');
    req.accountId = payload.accountId;
    req.daemonId  = payload.daemonId;
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
