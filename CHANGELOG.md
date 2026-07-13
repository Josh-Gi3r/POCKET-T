# Changelog

All notable changes to Pocket-T are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Persistent sessions** — each shell runs inside a private `tmux -L
  pocket-t` server, so the shell and any agent in it survive quitting
  Terminal.app, logging out, or the shim dying, and re-attach with
  scrollback. Transparently falls back to the direct `forkpty` model when
  `tmux` isn't installed.
- **Snapshot & history on restart** — the registry persists to
  `~/.pocket-t/state.json` (atomic write) with the last VT screen snapshot
  and a bounded event tail, so a daemon restart rehydrates the catalog and
  a re-attaching browser gets the screen plus recent bubbles and running
  cost instead of a blank terminal.
- **Web Push notifications** — when an approval is raised and no browser is
  watching the session, the daemon sends a Web Push (opt-in via a VAPID key
  pair) that the PWA service worker renders and deep-links to the session.
  New token-gated `POST /push/subscribe` endpoint and an owner-only
  subscription store.
- **Installable PWA web client** (`packages/web-client`) — a bubble-first
  Svelte PWA is now the default phone UI: reconnecting ws-v3 socket, lazy
  xterm.js Terminal tab, service worker with precache + push handlers, and
  a web app manifest for home-screen install. The self-contained single-
  file client remains as the fallback.

### Changed

- The daemon serves the built web client from its `dist/` when present,
  falling back to the bundled single-file page.

## [0.1.0] — 2026-07-14

Initial public release.

### Added

- **Terminal mirroring** — a native Rust `pt` shell proxy tees every
  Terminal.app window to a daemon over a Unix socket, so any terminal you
  open on the Mac appears live in the browser with bidirectional input
  straight into the real PTY.
- **`pt-registry` daemon** — in-memory session registry, per-session
  headless terminal for snapshot-on-attach, ws-v3 binary WebSocket
  protocol, and a `pocket` CLI (`serve`, `list`, `status`, `pending`,
  `approve`, `recordings`, `replay`, `input`, `kill`).
- **Zero-infrastructure remote access** — a free Cloudflare Quick Tunnel
  prints a public HTTPS URL and QR code; both the daemon and the browser
  dial out, so no inbound port is opened on the Mac.
- **Token + Origin access control** — a bearer token minted at startup is
  required on every page load and WebSocket connection, an Origin
  allowlist gates the `/ws` upgrade, and relay peers authenticate at the
  ws-v3 layer before any privileged frame is honored.
- **Agent-aware bubbles** — Claude Code sessions render as chat /
  thinking / tool-call / result / approval cards, tailed from Claude's
  JSONL transcript, alongside the raw terminal view.
- **Live cost meter** — cumulative USD for a Claude session, read from
  the transcript's real token counts and priced by model family.
- **Tool-call approval** — PreToolUse hooks surface as approve / deny
  cards; approvals fail closed when the daemon is exposed.
- **Opt-in session recording** — `POCKET_T_RECORD=1` writes standard
  asciinema v2 casts to an owner-only directory, replayable with
  `pocket replay` or any asciinema player.
- **Seven CSS-variable skins** — Midnight, Halloween, Nokia, Christmas,
  Cyberpunk, Forest, and Paper; new skins are a single CSS block.
- **Self-hosted relay** — an optional stateless ws-v3 hub with
  Docker Compose, a `Dockerfile.relay`, and a Fly.io config, for teams
  that prefer to keep Cloudflare out of the path.
- **Vendor adapter pattern** — Codex, Grok, OpenClaw, Hermes, and
  NanoClaw are detected and badged; a one-file adapter mirroring
  `ClaudeAdapter.ts` upgrades any of them to full bubbles.

[Unreleased]: https://github.com/Josh-Gi3r/POCKET-T/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Josh-Gi3r/POCKET-T/releases/tag/v0.1.0
