CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ── Accounts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       CITEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free'
              CHECK (plan IN ('free', 'pro')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Web sessions (browser auth) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── One-time daemon tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS one_time_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  used        BOOLEAN DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Daemons ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daemons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'My Mac',
  hostname      TEXT,
  jwt_jti       TEXT UNIQUE,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── CLI Sessions ──────────────────────────────────────────────────────────
-- Session id is daemon-assigned and is NOT a UUID: PTY sessions use a uuid
-- string, tmux-captured terminals use `tmux-<paneN>`. Keep it TEXT so the
-- "every terminal you open" capture model works without a uuid cast crash.
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  daemon_id       UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL,
  name            TEXT NOT NULL,
  cmd             TEXT NOT NULL,
  cwd             TEXT NOT NULL DEFAULT '/',
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','waiting','idle','dead')),
  last_output     TEXT DEFAULT '',
  last_active_at  TIMESTAMPTZ DEFAULT NOW(),
  seq             BIGINT DEFAULT 0,
  pid             INT,
  started_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_account_active
  ON sessions (account_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS sessions_daemon
  ON sessions (daemon_id);

-- ── Messages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  account_id        UUID NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('cli','user','system')),
  kind              TEXT NOT NULL DEFAULT 'text'
                    CHECK (kind IN ('text','approval','error','tool-call','tool-result','diff','info')),
  text              TEXT NOT NULL,
  raw_vt            TEXT,
  seq               BIGINT NOT NULL,
  approval_options  JSONB,
  approval_pending  BOOLEAN DEFAULT FALSE,
  approval_choice   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_session_seq
  ON messages (session_id, seq DESC);

-- ── Push subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);

-- ── Audit log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  account_id  UUID,
  user_id     UUID,
  session_id  TEXT,
  event       TEXT NOT NULL,
  meta        JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_account
  ON audit_log (account_id, created_at DESC);

-- ── Billing (V2) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stripe_customer_id   TEXT UNIQUE,
  stripe_sub_id        TEXT UNIQUE,
  plan                 TEXT NOT NULL DEFAULT 'free'
                       CHECK (plan IN ('free', 'pro', 'team')),
  seat_count           INT DEFAULT 1,
  current_period_end   TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS billing_account ON billing (account_id);
CREATE INDEX IF NOT EXISTS billing_stripe_customer ON billing (stripe_customer_id);

-- ── Team members (V2) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner', 'admin', 'member')),
  invited_by  UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, user_id)
);

-- ── Team invites (V2) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       CITEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES users(id),
  accepted    BOOLEAN DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
