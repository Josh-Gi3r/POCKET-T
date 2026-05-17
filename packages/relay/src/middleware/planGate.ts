import sql from '../db/client.js';

const LIMITS = {
  free: { daemons: 1,  sessions: 10,  historyDays: 7  },
  pro:  { daemons: 10, sessions: 100, historyDays: 90 },
  team: { daemons: 50, sessions: 500, historyDays: 365 },
};

export async function checkSessionLimit(
  accountId: string,
  plan: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const limit = LIMITS[plan as keyof typeof LIMITS] ?? LIMITS.free;

  const [row] = await sql`
    SELECT COUNT(*) AS count
    FROM sessions
    WHERE account_id = ${accountId}
      AND status != 'dead'
  `;

  if (Number(row.count) >= limit.sessions) {
    return {
      allowed: false,
      reason:  `Session limit reached (${limit.sessions} on ${plan} plan). Kill existing sessions or upgrade.`,
    };
  }

  return { allowed: true };
}

export async function checkDaemonLimit(
  accountId: string,
  plan: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const limit = LIMITS[plan as keyof typeof LIMITS] ?? LIMITS.free;

  const [row] = await sql`
    SELECT COUNT(*) AS count FROM daemons WHERE account_id = ${accountId}
  `;

  if (Number(row.count) >= limit.daemons) {
    return {
      allowed: false,
      reason:  `Daemon limit reached (${limit.daemons} on ${plan} plan).`,
    };
  }

  return { allowed: true };
}
