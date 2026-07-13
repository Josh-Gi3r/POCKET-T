# Self-hosting the pocket-t relay hub

pocket-t is MIT licensed. The default remote-access path is a free Cloudflare
Quick Tunnel — you don't have to host anything. The **relay hub** is an
*optional* alternative: run it yourself if you'd rather not have Cloudflare in
the path, or want a stable URL on infrastructure you control.

The hub is a **stateless ws-v3 WebSocket multiplexer** — a dumb pipe. There is
**no Postgres, no Redis, no JWT/VAPID secrets, no Stripe, no Fastify, no
Socket.IO, and no database.** Daemons dial in with a token, browsers dial in
with the same token, and the hub pipes binary frames between same-token peers.
Tokens are just shared strings (typically your daemonId).

## Prerequisites

- Docker (Option A), or a Fly.io account (Option B), or Node.js 22+ + pnpm 10+
  to build from source (Option C).
- A reverse proxy (Caddy, nginx, Cloudflare Tunnel) or Fly.io's edge to
  TLS-terminate in front of the hub, so the daemon and browser can dial `wss://`.

## Option A — Docker Compose (easiest)

```bash
git clone https://github.com/Josh-Gi3r/POCKET-T
cd POCKET-T

# Builds infra/Dockerfile.relay and starts the hub. No env file required.
POCKET_T_HUB_PORT=4080 docker compose -f infra/docker-compose.yml up -d

# Health check: the hub serves its browser page at GET / (200 HTML).
curl -sI http://localhost:4080/ | head -1        # → HTTP/1.1 200 OK
```

The only configuration the hub reads is `POCKET_T_HUB_PORT` (default `4080`)
and `POCKET_T_HUB_HOST` (default `0.0.0.0`). Both are set in
`infra/docker-compose.yml`.

## Option B — Fly.io

`infra/fly.toml` deploys the hub on a 256 MB shared-CPU VM with TLS at the edge.

```bash
fly launch --copy-config --name <your-app-name>
fly deploy
```

## Option C — Build and run from source

```bash
pnpm install
pnpm --filter @pocket-t/shared build   # shared types — build first
pnpm --filter @pocket-t/relay build
POCKET_T_HUB_PORT=4080 node packages/relay/dist/wsv3-hub.js
```

Or for live-reload development: `pnpm --filter @pocket-t/relay dev`.

## Pointing the daemon at your hub

The daemon takes a `--relay <wss-url>` flag. Point it at your hub's `/ws/pt`
endpoint with `role=daemon` and a token:

```bash
pocket serve --relay "wss://your-host/ws/pt?role=daemon&t=<token>"
```

The browser connects to the same host with `role=client` and the **same
token** — the hub pipes frames between them. Open `https://your-host/` in a
browser and it dials `role=client` automatically using the token in the URL.
Any two peers sharing a token are connected; the hub keeps no auth state, so
**treat the token like a password.**

## Endpoints the hub exposes

Single HTTP server on `$POCKET_T_HUB_PORT` (default `4080`):

- `GET /` — embedded xterm.js browser page.
- `WS /ws/pt?role=daemon&t=<token>` — daemon registers under account `<token>`.
- `WS /ws/pt?role=client&t=<token>` — browser subscribes under account `<token>`.

There is no REST API, no `/healthz`, and no persistence — a restart drops all
live connections and starts clean.
