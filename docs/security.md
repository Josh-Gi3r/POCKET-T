# Security model

## End-to-end encryption: NOT implemented

The tunnel or relay in the path sees terminal output and input in
**plaintext** (over TLS in transit, but readable by the tunnel/relay process).
There is no encrypt/decrypt path between the daemon and the browser. The
pairing screen does **not** claim otherwise.

Implication: when self-hosting the ws-v3 hub you trust your own box; with the
default Cloudflare Quick Tunnel you trust Cloudflare. Treat whatever is in the
path as in-scope for any threat model that includes your terminal contents.

## Outbound-only

Nothing dials *in* to the Mac. The daemon and the browser both dial **out**
over WSS to the tunnel/hub, so no inbound ports are exposed. Works through
NAT / firewalls / LTE.

## Access control is a shared token — there is no identity service

pocket-t does **not** run accounts, JWTs, cookies, or a login database. The
ws-v3 hub is a stateless pipe: a daemon connects with
`…/ws/pt?role=daemon&t=<token>` and a browser connects with
`…/ws/pt?role=client&t=<token>`. **Any two peers presenting the same token are
wired together** — the token *is* the credential.

- **Treat the token like a password.** Anyone who has it can view and control
  your terminal. Don't paste it (or a live tunnel URL) into screenshots,
  streams, chat threads, bug reports, or public logs.
- The default **Cloudflare Quick Tunnel** URL is itself unauthenticated — the
  URL is the secret. For stronger controls, put a Cloudflare Named Tunnel
  behind Cloudflare Access, or self-host the hub behind your own auth boundary
  (Caddy/nginx basic-auth, mTLS, a VPN, etc.).
- **Local bind.** The daemon's browser server binds `127.0.0.1` only by
  default (same-Mac access at `http://127.0.0.1:7700/`). Set
  `POCKET_T_BROWSER_HOST=0.0.0.0` to expose it to the LAN — do that only on a
  trusted network.

## Tool-call approval gate

The PreToolUse hook gate is case-normalized and **classified fail-closed**:
writes/edits, filesystem-mutating tools, destructive shell commands, and any
*unrecognized* tool are flagged for approval; only a fixed read-only allowlist
(`read`, `glob`, `grep`, `ls`, `websearch`, `webfetch`, …) auto-approves. This
is a classifier, not end-to-end fail-closed — what happens to a flagged call
when **no browser is connected to approve it** is a policy set by
`POCKET_T_HOOK_FAILSAFE`:

- `approve` — auto-approve the flagged call. This is the default when the
  browser UI is bound to loopback only (`POCKET_T_BROWSER_HOST=127.0.0.1`,
  itself the default), so an unattended *local* session doesn't hang.
- `deny` — fail closed; the flagged call is rejected. Recommended for
  unattended Macs, and the default when the browser server is network-exposed
  (`POCKET_T_BROWSER_HOST=0.0.0.0`).
- `passthrough` — disable the local hook server entirely (Claude's own
  permissions still gate its tools).

In short: set `POCKET_T_HOOK_FAILSAFE=deny` if you want an unattended session to
reject anything it can't get a human approval for.

## No built-in rate limiting

The ws-v3 hub is a stateless multiplexer with no request-rate limiting of its
own. If you expose a self-hosted hub to the internet, put rate limiting and an
auth boundary in the reverse proxy in front of it.

## Reporting

Report suspected vulnerabilities privately to the maintainer (do not open a
public issue). Include repro steps and affected version/commit.
