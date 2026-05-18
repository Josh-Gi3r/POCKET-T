import webpush from 'web-push';
import {
  getPushSubsByAccount,
  deletePushSub,
} from '../db/queries.js';
import type { ApprovalOption } from '@pocket-t/shared';

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_CONTACT ?? 'ops@pocket-t.ai'}`,
  process.env.VAPID_PUBLIC!,
  process.env.VAPID_PRIVATE!,
);

interface PushPayload {
  title:     string;
  body:      string;
  sessionId: string;
  messageId?: string;
  kind:      'approval' | 'waiting' | 'dead';
  options?:  ApprovalOption[];
}

async function sendToAccount(accountId: string, payload: PushPayload) {
  const subs = await getPushSubsByAccount(accountId);

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          {
            TTL:     payload.kind === 'approval' ? 180 : 60,
            urgency: payload.kind === 'approval' ? 'high' : 'normal',
            topic:   `session:${payload.sessionId.slice(0, 30)}`,
          },
        );
      } catch (e: any) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await deletePushSub(sub.endpoint);
        }
      }
    }),
  );
}

export async function notifyApproval(
  accountId:   string,
  sessionName: string,
  sessionId:   string,
  messageId:   string,
  options:     ApprovalOption[],
) {
  await sendToAccount(accountId, {
    title:     sessionName,
    body:      `Approval needed: ${options.map((o) => o.label).join(' / ')}`,
    sessionId,
    messageId,
    kind:      'approval',
    options,
  });
}

export async function notifyWaiting(
  accountId:   string,
  sessionName: string,
  sessionId:   string,
) {
  await sendToAccount(accountId, {
    title:     sessionName,
    body:      'Waiting for your input',
    sessionId,
    kind:      'waiting',
  });
}

export async function notifyDead(
  accountId:   string,
  sessionName: string,
  sessionId:   string,
) {
  await sendToAccount(accountId, {
    title:     sessionName,
    body:      'Session ended',
    sessionId,
    kind:      'dead',
  });
}
