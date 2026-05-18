# pocket-t

> p stands for terminal

Your terminal sessions on your phone. Any process. Any agent.
No SSH. No VPN. One curl command.

---

## What it does

Run Claude Code, Codex, Aider, or any CLI tool on your Mac.
Watch it from your phone. Type back. Approve tool calls.
Get push notifications when your agent needs you.

Works on LTE. Works through firewalls. Works when your laptop
is at home and you're not.

---

## Install

**On your Mac:**

```bash
curl -fsSL https://install.pocket-t.ai | sh
pocket-t auth <your-token>
```

Get your token at [pocket-t.ai](https://pocket-t.ai) — free account,
no credit card.

**On your phone:**

Open [app.pocket-t.ai](https://app.pocket-t.ai) in Safari.
Tap Share → Add to Home Screen.
Open from your home screen.

That's it.

---

## Self-host

```bash
git clone https://github.com/josh-gi3r/pocket-t
cd pocket-t
cp packages/relay/.env.example packages/relay/.env
# fill in DATABASE_URL, REDIS_URL, VAPID keys
pnpm install
pnpm dev:relay  # terminal 1
pnpm dev:web    # terminal 2
# daemon connects to your local relay
POCKET_T_RELAY_URL=ws://localhost:4000 pnpm dev:daemon
```

Full self-hosting guide: [docs/self-hosting.md](docs/self-hosting.md)

---

## Architecture

```
Your Mac
  pocket-t daemon → outbound WSS → relay → your phone
```

The relay never initiates connections.
Both endpoints connect outbound.
Works through any NAT or firewall.

---

## Stack

- **Daemon:** Node.js + node-pty + ghostty-opentui
- **Relay:** Fastify + Socket.IO + Postgres + Redis
- **Web:** React + Vite + TanStack Virtual + Tailwind
- **Push:** Web Push (VAPID) — works on iOS 16.4+ in standalone mode
- **Terminal:** xterm.js on desktop browsers

---

## License

MIT — free forever to self-host.
[pocket-t.ai](https://pocket-t.ai) is the hosted version
for people who don't want to run their own relay.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
