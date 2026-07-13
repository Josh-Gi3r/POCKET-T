# Security model

Pocket-T turns any terminal into a browser-reachable session, so access
to that surface is gated on every connection. This page describes how
the gates work and where the trust boundary sits.

## Everything dials out

Nothing dials *in* to the Mac. The daemon binds `127.0.0.1:7700` and,
for cross-network access, both the daemon and the browser dial **out**
over WSS to a Cloudflare tunnel or a self-hosted hub. No inbound ports
are opened, so the daemon works unchanged through NAT, firewalls, and
LTE.

## Bearer token on every connection

The daemon mints a random bearer token (`crypto.randomBytes(32)`) once at
startup, before any server begins listening. Every request to the
browser surface must carry it:

- the page load (`GET /`),
- the `/ws` WebSocket upgrade,
- and any relay peer arriving through a hub.

The token is delivered three ways: as `?t=<token>` in the URL the daemon
prints, an `Authorization: Bearer <token>` header, or the `HttpOnly`,
`SameSite=Strict` cookie the page route sets so the static client's
handshake authenticates automatically. Comparison is constant-time, and
an unminted (empty) token rejects everything — nothing is ever served
ungated.

Tunnel traffic reaches the daemon over loopback (`cloudflared` dials
`localhost`), so it is indistinguishable from a same-machine socket. The
token is therefore always required; there is no remote-address
exemption. The public tunnel URL the daemon prints already includes the
token, so **keep that URL private** — anyone who has it can drive your
terminal. Don't paste it into screenshots, streams, chat threads, bug
reports, or public logs.

## Origin allowlist on the WebSocket upgrade

The `/ws` upgrade is refused unless the request `Origin` is same-origin
with the `Host`, or a known loopback / tunnel / relay host. The allowlist
is seeded at startup with the daemon's own loopback names and extended
with the tunnel host once it's known. A foreign website's `Origin` never
matches, so a drive-by page can't open a socket to your daemon even
before the token check runs. A request with no `Origin` (a native client
such as the outbound relay dial) passes this check and is still gated by
the token.

## Relay peers authenticate at the ws-v3 layer

A self-hosted hub is a dumb pipe: it forwards frames between peers that
share a token and has no HTTP handshake of its own to gate. A
relay-attached browser therefore starts **unauthenticated** and may send
only `HELLO` (which carries the token) and `PING`. Every privileged
frame — subscribe, input, resize, kill, spawn — is dropped, and the peer
receives no session catalog and no PTY bytes, until its `HELLO` presents
a matching token. This keeps the relay path gated to the same standard
as the local path.

## Local filesystem gating

The pt-side and control Unix sockets (`~/.pocket-t/pt.sock`,
`~/.pocket-t/ctl.sock`) are `chmod 0700`, so only the owning user can
connect to them. The daemon binds `127.0.0.1` by default; set
`POCKET_T_BROWSER_HOST=0.0.0.0` to reach it over the LAN, and do that
only on a network you trust.

## Tool-call approval, fail-closed when exposed

Claude Code PreToolUse hooks POST to a local hook server that classifies
each tool call:

- Provably read-only tools (`read`, `glob`, `grep`, `ls`, `websearch`,
  `webfetch`, `todowrite`, `notebookread`, …) are allowed without
  prompting.
- Write / edit / filesystem-mutating tools, destructive shell commands
  (`rm`, `dd`, `git push`, `npm publish`, `kubectl delete`, …), and any
  tool that can't be proven read-only are flagged for approval. Bash
  whose command string can't be read fails closed.

A flagged call surfaces as an approve / deny card in the browser. What
happens to a flagged call when **no browser is connected to answer**
depends on whether the daemon is exposed, and is overridable with
`POCKET_T_HOOK_FAILSAFE`:

- `deny` — fail closed; reject the call. This is the default whenever the
  daemon is exposed (tunnel, relay, or non-loopback bind), so an
  internet-reachable terminal never auto-approves writes with nobody
  watching. Trade-off: while exposed and unattended, tool calls are
  denied until a browser connects.
- `approve` — allow the flagged call. This is the default on a
  loopback-only daemon, where Claude's own permission system still gates
  dangerous tools, so a local unattended session doesn't hang.
- `passthrough` — disable the local hook server entirely.

## Recording is opt-in

Session recording is off unless you start the daemon with
`POCKET_T_RECORD=1`. Casts capture every byte typed — including anything
entered at a password prompt — so when enabled they are written to an
owner-only (`0700`) `~/.pocket-t/recordings/`. Nothing is uploaded by the
daemon; recordings stay on the machine.

## Push notifications are opt-in and gated

Web Push is off unless you configure a VAPID key pair
(`POCKET_T_VAPID_PUBLIC_KEY` + `POCKET_T_VAPID_PRIVATE_KEY`); with no keys
the sender is never constructed and nothing is delivered. When it is
enabled:

- **Registration is token-gated.** A device registers its
  `PushSubscription` through `POST /push/subscribe`, which sits behind the
  same bearer-token check as the page load — only a holder of the daemon
  token can point notifications at a device.
- **Subscriptions stay local.** They persist to an owner-only (`0600`)
  `~/.pocket-t/push-subscriptions.json`, next to `state.json`. The private
  VAPID key lives only in the daemon's environment.
- **Payloads are minimal.** A push carries a short title/body and the
  `sessionId` (for the deep-link) — the tool name that needs approval, not
  its arguments or any terminal output. Note that the notification does
  route through the platform push service (Apple/Google), the same trust
  consideration as any Web Push app.
- **Triggered only when unattended.** The daemon pushes only when an
  approval is raised and no browser is subscribed to that session — it
  never mirrors live activity to the push service.

## The trust boundary: no end-to-end encryption

TLS protects traffic in transit, but there is no end-to-end encryption
between the daemon and the browser. A tunnel or relay operator sits in
the path and can read terminal bytes. The pairing screen does not claim
otherwise.

If that trust model isn't acceptable, self-host the ws-v3 hub on
infrastructure you control, or put a Cloudflare Named Tunnel behind
[Cloudflare Access](always-on-setup.md) so identity is checked at the
edge before traffic reaches the tunnel.

## No built-in rate limiting on the hub

The ws-v3 hub is a stateless multiplexer with no request-rate limiting of
its own. If you expose a self-hosted hub to the internet, put rate
limiting and an auth boundary in the reverse proxy in front of it.

## Reporting

To report a security issue, use GitHub's Private Vulnerability Reporting —
see [`SECURITY.md`](../SECURITY.md). Please don't open a public issue.
