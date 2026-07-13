# Self-hosting the pocket-t relay hub

pocket-t is MIT licensed. The default remote-access path is a free Cloudflare
Quick Tunnel — you don't have to host anything. The **relay hub** is an
*optional* alternative: run it yourself if you'd rather not have Cloudflare in
the path, or want a stable URL on infrastructure you control.

The hub is a **stateless ws-v3 WebSocket multiplexer** — a dumb pipe. No
database, no session store, no external services, and nothing to configure
beyond a port. Daemons dial in with a token, browsers dial in with the same
token, and the hub forwards binary frames between same-token peers.

The hub itself does not authenticate — it routes by token. Authentication
happens at the daemon: a browser reaching the daemon through the hub echoes
that same token in its ws-v3 `HELLO` frame, and the daemon checks it against
its bearer token before honoring any privileged frame (see
[security.md](security.md)). Because one value both routes and authenticates,
**the token must be the daemon's bearer token** — the value the daemon prints
after `t=` at startup. Put a `wss://` TLS terminator in front of the hub.

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

The daemon takes a `--relay <wss-url>` flag. Because the relay account token
must equal the daemon's bearer token (see above), pin a stable token with
`POCKET_T_TOKEN` and reuse it — otherwise the daemon mints a fresh random
token each start and you can't know it ahead of time to put in the URL:

```bash
export POCKET_T_TOKEN="$(openssl rand -hex 32)"
pocket serve --relay "wss://your-host/ws/pt?role=daemon&t=$POCKET_T_TOKEN"
```

The browser connects to the same host with `role=client` and the **same
token** — the hub pipes frames between them. Open
`https://your-host/?token=$POCKET_T_TOKEN` in a browser and it dials
`role=client` automatically, echoing the token in its `HELLO` frame to
authenticate to the daemon. Because that token is the daemon's bearer token,
**treat the URL like a password.**

## Daemon-side options are independent of the relay

The hub only moves frames — every daemon feature works the same whether
you reach it over a Cloudflare tunnel or your own relay, and is configured
on the **daemon**, not the hub:

- **Access control** is enforced by the daemon (bearer token echoed in the
  ws-v3 `HELLO`, see [security.md](security.md)); the hub authenticates
  nobody.
- **Session recording** stays opt-in and local — `POCKET_T_RECORD=1`
  writes asciinema casts to an owner-only `~/.pocket-t/recordings/` on the
  Mac. Nothing is uploaded through the relay.
- **Push notifications** are a daemon capability too: set the VAPID env
  (`POCKET_T_VAPID_PUBLIC_KEY` / `_PRIVATE_KEY`) on the daemon and devices
  register via its token-gated `POST /push/subscribe`. The relay is not in
  the push path.
- **Persistence** (`state.json`, the private `pocket-t` tmux server) is
  entirely daemon/Mac-side; the hub holds no state and a hub restart drops
  only live connections, never sessions.

## Endpoints the hub exposes

Single HTTP server on `$POCKET_T_HUB_PORT` (default `4080`):

- `GET /` — embedded xterm.js browser page.
- `WS /ws/pt?role=daemon&t=<token>` — daemon registers under account `<token>`.
- `WS /ws/pt?role=client&t=<token>` — browser subscribes under account `<token>`.

There is no REST API, no `/healthz`, and no persistence — a restart drops all
live connections and starts clean.
