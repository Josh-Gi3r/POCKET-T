# @pocket-t/web-client

The default pocket-t phone client — a bubble-first, installable PWA that
speaks the existing **ws-v3** binary protocol to the daemon. The daemon
serves this build when present and falls back to the self-contained
single-file `pt-registry/ui/index.html` (~1,090 lines) otherwise.

- **Bubble-first UI** — the agent conversation renders as cards (chat,
  thinking, tool-call, tool-result, approval, cost) built from the daemon's
  `EVENT` bubble frames. Approvals get inline Approve/Deny buttons.
- **Terminal is secondary** — a lazy `Terminal` tab dynamically imports
  `@xterm/xterm` (code-split into its own ~290 KB chunk) only when opened.
- **Resilient** — a reconnecting WebSocket (`partysocket`) with backoff +
  the ws-v3 "reconnect owns resubscribe" rule: every (re)open sends
  `HELLO(token)` then re-`SUBSCRIBE`s the current session, so the daemon
  re-snapshots the VT and replays event history. Nudged on
  `visibilitychange` / `pageshow` / `online` / `focus` so a backgrounded
  phone reconnects instantly.
- **PWA** — `vite-plugin-pwa` (injectManifest) emits a service worker with
  precaching + Web Push handlers and a web app manifest (standalone, theme
  color, maskable icon) so it installs to the home screen.

## Build

```sh
pnpm install                              # from repo root
pnpm --filter @pocket-t/web-client build  # emits packages/web-client/dist/
```

Dev server: `pnpm --filter @pocket-t/web-client dev`.

Output is fully static (`dist/`): `index.html`, hashed `assets/*`, `sw.js`,
`manifest.webmanifest`, `icons/*`.

## Serving `dist/` from the daemon

The daemon serves this build automatically. `startBrowserServer()` in
`packages/daemon/src/pt-registry/server.ts` resolves the web-client `dist/`
and serves it: `GET /` (and `/index.html`) behind the token gate with the
`pocket_t_token` `Set-Cookie`, and the hashed `assets/*`, `sw.js`,
`manifest.webmanifest`, and `icons/*` as public static files. `/ws` is
unchanged. Build this package with `pnpm --filter @pocket-t/web-client build`
and the daemon picks up `dist/` on its next start; if the build is absent it
falls back to the single-file client.

## Token

Same model as the old client. The daemon mints a per-daemon bearer token at
startup and prints a URL carrying `?t=<token>`. This client reads the token
from `?t=` / `?token=` (see `src/lib/connection.ts` `readToken()`), sends it
in the ws-v3 `HELLO` payload (`[version=1, ...tokenUtf8]`), and — on the
local/tunnel path — the same-origin `pocket_t_token` cookie the daemon sets
also authenticates the `/ws` upgrade. On the relay path the `HELLO` token is
the only auth, exactly as the daemon's `handleIncomingFrame` HELLO branch
expects.

## VAPID / Web Push (client side only)

Push is scaffolded on the client (`src/lib/push.ts` + the `push` /
`notificationclick` handlers in `src/sw.ts`). The public VAPID key is a
build-time env var:

```sh
# generate a key pair once
npx web-push generate-vapid-keys
# then build with the public key
VITE_VAPID_PUBLIC_KEY=<public-key> pnpm --filter @pocket-t/web-client build
```

Without `VITE_VAPID_PUBLIC_KEY`, push subscription silently no-ops (local
`Notification`s for approvals still work). With it set, the client registers
its subscription with the daemon's token-gated `POST /push/subscribe`; the
daemon (holding the paired VAPID private key) sends a Web Push when an
approval is raised with no live browser watching the session.

## Protocol source of truth

`src/lib/protocol.ts` is a browser-safe **adaptation** of
`packages/shared/src/ws-v3.ts` — identical magic (`PT`), version, type
numbers, and payload layouts. It is vendored (not imported at runtime) only
so this package builds without `@pocket-t/shared`'s `dist/` present. If the
wire changes, `shared/src/ws-v3.ts` is authoritative and this file follows.
```
