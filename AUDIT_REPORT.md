# pocket-t Re-Audit Report

Date: 2026-05-17

## Executive Summary

The core relay authorization fixes from the first audit are now present and verification passes. The biggest previous issues around web socket auth, session revocation, daemon JWT database binding, daemon-scoped session mutation, approval ownership, one-time token races, and dependency advisories are resolved or materially mitigated.

Remaining risk is concentrated in release/ops and unfinished feature areas: the installer still downloads mutable artifacts without verification, `trustProxy: true` remains broad, runtime payload validation is still sparse, E2E UI/key handling is still inconsistent with the documented security model, and the Phase 2 billing/team routes remain incomplete but are gated off by default.

Verification run:

- `pnpm -r typecheck`: passed
- `pnpm --filter @pocket-t/daemon test`: passed, 26 tests
- `pnpm build`: passed
- `pnpm audit --prod`: passed, no known vulnerabilities

## Fixed / Verified

### R-001: Web realtime auth now uses httpOnly cookies

Status: Fixed

Location:

- `packages/web/src/socket.ts:13`
- `packages/web/src/socket.ts:15`
- `packages/relay/src/sockets/clientNs.ts:25`
- `packages/relay/src/auth/session.ts:14`

Evidence:

- Browser Socket.IO no longer reads a JWT from `localStorage`; it uses `withCredentials: true`.
- Client namespace extracts `pocket-t_sess` from the handshake cookie.
- `verifyClientToken()` validates JWT signature/scope and checks the token hash against `web_sessions`.

Residual note:

The cookie parser is intentionally small and catches auth failures through middleware. This is acceptable for the current cookie shape.

### R-002: Socket auth is revocation-aware

Status: Fixed

Location:

- `packages/relay/src/auth/session.ts:18`
- `packages/relay/src/auth/session.ts:24`
- `packages/relay/src/main.ts:84`
- `packages/relay/src/main.ts:88`

Evidence:

- Client socket auth now checks `web_sessions.expires_at`.
- Socket.IO recovery sets `skipMiddlewares: false`, so recovered connections re-run auth.

### R-003: Daemon JWTs are bound to daemon database rows

Status: Fixed

Location:

- `packages/relay/src/auth/session.ts:36`
- `packages/relay/src/auth/session.ts:42`
- `packages/relay/src/auth/session.ts:48`
- `packages/relay/src/sockets/daemonNs.ts:27`
- `packages/relay/src/api/auth.ts:349`

Evidence:

- Daemon tokens must include `jti`.
- `verifyDaemonToken()` looks up `daemons.jwt_jti` and verifies `daemonId` and `accountId`.
- Both daemon Socket.IO and daemon REST middleware use the shared verifier.

### R-004: One-time daemon token exchange is atomic

Status: Fixed

Location:

- `packages/relay/src/api/auth.ts:170`
- `packages/relay/src/api/auth.ts:172`
- `packages/relay/src/api/auth.ts:178`

Evidence:

- The unused/expiry check and `used = TRUE` write are now one `UPDATE ... RETURNING` statement.

### R-005: Approval resolution is scoped

Status: Fixed

Location:

- `packages/relay/src/db/queries.ts:156`
- `packages/relay/src/db/queries.ts:167`
- `packages/relay/src/db/queries.ts:170`
- `packages/relay/src/sockets/clientNs.ts:134`
- `packages/relay/src/api/auth.ts:273`

Evidence:

- `resolveApprovalScoped()` binds resolution to `messageId`, `sessionId`, `accountId`, `kind = 'approval'`, and `approval_pending = TRUE`.
- Both REST and Socket.IO paths use it.

### R-006: Daemon session mutation is account/daemon-scoped

Status: Mostly fixed

Location:

- `packages/relay/src/db/queries.ts:13`
- `packages/relay/src/db/queries.ts:23`
- `packages/relay/src/db/queries.ts:33`
- `packages/relay/src/db/queries.ts:83`
- `packages/relay/src/sockets/daemonNs.ts:64`
- `packages/relay/src/sockets/daemonNs.ts:90`
- `packages/relay/src/sockets/daemonNs.ts:115`
- `packages/relay/src/sockets/daemonNs.ts:198`

Evidence:

- `upsertSession()` now derives `accountId` and `daemonId` from authenticated socket state.
- Conflict updates are constrained to matching `sessions.daemon_id` and `sessions.account_id`.
- Chunk, snapshot, approval, exit, and hook events check `sessionOwnedByDaemon()`.

Residual issue:

After `daemon:sessions`, the relay still emits the daemon-provided `sessions` array directly to clients at `packages/relay/src/sockets/daemonNs.ts:66`. Database writes are protected, but clients can temporarily receive unnormalized/spoofed metadata from a compromised daemon in their own account. Emit `getSessionsByAccount(accountId)` or sanitized upserted rows instead.

### R-007: Production dependency advisories are resolved

Status: Fixed

Location:

- `packages/relay/package.json:17`
- `packages/relay/package.json:18`
- `pnpm-lock.yaml`

Evidence:

- Fastify is now `^5.8.5`.
- `fast-uri` is pinned to `^3.1.2`.
- `pnpm audit --prod` reports no known vulnerabilities.

### R-008: Phase 2 billing/team routes are gated

Status: Mitigated, not fully fixed

Location:

- `packages/relay/src/main.ts:104`
- `packages/relay/src/main.ts:107`
- `packages/relay/src/api/team.ts:28`
- `packages/relay/src/api/billing.ts:26`

Evidence:

- Billing/team route registration only happens when `POCKET_T_PHASE2=1`.
- The underlying route files still have incomplete role/account-context validation and sparse runtime validation.

Impact:

Default deployments are protected from these incomplete paths. Enabling Phase 2 reintroduces the prior team/billing model risks.

Fix:

Keep `POCKET_T_PHASE2` off until team membership, active-account context, owner creation, role checks, and billing payload validation are completed.

## Open High Findings

### O-001: Installer supply chain is still not verifiable

Severity: High

Location:

- `README.md:26`
- `packages/daemon/scripts/install.sh:25`
- `packages/daemon/scripts/install.sh:29`
- `packages/daemon/scripts/install.sh:35`
- `packages/daemon/scripts/install.sh:41`

Evidence:

- The documented install path remains `curl -fsSL https://install.pocket-t.ai | sh`.
- The installer downloads `releases/latest` tarball and plist artifacts.
- It extracts and installs them without checksum, signature, or notarization verification.
- It loads a persistent LaunchAgent after download.

Impact:

Compromise of the release host/path or a bad release can install a persistent user-level daemon with terminal-control capability.

Fix:

Publish immutable, signed/notarized artifacts. Verify a signed checksum or detached signature in the installer before `sudo install` and before loading the LaunchAgent. Avoid mutable `latest` URLs unless they resolve to a verified immutable artifact.

## Open Medium Findings

### O-002: Broad `trustProxy: true` remains

Severity: Medium

Location:

- `packages/relay/src/main.ts:35`
- `packages/relay/src/api/auth.ts:72`
- `packages/relay/src/api/auth.ts:104`

Evidence:

- Fastify is configured with `trustProxy: true`.
- Login rate limiting and audit logging use `req.ip`.

Impact:

If the relay is reachable without a trusted proxy that overwrites forwarded headers, an attacker can spoof IP-derived rate-limit and audit values.

Fix:

Configure trust proxy to the deployment topology rather than `true`, or document that the service must only be exposed behind a proxy that strips/overwrites `X-Forwarded-*`.

### O-003: Runtime input validation is still sparse

Severity: Medium

Location:

- `packages/relay/src/api/auth.ts:29`
- `packages/relay/src/api/auth.ts:225`
- `packages/relay/src/api/auth.ts:245`
- `packages/relay/src/sockets/clientNs.ts:92`
- `packages/relay/src/sockets/clientNs.ts:170`
- `packages/daemon/src/hooks/HookServer.ts:211`

Evidence:

- Fastify route generics describe bodies, but no route schemas validate runtime input.
- Socket payloads such as `text`, `cmd`, `cwd`, `signal`, and push subscription fields are not length/shape validated.
- The local hook server still reads request bodies into memory without an explicit size cap.

Impact:

Malformed or oversized inputs can cause avoidable errors, database pressure, process pressure, or memory pressure.

Fix:

Add Fastify schemas or a validation library for REST inputs, add Socket.IO payload validators, cap string lengths, validate UUIDs before DB calls, and cap hook request bodies.

### O-004: E2E encryption paths still conflict with the documented model

Severity: Medium

Location:

- `docs/security.md:7`
- `docs/security.md:8`
- `packages/web/src/pages/PairPage.tsx:39`
- `packages/web/src/pages/PairPage.tsx:41`
- `packages/relay/src/api/auth.ts:310`
- `packages/relay/src/api/auth.ts:314`

Evidence:

- Docs say cloud E2E is future and not in this codebase.
- The UI can still show "E2E Encryption active" and "The relay cannot read your terminal output."
- The pairing route accepts keys and stores them in Redis.

Impact:

Users can be shown an encryption guarantee that does not match the implemented default transport or key-handling model.

Fix:

Remove or hard-feature-flag pairing UI/routes until E2E is complete. In the complete design, the relay must never receive plaintext session keys if the claim is that the relay cannot read terminal output.

### O-005: Container runtime hardening is still minimal

Severity: Medium

Location:

- `infra/Dockerfile.relay:21`
- `infra/Dockerfile.relay:28`
- `infra/docker-compose.yml:27`
- `infra/docker-compose.yml:28`

Evidence:

- Final image runs as default root user.
- Production command still enables source maps.
- Compose uses a fixed local Postgres password.

Impact:

Root containers increase blast radius after compromise, source maps can expose implementation detail in production errors/logs, and compose credentials should remain clearly local-only.

Fix:

Run the final image as a non-root user, gate source maps to development/debug deployments, and document compose credentials as local-only or source them from env.

### O-006: Web CSP is improved but may be wider than needed

Severity: Medium

Location:

- `packages/web/vercel.json:23`
- `packages/web/vercel.json:24`

Evidence:

- CSP now exists, which is an improvement.
- `script-src` and `connect-src` include `https://cdnjs.cloudflare.com`, but the app source inspected here does not appear to require CDN scripts.
- `style-src` includes `'unsafe-inline'`, likely for Vite/runtime styling compatibility.

Impact:

Extra script/connect origins expand the blast radius of a CDN compromise or injection path.

Fix:

Remove unused CDN origins. Keep `'unsafe-inline'` only if required and document why; otherwise migrate to a stricter style policy.

## Open Low Findings

### O-007: Relay/web trust-boundary tests are still missing

Severity: Low

Location:

- `packages/daemon/src/memento/*.test.ts`
- `packages/relay/src/sockets/clientNs.ts`
- `packages/relay/src/sockets/daemonNs.ts`
- `packages/relay/src/auth/session.ts`

Evidence:

The existing test suite still covers daemon Memento behavior only. The new critical auth helpers and socket ownership checks do not have automated tests in this repo.

Impact:

The current fixes can regress without a focused test signal.

Fix:

Add relay integration tests for:

- client socket auth from cookie and revoked session rejection
- recovered socket middleware revalidation
- daemon JTI revocation rejection
- daemon cannot mutate another daemon/account session
- approval resolution requires matching account/session/message

### O-008: Service worker icon assets are still not present in source public assets

Severity: Low

Location:

- `packages/web/public/sw.js:53`
- `packages/web/public/sw.js:54`
- `packages/web/vite.config.ts:26`

Evidence:

The service worker and manifest reference icon paths, while `packages/web/public/` contains only `sw.js` in the source tree inspected.

Impact:

PWA install and push notification icons may be broken or inconsistent.

Fix:

Add the referenced icons under `packages/web/public/icons/` and verify the generated manifest/service-worker flow.

## Current Structure Assessment

Improved:

- Auth/session verification has a shared module.
- Client sockets are now aligned with the httpOnly-cookie security model.
- Daemon socket identity is derived from authenticated context instead of daemon-supplied payload fields.
- Critical approval and token exchange paths are now atomic/scoped.
- Incomplete Phase 2 routes are gated off by default.

Still needs work:

- Runtime validation should be centralized and applied consistently to REST, Socket.IO, and local hook payloads.
- Data-access helpers should finish removing globally scoped compatibility helpers like `updateSession()`.
- Release security needs artifact signing/checksum verification before this is safe to distribute as a curl-installed persistent daemon.
- E2E code/UI should be removed, fully gated, or completed before any relay-cannot-read claims are presented.

## Suggested Next Fix Order

1. Fix installer artifact verification and signing/notarization.
2. Add runtime validation and body/string limits at REST, Socket.IO, and hook boundaries.
3. Restrict `trustProxy` to the actual deployment topology.
4. Remove or hard-gate E2E pairing UI/routes until the model is complete.
5. Add relay auth/authorization integration tests.
6. Harden the relay Docker image to run non-root.

---

## Second-Pass Remediation (post re-audit)

Addressed in the commit following this re-audit:

1. **Installer (was Open High)** — `install.sh` pins an immutable
   `POCKET_T_VERSION` (no `latest`), downloads a `SHA256SUMS` manifest,
   and `shasum -a 256 -c` verifies the tarball **and** the LaunchAgent
   plist *before* anything is installed or `launchctl bootstrap` runs
   (fail-closed via `trap`/`exit 1`). Residual gap: macOS
   notarization/code-signing of the binary — requires an Apple Developer
   identity and a release pipeline, out of scope for the repo alone.
2. **Runtime limits** — socket stdin capped at 32 KiB; `spawn`
   name/cmd/cwd type+length bounded; history `before`/`limit` validated
   (`Number.isFinite`, clamped to `[1,200]`); hook HTTP body capped at
   1 MiB with socket destroy.
3. **trustProxy** — replaced blanket `true` with `TRUST_PROXY` hop count
   (default `1`), set per deployment.
4. **E2E** — `/pair` web route, `/api/sessions/:id/pair` relay route, and
   `/team` + billing/team registration are all gated behind explicit
   Phase-2 flags (`PHASE_2=false` in web, `POCKET_T_PHASE2=1` opt-in in
   relay); no pairing keys reach Redis with the defaults.
5. **Docker** — relay image runs as the non-root `node` user;
   `--enable-source-maps` removed from the production CMD.

Still deferred (need infra or a refactor, not a quick fix):

- Full schema-validation layer (zod/typebox) at every boundary — current
  fixes are targeted guards, not a comprehensive schema.
- Relay auth/authorization integration tests — need a test Postgres/Redis
  or making the `sql`/`redis` singletons injectable for mocking.
- ESLint + stricter tsconfig flags.

Verification after second pass: `pnpm -r typecheck` clean,
`pnpm -r build` clean, daemon `vitest` 26/26, `pnpm audit --prod` reports
no known vulnerabilities, `bash -n install.sh` valid. The relay was not
run against a live Postgres/Redis in this environment — auth/limit changes
are verified by typecheck/build only (this is exactly what the deferred
integration-test item covers).
