# Database schema

Source of truth: `packages/relay/src/db/schema.sql` (Postgres; requires
the `pgcrypto` and `citext` extensions). Applied automatically by the
Docker `postgres` container on first boot, or manually:

```bash
psql "$DATABASE_URL" -f packages/relay/src/db/schema.sql
```

## Tables

### `accounts`
`id` uuid PK · `email` citext unique · `plan` (`free`|`pro`) · `created_at`.

### `users`
`id` uuid PK · `account_id` → accounts · `email` citext unique ·
`password_hash` (bcrypt) · `created_at`.

### `web_sessions` — browser auth
`id` uuid PK · `user_id` → users · `token_hash` unique (sha256 of the
cookie JWT) · `expires_at` · `user_agent` · `ip` · `created_at`. Logout
deletes the row **and** force-drops matching live sockets.

### `one_time_tokens` — daemon enrollment
`id` uuid PK · `account_id` → accounts · `token_hash` unique · `used`
bool · `expires_at` (15 min) · `created_at`. Claimed atomically
(`UPDATE … WHERE used=FALSE`).

### `daemons`
`id` uuid PK · `account_id` → accounts · `name` · `hostname` · `jwt_jti`
unique (binds the JWT; revocable) · `last_seen_at` · `created_at`.

### `sessions`
`id` **TEXT** PK · `daemon_id` → daemons · `account_id` · `name` · `cmd`
· `cwd` · `status` (`running`|`waiting`|`idle`|`dead`) · `last_output` ·
`last_active_at` · `seq` bigint · `pid` · `started_at`.

`id` is daemon-assigned and **not** a UUID: PTY sessions use a uuid
string; tmux-captured terminals use `tmux-<daemonId>-<paneN>` (the
daemonId prefix prevents cross-Mac primary-key collisions). Indexes:
`(account_id, last_active_at DESC)`, `(daemon_id)`.

### `messages`
`id` uuid PK · `session_id` → sessions · `account_id` · `role`
(`cli`|`user`|`system`) · `kind`
(`text`|`approval`|`error`|`tool-call`|`tool-result`|`diff`|`info`) ·
`text` · `raw_vt` (base64 VT, nullable) · `seq` bigint ·
`approval_options` jsonb · `approval_pending` bool · `approval_choice` ·
`created_at`. Index: `(session_id, seq DESC)`. Approval resolution
requires `choice` to be one of the `approval_options` keys (enforced in
the resolve `UPDATE`).

### `push_subs`
`id` uuid PK · `user_id` → users · `endpoint` unique · `p256dh` · `auth`
· `created_at`. Index: `(user_id)`.

### `audit_log`
`id` bigserial PK · `account_id` · `user_id` · `session_id` · `event` ·
`meta` jsonb · `ip` · `created_at`. Index: `(account_id, created_at DESC)`.

## V2 tables (present, not exercised)

`billing` (Stripe customer/sub, plan, seats) and `team_members` /
`team_invites` (roles `owner`|`admin`|`member`). The billing/team routes
are only registered when `POCKET_T_PHASE2=1`.
