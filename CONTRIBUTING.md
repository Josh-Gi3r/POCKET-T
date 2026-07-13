# Contributing to pocket-t

Thanks for your interest in pocket-t.

## Setup

```bash
pnpm install
pnpm --filter @pocket-t/shared build   # shared types — build first
```

The native `pt` shell proxy is a separate Rust crate; build it with cargo:

```bash
cargo build --manifest-path packages/pt-shim/Cargo.toml
```

See [docs/self-hosting.md](docs/self-hosting.md) for running the optional
ws-v3 hub locally and pointing the daemon at it.

## Repo layout

- `packages/shared` — ws-v3 wire-format types (`src/ws-v3.ts`). Build first;
  everything else typechecks against its `dist`.
- `packages/pt-shim` — the Rust `pt` shell proxy (`forkpty`, raw-mode signal
  handling). Copied to `/usr/local/bin/pt` by `install.sh`.
- `packages/daemon` — the Mac daemon / `pt-registry` (PTY capture, ANSI
  normalize, adapters, ws-v3 uplink, the browser UI at
  `src/pt-registry/ui/index.html`).
- `packages/relay` — the optional stateless **ws-v3 hub** (`src/wsv3-hub.ts`,
  one file). A plain Node `ws` WebSocket multiplexer — no Fastify, no
  Socket.IO, no database, no auth state. See [self-hosting](docs/self-hosting.md).

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
pnpm test                               # 22 vitest specs
pnpm lint                               # eslint
pnpm -r build                           # production builds
```

If you touched the Rust shim, also run its checks (CI runs these on macOS):

```bash
cargo build  --manifest-path packages/pt-shim/Cargo.toml --locked
cargo clippy --manifest-path packages/pt-shim/Cargo.toml --locked -- -D warnings
cargo test   --manifest-path packages/pt-shim/Cargo.toml --locked
```

The browser UI is a single static file served by the daemon
(`packages/daemon/src/pt-registry/ui/index.html`) — it can't be device-tested
in CI, so exercise the flow in a phone-sized viewport against a running daemon
locally.

## Docs

User/operator docs live in `docs/` and are linked from the README. The ws-v3
wire format is defined in `packages/shared/src/ws-v3.ts`; keep any protocol
notes in `docs/architecture.md` in sync with it in the same PR.

## PR flow

Open an issue first for anything large so we can align on approach. Keep
the smallest diff that solves the problem; don't commit `.env` files or
secrets.
