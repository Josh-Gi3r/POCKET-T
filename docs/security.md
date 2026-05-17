# Security model

## Trust boundaries

- **Self-hosted (this repo):** TLS everywhere. You own the relay, so the
  relay sees plaintext — you are trusting yourself.
- **pocket-t Cloud (future):** E2E encrypted; relay routes ciphertext it
  cannot read. Not in this codebase yet.

## Outbound-only

The relay never initiates connections. Both the daemon and the browser
connect outbound over WSS, so no inbound ports are exposed on the Mac.
Works through NAT/firewalls/LTE.

## Credentials

- Daemon JWT is stored in the **macOS Keychain** (`security` service
  `app.pocket-t`, account `daemon-jwt`), never on disk.
  `~/.pocket-t/config.json` holds only non-secret fields (daemonId,
  accountId, relayUrl).
- Web auth is an httpOnly, secure, `SameSite=strict` cookie
  (`pocket-t_sess`); the JWT is also hashed into the `web_sessions` table
  so server-side revocation works.
- One-time daemon tokens are single-use and expire in 15 minutes.

## Authorization

Every session attach / input / kill path re-checks
`account_id = <caller account>` against the `sessions` table. Socket.IO
namespaces enforce JWT scope (`daemon` vs `client`) in middleware.

## Rate limits (Redis)

- stdin writes: 30/sec/session
- spawns: 10/min/account
- push: 100/hour/account
- login: 5 attempts / 15 min / IP

## Pre-launch checklist

See Part 5 → "Step 9 — Hardening" in the build guide: rate-limit probe,
Keychain verification, cross-account isolation test, CORS rejection,
unauthenticated WS rejection, k6 load test.
