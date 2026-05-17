import Fastify from 'fastify';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import FastifyCookie from '@fastify/cookie';
import FastifyCors from '@fastify/cors';
import { setupDaemonNamespace } from './sockets/daemonNs.js';
import { setupClientNamespace } from './sockets/clientNs.js';
import { authRoutes } from './api/auth.js';
import { billingRoutes } from './api/billing.js';
import { teamRoutes } from './api/team.js';

// ── Validate environment ──────────────────────────────────────────────────
const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'VAPID_PUBLIC',
  'VAPID_PRIVATE',
  'APP_URL',
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[relay] Missing required env var: ${key}`);
    process.exit(1);
  }
}

// A socket handler that throws (e.g. a bad DB query) must not take the whole
// relay — and every other connected user's live session — down with it.
// Log and keep serving; the offending request just fails.
process.on('unhandledRejection', (reason) => {
  console.error('[relay] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[relay] uncaughtException:', err);
});

// ── Fastify ───────────────────────────────────────────────────────────────
// A-013: don't blindly trust X-Forwarded-* . TRUST_PROXY is the hop count
// of trusted proxies in front of the relay (Fly = 1). Set explicitly per
// deployment; defaults to 1, never the wide-open `true`.
const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? '1');
const app = Fastify({
  logger:      { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy:  Number.isFinite(TRUST_PROXY) ? TRUST_PROXY : 1,
});

await app.register(FastifyCookie, {
  secret: process.env.COOKIE_SECRET!,
  hook:   'onRequest',
});

await app.register(FastifyCors, {
  origin:      process.env.APP_URL!,
  credentials: true,
  methods:     ['GET', 'POST', 'DELETE', 'OPTIONS'],
});

// A-012: baseline security headers (the relay is a JSON API — lock it down).
app.addHook('onRequest', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

// Raw body for Stripe webhook signature verification (opt-in per route)
await app.register(import('fastify-raw-body'), {
  field:    'rawBody',
  global:   false,
  runFirst: true,
});

// ── Redis ─────────────────────────────────────────────────────────────────
const pubClient = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});
pubClient.on('error', (e) => console.error('[redis]', e.message));

// ── Socket.IO ─────────────────────────────────────────────────────────────
// Attach to Fastify's own HTTP server. (The previous createServer(app.server)
// produced a server with no request handler — Fastify routes hung forever.)
const io         = new Server(app.server, {
  cors: { origin: process.env.APP_URL!, credentials: true },
  transports:    ['websocket'],
  path:          '/socket.io',
  pingInterval:  25_000,
  pingTimeout:   20_000,
  // Replay missed events when mobile clients reconnect after dropping LTE.
  // Client sends last processed event offset; relay replays the gap.
  // maxDisconnectionDuration: 2 min covers most LTE handoffs.
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    // A-002: re-run auth middleware on recovered connections so logout /
    // session revocation cannot be bypassed via the recovery window.
    skipMiddlewares:          false,
  },
});

// The Redis adapter is only needed to fan out across MULTIPLE relay nodes.
// On a single relay (local dev, and the default single Fly machine) the
// default in-memory adapter is correct — the Redis adapter was dropping
// single-node room broadcasts (spawn/input/chunk never reached the daemon).
// Opt in for true multi-region with POCKET_T_REDIS_ADAPTER=1.
if (process.env.POCKET_T_REDIS_ADAPTER === '1') {
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
  console.log('[relay] Redis Socket.IO adapter enabled (multi-node)');
}

// Attach io to app so REST handlers can emit
(app as any).io = io;

// ── Namespaces ────────────────────────────────────────────────────────────
setupDaemonNamespace(io);
setupClientNamespace(io, pubClient);

// ── Routes ────────────────────────────────────────────────────────────────
await authRoutes(app, pubClient);

// Phase 2 (paid hosting). Billing/team route registration is gated off by
// default — their auth/data model is incomplete (audit A-010). Flip
// POCKET_T_PHASE2=1 only once that work lands.
if (process.env.POCKET_T_PHASE2 === '1') {
  await billingRoutes(app);
  await teamRoutes(app);
}

app.get('/healthz', async () => ({ ok: true, ts: Date.now() }));

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);
await app.ready();              // wires Socket.IO onto app.server
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`[relay] listening on :${PORT}`);
console.log(`[relay] app url: ${process.env.APP_URL}`);

// ── Graceful shutdown ─────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[relay] shutting down...');
  io.close();
  await pubClient.quit();
  process.exit(0);
});
