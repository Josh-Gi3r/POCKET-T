# pocket-t

> p stands for terminal

Your terminal sessions on your phone. Any process, any agent — Claude
Code, Codex, Aider, a REPL, a build. Watch it, type back, approve tool
calls, get push notifications when it needs you. No SSH, no VPN, no
inbound ports. Works on LTE, through firewalls, while your Mac is at home.

MIT licensed and fully self-hostable — you run the relay, you own the data.

---

## How it works

A small daemon on your Mac runs an **isolated tmux server**; a one-line
shell snippet makes every interactive terminal you open attach to it, so
sessions appear on your phone automatically — no wrappers, no per-window
commands. The daemon streams each pane through a headless terminal and
relays readable, append-only output over an **outbound** WebSocket to a
small relay (Fastify + Postgres + Redis). A React PWA on your phone
connects to the relay.

```
 your Mac                         relay (you host)        your phone
┌───────────────────┐            ┌────────────────┐      ┌──────────┐
│ tmux -CC server    │            │ Fastify        │      │ React    │
│   └ pane → VtStream│  outbound  │ Socket.IO      │ WSS  │ PWA      │
│ pocket-t daemon ───┼───WSS────▶ │ Postgres/Redis │ ◀──▶ │          │
└───────────────────┘            └────────────────┘      └──────────┘
        the relay never initiates a connection — both ends dial out
```

Full design: **[docs/architecture.md](docs/architecture.md)**.

---

## Install (hosted)

On your Mac:

```bash
curl -fsSL https://install.pocket-t.ai | sh
pocket-t auth <your-token>
```

Get the token from the in-app **Settings** screen after creating an
account. On your phone, open the web app in Safari → Share → Add to Home
Screen.

Uninstall cleanly any time: **[docs/uninstall.md](docs/uninstall.md)**.

---

## Self-host

```bash
git clone https://github.com/josh-gi3r/pocket-t
cd pocket-t
# create infra/.env with JWT/COOKIE secrets + VAPID keys (see the guide)
docker compose -f infra/docker-compose.yml up -d
curl http://localhost:4000/healthz # → {"ok":true}
```

Point the daemon at your relay with `POCKET_T_RELAY_URL`. Full guide,
including the production hosting topology (the PWA's REST is proxied to
the relay; the realtime socket connects to it directly via
`VITE_RELAY_URL`): **[docs/self-hosting.md](docs/self-hosting.md)**.

---

## Documentation

| Doc | What |
|-----|------|
| [docs/architecture.md](docs/architecture.md)   | Components, data flow, the capture & streaming model |
| [docs/protocol.md](docs/protocol.md)           | Every Socket.IO namespace and event |
| [docs/schema.md](docs/schema.md)               | Postgres schema, every table and index |
| [docs/security.md](docs/security.md)           | Trust boundaries, credentials, authz, rate limits |
| [docs/self-hosting.md](docs/self-hosting.md)   | Run your own relay (Docker or local) |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common problems and fixes |
| [docs/uninstall.md](docs/uninstall.md)         | Remove pocket-t from a Mac |
| [CONTRIBUTING.md](CONTRIBUTING.md)             | Dev setup, conventions, PR flow |

---

## Stack

- **Daemon:** Node.js · tmux control mode (`-CC`) · `@xterm/headless` for
  VT state · `node-pty` for phone-initiated spawns
- **Relay:** Fastify · Socket.IO · Postgres · Redis
- **Web:** React · Vite · TanStack Virtual · Tailwind · xterm.js (desktop)
- **Push:** Web Push (VAPID) — iOS 16.4+ in standalone PWA mode

---

## Security

Outbound-only (no inbound ports on the Mac). Daemon JWT in the macOS
Keychain. Web auth is an httpOnly, revocable cookie session. Every
session action is re-authorized against the owning account and routed to
the owning daemon only.

**End-to-end encryption is not implemented yet.** A self-hosted (or the
future hosted) relay can read terminal output in transit — the V2
encrypted events exist in the protocol but have no handler. See
**[docs/security.md](docs/security.md)**. Report vulnerabilities
privately to the maintainer rather than opening a public issue.

---

## License

MIT — free forever to self-host.
