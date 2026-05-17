import sql from './client.js';
import type {
  Session,
  Message,
  ApprovalOption,
} from '@pocket-t/shared';

// ── Sessions ──────────────────────────────────────────────────────────────

// A-004: account_id/daemon_id come from the authenticated socket, never
// the daemon-supplied payload. ON CONFLICT only updates a row this daemon
// already owns — a foreign session id cannot be hijacked.
export async function upsertSession(
  s: Session,
  accountId: string,
  daemonId:  string,
) {
  await sql`
    INSERT INTO sessions
      (id, daemon_id, account_id, name, cmd, cwd,
       status, last_output, last_active_at, seq, pid)
    VALUES
      (${s.id}, ${daemonId}, ${accountId}, ${s.name}, ${s.cmd},
       ${s.cwd}, ${s.status}, ${s.lastOutput},
       to_timestamp(${s.lastActiveAt} / 1000.0), ${s.seq},
       ${s.pid ?? null})
    ON CONFLICT (id) DO UPDATE SET
      status         = EXCLUDED.status,
      last_output    = EXCLUDED.last_output,
      last_active_at = EXCLUDED.last_active_at,
      seq            = EXCLUDED.seq,
      pid            = EXCLUDED.pid
    WHERE sessions.daemon_id = ${daemonId}
      AND sessions.account_id = ${accountId}
  `;
}

// Account-scoped status update — used by daemon paths after an ownership
// check and by client paths that already verify account ownership.
export async function updateSessionScoped(
  sessionId:  string,
  accountId:  string,
  status:     Session['status'],
  lastOutput?: string,
  seq?:        number,
) {
  await sql`
    UPDATE sessions SET
      status         = ${status},
      last_active_at = NOW()
      ${lastOutput != null
        ? sql`, last_output = ${lastOutput.slice(0, 120)}`
        : sql``}
      ${seq != null
        ? sql`, seq = ${seq}`
        : sql``}
    WHERE id = ${sessionId} AND account_id = ${accountId}
  `;
}

// Back-compat: callers that already gate on account ownership upstream.
export async function updateSession(
  sessionId: string,
  status:    Session['status'],
  lastOutput?: string,
  seq?:        number,
) {
  await sql`
    UPDATE sessions SET
      status         = ${status},
      last_active_at = NOW()
      ${lastOutput != null
        ? sql`, last_output = ${lastOutput.slice(0, 120)}`
        : sql``}
      ${seq != null
        ? sql`, seq = ${seq}`
        : sql``}
    WHERE id = ${sessionId}
  `;
}

// Returns the session name iff it belongs to this account+daemon, else null.
export async function sessionOwnedByDaemon(
  sessionId: string,
  accountId: string,
  daemonId:  string,
): Promise<{ name: string } | null> {
  const [row] = await sql<{ name: string }[]>`
    SELECT name FROM sessions
    WHERE id = ${sessionId}
      AND account_id = ${accountId}
      AND daemon_id  = ${daemonId}
  `;
  return row ?? null;
}

export async function getSessionsByAccount(
  accountId: string,
): Promise<Session[]> {
  const rows = await sql<any[]>`
    SELECT
      id, daemon_id AS "daemonId", account_id AS "accountId",
      name, cmd, cwd, status, last_output AS "lastOutput",
      extract(epoch from last_active_at) * 1000 AS "lastActiveAt",
      seq, pid
    FROM sessions
    WHERE account_id = ${accountId}
    ORDER BY
      CASE status
        WHEN 'waiting' THEN 0
        WHEN 'running' THEN 1
        WHEN 'idle'    THEN 2
        ELSE                3
      END,
      last_active_at DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    ...r,
    lastActiveAt: Number(r.lastActiveAt) || Date.now(),
    seq:          Number(r.seq) || 0,
    pid:          r.pid ?? undefined,
  }));
}

// ── Messages ──────────────────────────────────────────────────────────────

export async function saveMessage(m: {
  sessionId:       string;
  accountId:       string;
  role:            Message['role'];
  kind:            Message['kind'];
  text:            string;
  rawVt?:          string;
  seq:             number;
  approvalOptions?: ApprovalOption[];
  approvalPending?: boolean;
}) {
  const [row] = await sql`
    INSERT INTO messages
      (session_id, account_id, role, kind, text, raw_vt,
       seq, approval_options, approval_pending)
    VALUES
      (${m.sessionId}, ${m.accountId}, ${m.role}, ${m.kind},
       ${m.text}, ${m.rawVt ?? null}, ${m.seq},
       ${m.approvalOptions ? JSON.stringify(m.approvalOptions) : null},
       ${m.approvalPending ?? false})
    RETURNING id, created_at
  `;
  return row;
}

// A-005: resolution is bound to the caller's account, the session, the
// message id, and kind='approval' — and is atomic (no separate ownership
// SELECT that could race the UPDATE).
export async function resolveApprovalScoped(
  messageId: string,
  sessionId: string,
  accountId: string,
  choice:    string,
) {
  const [row] = await sql`
    UPDATE messages
    SET
      approval_pending = FALSE,
      approval_choice  = ${choice}
    WHERE id = ${messageId}
      AND session_id = ${sessionId}
      AND account_id = ${accountId}
      AND kind = 'approval'
      AND approval_pending = TRUE
    RETURNING id
  `;
  return row ?? null;
}

export async function getHistory(
  sessionId: string,
  limit:     number = 200,
  beforeSeq?: number,
): Promise<Message[]> {
  const rows = await sql<any[]>`
    SELECT
      id,
      session_id        AS "sessionId",
      account_id        AS "accountId",
      role, kind, text,
      raw_vt            AS "rawVt",
      seq,
      approval_options  AS "approvalOptions",
      approval_pending  AS "approvalPending",
      approval_choice   AS "approvalChoice",
      extract(epoch from created_at) * 1000 AS "createdAt"
    FROM messages
    WHERE session_id = ${sessionId}
      ${beforeSeq != null ? sql`AND seq < ${beforeSeq}` : sql``}
    ORDER BY seq DESC
    LIMIT ${limit}
  `;
  return rows.reverse().map((r) => ({
    ...r,
    createdAt: Number(r.createdAt),
  }));
}

// ── Users + Accounts ──────────────────────────────────────────────────────

export async function getUserByEmail(email: string) {
  const [row] = await sql`
    SELECT
      u.*,
      a.plan,
      a.id AS "accountId"
    FROM users u
    JOIN accounts a ON a.id = u.account_id
    WHERE u.email = ${email.toLowerCase()}
  `;
  return row ?? null;
}

export async function createAccount(
  email:        string,
  passwordHash: string,
) {
  const [account] = await sql`
    INSERT INTO accounts (email)
    VALUES (${email.toLowerCase()})
    RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (account_id, email, password_hash)
    VALUES (${account.id}, ${email.toLowerCase()}, ${passwordHash})
    RETURNING id, account_id AS "accountId", email
  `;
  return { account, user };
}

export async function getDaemonByJti(jti: string) {
  const [row] = await sql`
    SELECT d.*, a.plan, a.id AS "accountId"
    FROM daemons d
    JOIN accounts a ON a.id = d.account_id
    WHERE d.jwt_jti = ${jti}
  `;
  return row ?? null;
}

// ── Push subscriptions ────────────────────────────────────────────────────

export async function upsertPushSub(
  userId:   string,
  endpoint: string,
  p256dh:   string,
  auth:     string,
) {
  await sql`
    INSERT INTO push_subs (user_id, endpoint, p256dh, auth)
    VALUES (${userId}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh = EXCLUDED.p256dh,
      auth   = EXCLUDED.auth
  `;
}

export async function getPushSubsByAccount(accountId: string) {
  return sql`
    SELECT ps.*
    FROM push_subs ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.account_id = ${accountId}
  `;
}

export async function deletePushSub(endpoint: string) {
  await sql`DELETE FROM push_subs WHERE endpoint = ${endpoint}`;
}

// ── Audit ─────────────────────────────────────────────────────────────────

export async function audit(entry: {
  accountId?: string;
  userId?:    string;
  sessionId?: string;
  event:      string;
  meta?:      object;
  ip?:        string;
}) {
  await sql`
    INSERT INTO audit_log
      (account_id, user_id, session_id, event, meta, ip)
    VALUES
      (${entry.accountId ?? null},
       ${entry.userId    ?? null},
       ${entry.sessionId ?? null},
       ${entry.event},
       ${entry.meta ? JSON.stringify(entry.meta) : null},
       ${entry.ip ?? null})
  `.catch(() => {}); // audit failures never crash the request path
}
