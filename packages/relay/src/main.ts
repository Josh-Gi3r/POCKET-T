import Fastify from 'fastify';
import { createServer } from 'node:http';
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

// ── Fastify ───────────────────────────────────────────────────────────────
const app = Fastify({
  logger:      { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy:  true,
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
const subClient = pubClient.duplicate();

pubClient.on('error', (e) => console.error('[redis]', e.message));

// ── Socket.IO ─────────────────────────────────────────────────────────────
const httpServer = createServer(app.server);
const io         = new Server(httpServer, {
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
    skipMiddlewares:          true,
  },
});

io.adapter(createAdapter(pubClient, subClient));

// Attach io to app so REST handlers can emit
(app as any).io = io;

// ── Namespaces ────────────────────────────────────────────────────────────
setupDaemonNamespace(io);
setupClientNamespace(io, pubClient);

// ── Routes ────────────────────────────────────────────────────────────────
await authRoutes(app, pubClient);
await billingRoutes(app);
await teamRoutes(app);

app.get('/healthz', async () => ({ ok: true, ts: Date.now() }));

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);
await app.ready();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[relay] listening on :${PORT}`);
  console.log(`[relay] app url: ${process.env.APP_URL}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[relay] shutting down...');
  io.close();
  await pubClient.quit();
  process.exit(0);
});
