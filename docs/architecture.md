# Architecture

## Components

| Package | Role |
|---------|------|
| `packages/shared` | TypeScript types + the Socket.IO event protocol. Built first; daemon, relay and web all depend on its `dist`. |
| `packages/daemon` | Runs on the Mac. Owns an isolated tmux server, captures every pane, normalizes output, and relays it outbound. |
| `packages/relay`  | Fastify + Socket.IO. Auth, persistence (Postgres), rate limiting / pub-sub (Redis), Web Push. Never initiates connections. |
| `packages/web`    | React PWA. Connects to the relay over Socket.IO + REST. |

## Capture model

The installer adds a guarded snippet to `~/.zshrc` / `~/.bashrc`. Every
**interactive** shell runs `tmux -L pocket-t` (an isolated server, not the
user's own tmux) via `new-session -A`. The snippet is fail-safe: it runs
tmux as a child (not `exec`), closes the terminal on a clean exit, and
falls through to a normal shell if tmux can't start — a broken server can
never strand you. It also tolerates the daemon-owned conf not existing yet
on first boot.

The daemon connects to that tmux server in **control mode** (`-CC`):

- `TmuxClient` speaks the line-delimited control protocol: it parses
  `%output`, `%window-add`, `%sessions-changed`, etc., and decodes the
  octal-escaped `%output` byte payloads.
- `TmuxHost` keeps a unified pane registry across one control client per
  tmux session (a `-CC` client only receives `%output` for its own
  session). The `pocket-t` "primary" session additionally does discovery.
- Each pane id maps to a session id `tmux-<daemonId>-<paneN>`. The
  daemonId prefix keeps ids globally unique — `sessions.id` is one global
  primary key, so a bare `tmux-3` would collide across two Macs on one
  account.

Phone-initiated spawns that bypass tmux use `PtyHost` (`node-pty`).

## Streaming pipeline

Both paths feed one uniform pipeline (`stream/VtStream.ts`, modeled on
`pty/Session.ts`):

```
raw VT bytes ─▶ @xterm/headless terminal      ─▶ snapshot() on attach
            └─▶ rawBuffer (80ms coalesce)     ─▶ normalizeChunk()
                                                 ├─▶ chunk { text, rawVt(b64), seq }
                                                 ├─▶ detectApproval() → approval
                                                 └─▶ 500ms quiescence → idle
```

`text` is human-readable (ANSI resolved); `rawVt` is base64 of the raw
bytes so the desktop xterm view can render exactly. This replaced an
older capture-pane snapshot + string-diff that, on alternate-screen apps
(Claude Code, vim), re-emitted the whole screen on every scroll and
deleted history on every `clear`.

## Relay routing

Daemon sockets join two rooms: `account:<id>` and `daemon:<id>`. Every
client command (`input`, `spawn`, `kill`, `attach`, hook approval) is
resolved to the **owning daemon** (from `sessions.daemon_id`) and emitted
to `daemon:<id>` only — never broadcast to the account, which previously
ran a spawn on every Mac. Output chunks fan out to clients in the
per-session room `session:<id>`.

## Auth

- **Daemon:** one-time token (15 min, single-use) → JWT, jti-bound to the
  `daemons` row and stored in the macOS Keychain.
- **Web:** email/password → httpOnly `SameSite=strict` cookie; the token
  hash is stored in `web_sessions` so logout/revocation force-drops live
  sockets, not just the next reconnect.

See [protocol.md](protocol.md), [schema.md](schema.md),
[security.md](security.md).
