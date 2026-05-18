import type { FastifyInstance } from 'fastify';
import { randomBytes, createHash } from 'node:crypto';
import sql from '../db/client.js';
import { requireAuth } from './auth.js';
import { audit } from '../db/queries.js';

export async function teamRoutes(app: FastifyInstance) {

  // ── List team members ────────────────────────────────────────────────────
  app.get(
    '/api/team/members',
    { onRequest: [requireAuth] },
    async (req: any) => {
      const members = await sql`
        SELECT
          tm.id, tm.role, tm.joined_at,
          u.email, u.id AS user_id
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.account_id = ${req.accountId}
        ORDER BY tm.joined_at ASC
      `;
      return { members };
    },
  );

  // ── Invite member ────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; role?: 'admin' | 'member' } }>(
    '/api/team/invite',
    { onRequest: [requireAuth] },
    async (req: any, reply) => {
      // Only owners/admins can invite
      const [caller] = await sql`
        SELECT role FROM team_members
        WHERE account_id = ${req.accountId} AND user_id = ${req.userId}
      `;
      if (!caller || caller.role === 'member') {
        return reply.code(403).send({ error: 'Insufficient permissions.' });
      }

      // Check team plan
      const [billing] = await sql`
        SELECT plan, seat_count FROM billing WHERE account_id = ${req.accountId}
      `;
      if (!billing || billing.plan !== 'team') {
        return reply.code(403).send({
          error: 'Team invites require a Team plan.',
        });
      }

      // Check seat limit
      const [usage] = await sql`
        SELECT COUNT(*) AS count FROM team_members
        WHERE account_id = ${req.accountId}
      `;
      if (Number(usage.count) >= billing.seatCount) {
        return reply.code(403).send({
          error: `Seat limit reached (${billing.seatCount}). Add seats in billing.`,
        });
      }

      const { email, role = 'member' } = req.body;
      const token     = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expires   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await sql`
        INSERT INTO team_invites
          (account_id, email, role, token_hash, invited_by, expires_at)
        VALUES
          (${req.accountId}, ${email.toLowerCase()}, ${role},
           ${tokenHash}, ${req.userId}, ${expires})
        ON CONFLICT DO NOTHING
      `;

      // TODO: send invite email — wire to your email provider
      const inviteUrl = `${process.env.APP_URL}/join/${token}`;

      await audit({
        accountId: req.accountId,
        userId:    req.userId,
        event:     'team_invite_sent',
        meta:      { email, role },
      });

      return { inviteUrl };
    },
  );

  // ── Accept invite ────────────────────────────────────────────────────────
  app.post<{ Params: { token: string } }>(
    '/api/team/join/:token',
    { onRequest: [requireAuth] },
    async (req: any, reply) => {
      const tokenHash = createHash('sha256')
        .update(req.params.token)
        .digest('hex');

      const [invite] = await sql`
        SELECT * FROM team_invites
        WHERE token_hash = ${tokenHash}
          AND accepted = FALSE
          AND expires_at > NOW()
      `;

      if (!invite) {
        return reply.code(404).send({ error: 'Invalid or expired invite.' });
      }

      // Verify email matches
      if (invite.email !== req.email.toLowerCase()) {
        return reply.code(403).send({
          error: 'This invite was sent to a different email address.',
        });
      }

      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO team_members (account_id, user_id, role, invited_by)
          VALUES (${invite.accountId}, ${req.userId}, ${invite.role}, ${invite.invitedBy})
          ON CONFLICT (account_id, user_id) DO NOTHING
        `;
        await tx`
          UPDATE team_invites SET accepted = TRUE WHERE id = ${invite.id}
        `;
      });

      await audit({
        accountId: invite.accountId,
        userId:    req.userId,
        event:     'team_invite_accepted',
      });

      return { ok: true, accountId: invite.accountId };
    },
  );

  // ── Remove member ────────────────────────────────────────────────────────
  app.delete<{ Params: { userId: string } }>(
    '/api/team/members/:userId',
    { onRequest: [requireAuth] },
    async (req: any, reply) => {
      // Only owners/admins can remove
      const [caller] = await sql`
        SELECT role FROM team_members
        WHERE account_id = ${req.accountId} AND user_id = ${req.userId}
      `;

      if (!caller || caller.role === 'member') {
        return reply.code(403).send({ error: 'Insufficient permissions.' });
      }

      // Never strand an account with no owner.
      const [target] = await sql`
        SELECT role FROM team_members
        WHERE account_id = ${req.accountId} AND user_id = ${req.params.userId}
      `;
      if (target?.role === 'owner') {
        const [{ count }] = await sql`
          SELECT COUNT(*) AS count FROM team_members
          WHERE account_id = ${req.accountId} AND role = 'owner'
        `;
        if (Number(count) <= 1) {
          return reply.code(403).send({ error: 'Cannot remove the last owner.' });
        }
      }

      await sql`
        DELETE FROM team_members
        WHERE account_id = ${req.accountId}
          AND user_id = ${req.params.userId}
      `;

      await audit({
        accountId: req.accountId,
        userId:    req.userId,
        event:     'team_member_removed',
        meta:      { removedUserId: req.params.userId },
      });

      return { ok: true };
    },
  );
}
