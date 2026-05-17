# Self-hosting pocket-t

pocket-t is MIT licensed and fully self-hostable. You run the relay; you own
the data.

## Prerequisites

- Node.js 20+, pnpm 9+
- Postgres (Neon, or the bundled Docker `postgres`)
- Redis (Upstash, or the bundled Docker `redis`)
- VAPID keys: `npx web-push generate-vapid-keys`

## Option A — Docker Compose (easiest)

```bash
git clone https://github.com/your-org/pocket-t
cd pocket-t

cat > infra/.env <<'EOF'
JWT_SECRET=            # openssl rand -hex 32
COOKIE_SECRET=         # openssl rand -hex 32
VAPID_PUBLIC=          # npx web-push generate-vapid-keys
VAPID_PRIVATE=
VAPID_CONTACT=ops@example.com
APP_URL=http://localhost:3000
EOF

docker compose -f infra/docker-compose.yml up -d
curl http://localhost:4000/healthz   # → {"ok":true}
```

The Postgres container auto-applies `packages/relay/src/db/schema.sql` on
first boot.

## Option B — Local dev (four terminals)

```bash
pnpm install
pnpm --filter @pocket-t/shared build
psql "$DATABASE_URL" -f packages/relay/src/db/schema.sql

# 1: relay
cd packages/relay && cp .env.example .env && $EDITOR .env && pnpm dev
# 2: web
cd packages/web && echo "VITE_VAPID_PUBLIC=$VAPID_PUBLIC" > .env && pnpm dev
# 3: daemon
cd packages/daemon && pnpm build
POCKET_T_RELAY_URL=ws://localhost:4000 node dist/main.js auth <token>
POCKET_T_RELAY_URL=ws://localhost:4000 node dist/main.js run
# 4: a process to watch (bash, python3, claude, …)
```

Get the one-time `<token>` from the web Dashboard page after creating an
account.

## Pointing the daemon at your relay

The daemon reads `POCKET_T_RELAY_URL` (default `wss://relay.pocket-t.app`).
Set it to your own relay's URL before `auth` and `run`.
