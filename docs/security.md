# Security model

## End-to-end encryption: NOT implemented

The relay sees terminal output and input in **plaintext** (over TLS in
transit, but readable by the relay process). The `*:encrypted` events and
`EncryptedChunk` type in the protocol are placeholders for a future V2
transport — there is no encrypt/decrypt path, and the relay has no
encrypted-chunk handler. The pairing screen does **not** claim otherwise.

Implication: when self-hosting you trust your own relay; if you ever use a
hosted relay you trust its operator. Treat the relay as in-scope for any
threat model that includes your terminal contents.

## Outbound-only

The relay never initiates connections. The daemon and the browser both
dial out over WSS, so no inbound ports are exposed on the Mac. Works
through NAT / firewalls / LTE.

## Credentials

- **Daemon JWT** → macOS Keychain (`keytar`, service `app.pocket-t`),
  never on disk. `~/.pocket-t/config.json` holds only non-secret fields
  (daemonId, accountId, relayUrl). The JWT is `jti`-bound to the
  `daemons` row and revocable.
- **Web auth** → httpOnly, `secure`, `SameSite=strict` cookie
  (`pocket-t_sess`). Its hash is stored in `web_sessions`; logout deletes
  that row **and** force-disconnects matching live sockets (revocation is
  immediate, not next-reconnect).
- **One-time daemon tokens** are single-use and expire in 15 minutes
  (claimed atomically).

## Authorization & routing

- Socket.IO middleware enforces JWT scope (`/daemon`) vs cookie auth
  (`/client`) on every connection.
- Every attach / input / kill / approval is re-checked against
  `account_id` on the `sessions` row, and routed **only** to the owning
  daemon's room (`daemon:<id>`) — never broadcast to the account.
- Approval `choice` is validated against the stored option keys before it
  is forwarded into the pane (it is otherwise a command-injection vector).
- Phone input is split on newlines and sent as discrete tmux `send-keys`
  literals; a newline can never break out of the control-mode line.
- The PreToolUse hook gate is case-normalized and **fails closed**:
  anything not provably read-only requires approval.

## Rate limits (Redis)

| Action | Limit |
|--------|-------|
| stdin writes | 30 / sec / session |
| spawns | 10 / min / account |
| push send | 100 / hour / account |
| login | 5 / 15 min / IP |
| register | 5 / hour / IP |
| push subscribe | 20 / hour / user |

## Reporting

Report suspected vulnerabilities privately to the maintainer (do not open
a public issue). Include repro steps and affected version/commit.
