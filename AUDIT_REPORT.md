# pocket-t Audit Report

Date: 2026-05-17

## Executive Summary

The repository builds and typechecks, and the daemon's existing unit tests pass. The highest-risk issues are in relay authorization boundaries: daemon JWTs are not checked against server-side daemon state after issuance, daemon socket events can mutate or broadcast session data without rechecking session/account ownership, and approval resolution can update an approval by `messageId` without binding it to the caller's account/session. There is also a major auth architecture mismatch: the relay stores the web JWT in an httpOnly cookie, but the browser Socket.IO client tries to read a JWT from `localStorage`, so realtime client connections will not authenticate unless the design is changed.

Verification run:

- `pnpm -r typecheck`: passed
- `pnpm --filter @pocket-t/daemon test`: passed, 26 tests
- `pnpm build`: passed
- `pnpm audit --prod`: failed with 5 production advisories, including 3 high severity

## Critical / High Findings

### A-001: Web realtime auth is broken and the tempting fix would weaken security

Severity: High

Location:

- `packages/relay/src/api/auth.ts:51` and `packages/relay/src/api/auth.ts:87`
- `packages/web/src/socket.ts:10`
- `packages/web/src/socket.ts:23`
- `packages/web/src/pages/LoginPage.tsx:21`

Evidence:

- Login/register set `pocket-t_sess` as an `httpOnly`, `secure`, `sameSite: 'strict'` cookie.
- The web socket sends `auth: { token: getStoredToken(), scope: 'client' }`.
- `getStoredToken()` reads `localStorage.getItem('pocket-t_token')`.
- The login page never stores a token in `localStorage`; it relies on `credentials: 'include'`.

Impact:

Realtime web connections cannot authenticate after normal login. Returning the JWT to JS and storing it in `localStorage` would make session tokens accessible to any XSS and would contradict the documented httpOnly-cookie model.

Fix:

Authenticate `/client` sockets from the signed cookie during the Socket.IO handshake, then perform the same `web_sessions` token-hash lookup used by `requireAuth`. Remove `localStorage` token storage entirely.

Mitigation:

Until fixed, avoid adding token responses to `/api/auth/login` or `/api/auth/register`.

### A-002: Socket auth bypasses server-side session revocation

Severity: High

Location:

- `packages/relay/src/sockets/clientNs.ts:24`
- `packages/relay/src/sockets/clientNs.ts:27`
- `packages/relay/src/main.ts:75`
- `packages/relay/src/main.ts:77`
- `packages/relay/src/api/auth.ts:333`

Evidence:

- Client socket middleware only verifies JWT signature/scope and does not query `web_sessions`.
- REST auth hashes the cookie token and checks `web_sessions.expires_at`.
- Socket.IO recovery is configured with `skipMiddlewares: true`.

Impact:

Logout and server-side session deletion do not reliably revoke socket access. Recovered Socket.IO sessions may skip middleware entirely during the configured recovery window.

Fix:

Move client socket auth to a shared verifier that validates JWT, scope, token hash, expiry, and user/account data against `web_sessions`. Disable `skipMiddlewares` unless you can prove revalidation is done on recovered connections.

### A-003: Daemon JWTs are not bound to active daemon records after issuance

Severity: High

Location:

- `packages/relay/src/auth/jwt.ts:29`
- `packages/relay/src/auth/jwt.ts:30`
- `packages/relay/src/auth/jwt.ts:32`
- `packages/relay/src/sockets/daemonNs.ts:23`
- `packages/relay/src/sockets/daemonNs.ts:26`
- `packages/relay/src/api/auth.ts:360`
- `packages/relay/src/db/queries.ts:182`

Evidence:

- Daemon JWTs include a `jti` and expire after 30 days.
- `daemons.jwt_jti` exists and `getDaemonByJti()` is implemented.
- Daemon socket and REST daemon auth only call `verifyJwt()` and check `scope`; they do not check `jwt_jti` against the database.

Impact:

A stolen daemon JWT remains usable until JWT expiry even if the daemon is deleted or should be revoked. This is serious because daemon access can spawn/write/kill terminal sessions.

Fix:

Require active daemon lookup for every daemon socket connection and daemon REST call: validate `jti`, `daemonId`, and `accountId` against `daemons`, and add a revocation/deletion path that removes or invalidates `jwt_jti`.

### A-004: Daemon socket handlers trust daemon-supplied session identity/account data

Severity: High

Location:

- `packages/relay/src/sockets/daemonNs.ts:63`
- `packages/relay/src/sockets/daemonNs.ts:65`
- `packages/relay/src/db/queries.ts:10`
- `packages/relay/src/db/queries.ts:16`
- `packages/relay/src/sockets/daemonNs.ts:73`
- `packages/relay/src/db/queries.ts:45`
- `packages/relay/src/sockets/daemonNs.ts:86`
- `packages/relay/src/sockets/daemonNs.ts:103`
- `packages/relay/src/sockets/daemonNs.ts:109`
- `packages/relay/src/sockets/daemonNs.ts:190`

Evidence:

- `daemon:sessions` passes daemon-provided `Session` objects directly into `upsertSession(s)`.
- `upsertSession()` writes `s.daemonId` and `s.accountId` from the payload.
- `daemon:session:update` calls `updateSession(session.id, ...)`, and `updateSession()` updates only by `WHERE id = ${sessionId}`.
- Chunk/snapshot/hook events emit to `session:${sessionId}` or `account:${accountId}` without first proving the session belongs to the authenticated daemon/account.

Impact:

A compromised or malicious daemon token can poison session records or mutate/fan out events for session IDs outside its authority if IDs are known. The relay should never trust daemon-provided account or daemon identity fields.

Fix:

Derive `accountId` and `daemonId` only from authenticated socket data. For every daemon event carrying a `sessionId`, verify `sessions.id`, `sessions.account_id`, and `sessions.daemon_id` match the authenticated daemon before updating, saving messages, or emitting.

### A-005: Approval resolution is not bound to caller-owned session/message

Severity: High

Location:

- `packages/relay/src/sockets/clientNs.ts:131`
- `packages/relay/src/sockets/clientNs.ts:134`
- `packages/relay/src/db/queries.ts:105`
- `packages/relay/src/db/queries.ts:114`
- `packages/relay/src/api/auth.ts:266`
- `packages/relay/src/api/auth.ts:273`

Evidence:

- Socket approval response calls `resolveApproval(messageId, choice)` without checking session ownership first.
- REST approval checks that `sessionId` belongs to the caller, but `resolveApproval()` updates any pending approval row by `messageId` alone.

Impact:

If a user learns another pending approval `messageId`, they can resolve it without owning that message/session. This can unblock or deny remote terminal actions.

Fix:

Change approval resolution to update by `(message_id, session_id, account_id)` and require `kind = 'approval'`. Apply the same helper to both REST and socket paths.

### A-006: One-time daemon token exchange is raceable

Severity: High

Location:

- `packages/relay/src/api/auth.ts:163`
- `packages/relay/src/api/auth.ts:164`
- `packages/relay/src/api/auth.ts:175`

Evidence:

The code selects an unused token, then marks it used in a separate query.

Impact:

Concurrent requests can pass the `used = FALSE` check before either request updates the row, allowing multiple daemon JWTs from a single one-time token.

Fix:

Use a single atomic statement, such as `UPDATE one_time_tokens SET used = TRUE WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW() RETURNING account_id, id`, inside a transaction if additional dependent writes need to be coupled.

### A-007: Production dependencies include known vulnerabilities

Severity: High

Location:

- `packages/relay/package.json:18`
- `pnpm-lock.yaml`

Evidence:

`pnpm audit --prod` reports:

- High: `fastify` body validation bypass, patched in `>=5.7.2`
- High: `fast-uri` path traversal, patched in `>=3.1.1`
- High: `fast-uri` host confusion, patched in `>=3.1.2`
- Moderate: Fastify spoofable `request.protocol` / `request.host`, patched in `>=5.8.3`
- Low: Fastify sendWebStream DoS, patched in `>=5.7.3`

Impact:

The relay is internet-facing, so framework parser/routing vulnerabilities are in the exposed attack surface.

Fix:

Upgrade Fastify and related Fastify plugins together. Because the current app uses Fastify 4, validate compatibility and rerun typecheck/build/integration tests after upgrade.

### A-008: Installer supply chain is not verifiable

Severity: High

Location:

- `README.md:26`
- `packages/daemon/scripts/install.sh:25`
- `packages/daemon/scripts/install.sh:29`
- `packages/daemon/scripts/install.sh:35`
- `packages/daemon/scripts/install.sh:41`

Evidence:

The documented install path is `curl ... | sh`. The install script downloads a tarball and LaunchAgent plist from a mutable `latest` path, then installs/loads them without checksum, signature, or notarization verification.

Impact:

Any compromise of the release host/path or transport endpoint can deliver a persistent LaunchAgent with user-level terminal control.

Fix:

Publish signed/notarized macOS artifacts, verify checksums/signatures in the installer, pin immutable release versions, and install only after verification succeeds.

## Medium Findings

### A-009: E2E encryption implementation and product claims are inconsistent

Severity: Medium

Location:

- `docs/security.md:5`
- `packages/web/src/pages/PairPage.tsx:39`
- `packages/daemon/src/main.ts:98`
- `packages/daemon/src/main.ts:259`
- `packages/relay/src/api/auth.ts:308`
- `packages/relay/src/api/auth.ts:312`
- `packages/shared/src/protocol.ts:18`
- `packages/relay/src/sockets/daemonNs.ts:86`

Evidence:

- Docs say cloud E2E is future/not in this codebase.
- UI can display `E2E Encryption active`.
- Daemon auth persists `e2eEnabled: false`.
- Encrypted protocol events exist, but relay/client handlers use plaintext chunk paths.
- Pairing keys are posted to and stored by the relay in Redis.

Impact:

Users may believe the relay cannot read terminal output when the implemented path is plaintext. If enabled as-is, key handling through relay storage would also violate the relay-cannot-read model.

Fix:

Either remove/feature-flag all E2E UI until complete, or finish a design where the relay never receives decryption keys. Add integration tests proving plaintext terminal output is not sent or stored when E2E is enabled.

### A-010: Team authorization/model is incomplete

Severity: Medium

Location:

- `packages/relay/src/api/team.ts:28`
- `packages/relay/src/api/team.ts:32`
- `packages/relay/src/api/team.ts:53`
- `packages/relay/src/api/team.ts:81`
- `packages/relay/src/db/queries.ts:165`
- `packages/relay/src/api/team.ts:135`

Evidence:

- Invite creation checks billing plan but does not check caller role.
- Account creation does not create an owner `team_members` row.
- Accepting an invite inserts a `team_members` row for another account, but the user's JWT/account context remains their original `users.account_id`.
- Remove-member requires caller role from `team_members`, which may not exist for the account owner.

Impact:

Team permissions are not reliable. Depending on data shape, unauthorized users may invite, while actual owners may be unable to administer members.

Fix:

Define one source of truth for active account/team context. Create owner membership at account creation, include selected account membership/role in auth context, and enforce role checks on every team/billing/team-scoped action.

### A-011: Runtime input validation is too thin at trust boundaries

Severity: Medium

Location:

- `packages/relay/src/api/auth.ts:24`
- `packages/relay/src/api/auth.ts:219`
- `packages/relay/src/api/billing.ts:26`
- `packages/relay/src/api/team.ts:28`
- `packages/relay/src/sockets/clientNs.ts:170`

Evidence:

TypeScript route generics describe request bodies, but runtime values are not schema-validated. Examples include push subscription keys, billing `plan`/`seats`, team invite email/role, and socket `cmd`/`cwd` payloads.

Impact:

Malformed payloads can trigger unexpected errors, abuse resource limits, or hit downstream APIs with invalid state. Compile-time types do not protect network inputs.

Fix:

Add Fastify schemas or a validation library such as zod/typebox at every REST and Socket.IO boundary. Normalize strings, length-limit user-controlled text, and reject invalid UUIDs before DB calls.

### A-012: Security headers are incomplete

Severity: Medium

Location:

- `packages/relay/src/main.ts:33`
- `packages/web/vercel.json:14`
- `packages/web/vercel.json:16`
- `packages/web/vercel.json:17`

Evidence:

- Relay app does not set a Helmet-equivalent header baseline.
- Web config sets `nosniff`, frame denial, and HSTS, but no visible CSP or Referrer-Policy.

Impact:

Missing headers reduce defense-in-depth for XSS, clickjacking, content sniffing, and privacy. The web app renders terminal output and user-controlled text, so CSP is valuable even though React escaping is used.

Fix:

Add a header policy for both the relay and web deployment. For the web app, start with a strict CSP compatible with Vite assets, `Referrer-Policy`, `Permissions-Policy`, and frame protections. Avoid `unsafe-eval`; only use `unsafe-inline` if justified by a documented migration plan.

### A-013: `trustProxy: true` is broad

Severity: Medium

Location:

- `packages/relay/src/main.ts:35`
- `packages/relay/src/api/auth.ts:67`
- `packages/relay/src/api/auth.ts:99`

Evidence:

The relay blindly trusts proxy headers, and login rate limiting/audit logging use `req.ip`.

Impact:

If the service is reachable without a trusted proxy that overwrites `X-Forwarded-*`, attackers can spoof IP-derived rate-limit keys and audit IPs.

Fix:

Configure trust proxy to the exact deployment topology. On platforms like Fly, explicitly document/verify the trusted proxy behavior and add tests or runtime checks for direct exposure.

### A-014: Resource limits are incomplete

Severity: Medium

Location:

- `packages/relay/src/sockets/clientNs.ts:93`
- `packages/relay/src/sockets/clientNs.ts:112`
- `packages/relay/src/api/auth.ts:240`
- `packages/daemon/src/hooks/HookServer.ts:211`
- `packages/daemon/src/hooks/HookServer.ts:214`

Evidence:

- Socket input text is persisted and forwarded without length limits.
- History `limit` is converted with `Number()` and only upper-capped.
- Hook server request bodies are read unbounded into memory.

Impact:

Authenticated users, compromised clients, or local callers can cause avoidable memory/DB pressure or malformed behavior.

Fix:

Add max lengths for socket text/chunks/tool input, validate numeric ranges, and cap local hook request bodies.

### A-015: Container runtime hardening is minimal

Severity: Medium

Location:

- `infra/Dockerfile.relay:21`
- `infra/Dockerfile.relay:28`
- `infra/docker-compose.yml:24`
- `infra/docker-compose.yml:27`
- `infra/docker-compose.yml:28`

Evidence:

- Final relay image runs as default root user.
- Production command enables source maps.
- Compose uses a fixed local Postgres password.

Impact:

Root containers increase blast radius after app compromise. Source maps may expose more internal implementation detail in production stack traces/logs. The compose password is acceptable for local dev only, but should be explicitly scoped that way.

Fix:

Run as a non-root user, consider disabling source maps in hosted production, and split dev compose defaults from production self-host guidance.

## Low Findings / Quality Risks

### A-016: No relay/web tests around the critical trust boundaries

Severity: Low

Location:

- `packages/daemon/src/memento/*.test.ts`
- `packages/relay/src/sockets/clientNs.ts`
- `packages/relay/src/sockets/daemonNs.ts`
- `packages/web/src/socket.ts`

Evidence:

Existing tests cover daemon Memento behavior only. There are no tests for relay auth, socket ownership checks, approval resolution, billing/team authorization, or web login/socket wiring.

Impact:

The riskiest code paths can regress without signal.

Fix:

Add relay integration tests with a test Postgres/Redis or isolated adapters. Prioritize:

- Socket auth rejects revoked/expired sessions
- Daemon cannot mutate another account/session
- Approval resolution requires matching account/session/message
- Login establishes REST and socket auth correctly

### A-017: TypeScript config is strict but leaves useful safety flags off

Severity: Low

Location:

- `tsconfig.base.json:6`
- `tsconfig.base.json:8`

Evidence:

`strict` is enabled, but there is no `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, or linting script.

Impact:

Some common undefined/value-shape mistakes remain invisible, especially around network payloads and array indexing.

Fix:

Add ESLint and incrementally enable stricter compiler flags after the runtime auth fixes.

### A-018: Service worker assumes assets that are not present in `public/`

Severity: Low

Location:

- `packages/web/public/sw.js:2`
- `packages/web/vite.config.ts:26`

Evidence:

`public/` currently contains only `sw.js`, while service worker/manifest references `/manifest.webmanifest` and icon files. The manifest is generated at build time, but source `public` icons are absent.

Impact:

PWA install/push icon behavior can be broken or inconsistent.

Fix:

Add the referenced icon assets to `packages/web/public/icons/` and verify the generated manifest/service worker install flow.

## Structure Audit

Strengths:

- Clear workspace split: `daemon`, `relay`, `web`, and `shared`.
- Shared Socket.IO protocol types provide a useful contract.
- SQL uses the `postgres` tagged template API instead of string concatenation.
- Daemon credential storage uses Keychain instead of writing JWTs to disk.
- Builds are deterministic through `pnpm-lock.yaml`.

Main structural issues:

- Auth/session logic is duplicated across REST and Socket.IO instead of using shared verifier functions.
- Session ownership checks are scattered and inconsistent; data-access helpers update by global IDs.
- V2/V3 features are partially present in production paths, especially billing/team/E2E/hook approvals.
- Plan enforcement is present but explicitly disabled in the socket spawn path.
- Frontend state assumes realtime socket auth works, but auth storage design prevents it.

Recommended structure changes:

1. Introduce `auth/session.ts` with `requireClientSessionFromCookie`, `requireClientSocketSession`, and `requireDaemonSession`.
2. Introduce relay repository helpers that always accept `accountId` and, for daemon paths, `daemonId`.
3. Replace global update helpers like `updateSession(sessionId, ...)` with account/daemon-scoped variants.
4. Create one runtime schema layer shared by REST and Socket.IO payload validation.
5. Put incomplete feature areas behind explicit flags until their full auth/data model is implemented.

## Security Audit Checklist

Covered:

- Auth/session cookie handling
- Socket.IO auth and authorization
- Daemon token issuance/revocation
- Session/message/account boundaries
- Approval flows
- SQL construction
- Browser XSS sinks
- PWA/service worker behavior
- Deployment headers/container defaults
- Dependency advisories
- Installer supply chain

Not deeply covered:

- Live runtime header validation against deployed domains
- Stripe dashboard/webhook configuration outside code
- Load testing and Redis/Postgres operational limits
- macOS notarization/signing state of actual release artifacts

## Suggested Fix Order

1. Fix web socket auth to use httpOnly cookie plus `web_sessions` verification.
2. Add daemon DB verification and revocation checks for every daemon connection/request.
3. Make all daemon session mutations account/daemon-scoped.
4. Bind approval resolution to account/session/message.
5. Make one-time token exchange atomic.
6. Upgrade vulnerable dependencies.
7. Add runtime payload schemas and focused relay integration tests.
8. Remove or fully gate incomplete E2E/team/billing flows before launch.
