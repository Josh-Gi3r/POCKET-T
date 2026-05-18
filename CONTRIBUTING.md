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

`@pocket-t/shared` only exports its `dist`, so build it before
typechecking anything else:

```bash
pnpm --filter @pocket-t/shared build   # required first
pnpm -r typecheck                       # all packages compile
pnpm --filter @pocket-t/daemon test     # vitest
pnpm -r build                           # production builds
```

Web UI changes can't be device-tested in CI — verify typecheck + the Vite
production build, and exercise the flow in a phone-sized viewport locally.

## Docs

User/operator docs live in `docs/` and are linked from the README.
`docs/protocol.md` and `docs/schema.md` are derived from
`packages/shared/src/protocol.ts` and `packages/relay/src/db/schema.sql` —
update them in the same PR that changes those files.

## PR flow

Open an issue first for anything large so we can align on approach. Keep
the smallest diff that solves the problem; don't commit `.env` files or
secrets.
