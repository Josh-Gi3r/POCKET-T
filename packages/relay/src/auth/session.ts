// Shared auth verifiers — one source of truth for REST + Socket.IO.
// A-001/A-002/A-003: client sessions are validated against web_sessions
// (revocation-aware), daemon tokens against the daemons table (jti bound).

import { createHash } from 'node:crypto';
import sql from '../db/client.js';
import { verifyJwt, type ClientTokenPayload, type DaemonTokenPayload } from './jwt.js';

export interface ClientCtx { accountId: string; userId: string; email: string; plan: string; }
export interface DaemonCtx { accountId: string; daemonId: string; }

// Validate a client JWT (from the httpOnly cookie) against web_sessions:
// signature + scope + token-hash row + expiry. Throws on any failure.
export async function verifyClientToken(token: string): Promise<ClientCtx> {
  const payload = await verifyJwt(token) as ClientTokenPayload;
  if (payload.scope !== 'client') throw new Error('wrong scope');

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [sess] = await sql`
    SELECT ws.user_id, u.email, a.id AS "accountId", a.plan
    FROM web_sessions ws
    JOIN users u    ON u.id = ws.user_id
    JOIN accounts a ON a.id = u.account_id
    WHERE ws.token_hash = ${tokenHash}
      AND ws.expires_at > NOW()
  `;
  if (!sess) throw new Error('session expired or revoked');
  if (sess.accountId !== payload.accountId || sess.userId !== payload.userId) {
    throw new Error('token/session mismatch');
  }
  return { accountId: sess.accountId, userId: sess.userId, email: sess.email, plan: sess.plan };
}

// Validate a daemon JWT against the daemons table: signature + scope +
// jti bound to an existing daemon row whose id/account match the claims.
export async function verifyDaemonToken(token: string): Promise<DaemonCtx> {
  const payload = await verifyJwt(token) as DaemonTokenPayload;
  if (payload.scope !== 'daemon') throw new Error('wrong scope');
  const jti = (payload as any).jti as string | undefined;
  if (!jti) throw new Error('no jti');

  const [d] = await sql`
    SELECT d.id, d.account_id AS "accountId"
    FROM daemons d
    WHERE d.jwt_jti = ${jti}
  `;
  if (!d) throw new Error('daemon revoked or unknown');
  if (d.id !== payload.daemonId || d.accountId !== payload.accountId) {
    throw new Error('token/daemon mismatch');
  }
  return { accountId: d.accountId, daemonId: d.id };
}

// Parse a single cookie value out of a raw Cookie header.
// The pocket-t_sess cookie is unsigned (raw JWT), matching how it is set.
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

export const SESS_COOKIE = 'pocket-t_sess';
