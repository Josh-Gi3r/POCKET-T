# Contributing to pocket-t

Thanks for your interest in pocket-t.

## Setup

```bash
pnpm install
pnpm --filter @pocket-t/shared build
```

See [docs/self-hosting.md](docs/self-hosting.md) for running the full stack
locally (relay + web + daemon).

## Repo layout

- `packages/shared` — types + Socket.IO protocol (build first; everything depends on it)
- `packages/daemon` — the Mac daemon (PTY capture, ANSI normalize, relay uplink)
- `packages/relay` — Fastify + Socket.IO relay (auth, persistence, push)
- `packages/web` — React PWA client

## Conventions

- Match the existing style. Keep the smallest diff that solves the problem.
- Local imports use explicit `.js` specifiers (NodeNext in daemon/relay).
- Don't commit `.env` files or secrets.

## Before opening a PR

```bash
pnpm -r build        # everything compiles
pnpm --filter @pocket-t/daemon build && node packages/daemon/dist/main.js scan
```

Open an issue first for anything large so we can align on approach.
