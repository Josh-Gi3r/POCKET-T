import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import sql from '../db/client.js';
import { requireAuth } from './auth.js';
import { audit } from '../db/queries.js';

// Lazy: never construct Stripe at module load. The Stripe constructor
// throws on a missing key, which would take the relay down at boot.
let _stripe: Stripe | null = null;
function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Guide pins a newer API version than stripe@14's type union.
      apiVersion: '2024-06-20' as any,
    });
  }
  return _stripe;
}

const PLAN_PRICES: Record<string, string> = {
  pro:  process.env.STRIPE_PRO_PRICE_ID!,
  team: process.env.STRIPE_TEAM_PRICE_ID!,
};

const PLAN_LIMITS = {
  free: { daemons: 1,  sessions: 10,  seats: 1  },
  pro:  { daemons: 10, sessions: 100, seats: 1  },
  team: { daemons: 50, sessions: 500, seats: 25 },
};

export async function billingRoutes(app: FastifyInstance) {

  // ── Create checkout session ─────────────────────────────────────────────
  app.post<{ Body: { plan: 'pro' | 'team'; seats?: number } }>(
    '/api/billing/checkout',
    { onRequest: [requireAuth] },
    async (req: any) => {
      const { plan, seats = 1 } = req.body;

      // Get or create Stripe customer
      let [billing] = await sql`
        SELECT * FROM billing WHERE account_id = ${req.accountId}
      `;

      let customerId: string;
      if (billing?.stripeCustomerId) {
        customerId = billing.stripeCustomerId;
      } else {
        const customer = await stripe().customers.create({
          email:    req.email,
          metadata: { accountId: req.accountId },
        });
        customerId = customer.id;

        await sql`
          INSERT INTO billing (account_id, stripe_customer_id, plan)
          VALUES (${req.accountId}, ${customerId}, 'free')
          ON CONFLICT (account_id) DO UPDATE
          SET stripe_customer_id = ${customerId}
        `;
      }

      const session = await stripe().checkout.sessions.create({
        customer:            customerId,
        payment_method_types: ['card'],
        mode:                'subscription',
        line_items: [{
          price:    PLAN_PRICES[plan],
          quantity: plan === 'team' ? seats : 1,
        }],
        success_url: `${process.env.APP_URL}/dashboard?billing=success`,
        cancel_url:  `${process.env.APP_URL}/dashboard?billing=cancelled`,
        metadata:    { accountId: req.accountId, plan, seats: String(seats) },
        subscription_data: {
          metadata: { accountId: req.accountId },
        },
      });

      await audit({
        accountId: req.accountId,
        userId:    req.userId,
        event:     'billing_checkout_started',
        meta:      { plan, seats },
      });

      return { url: session.url };
    },
  );

  // ── Customer portal (manage subscription) ──────────────────────────────
  app.post(
    '/api/billing/portal',
    { onRequest: [requireAuth] },
    async (req: any, reply) => {
      const [billing] = await sql`
        SELECT stripe_customer_id FROM billing
        WHERE account_id = ${req.accountId}
      `;

      if (!billing?.stripeCustomerId) {
        return reply.code(400).send({
          error: 'No billing account. Subscribe first.',
        });
      }

      const session = await stripe().billingPortal.sessions.create({
        customer:   billing.stripeCustomerId,
        return_url: `${process.env.APP_URL}/dashboard`,
      });

      return { url: session.url };
    },
  );

  // ── Current billing status ──────────────────────────────────────────────
  app.get(
    '/api/billing/status',
    { onRequest: [requireAuth] },
    async (req: any) => {
      const [billing] = await sql`
        SELECT plan, seat_count, current_period_end, cancel_at_period_end
        FROM billing
        WHERE account_id = ${req.accountId}
      `;

      const plan    = billing?.plan ?? 'free';
      const limits  = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];

      return {
        plan,
        seatCount:          billing?.seatCount          ?? 1,
        currentPeriodEnd:   billing?.currentPeriodEnd   ?? null,
        cancelAtPeriodEnd:  billing?.cancelAtPeriodEnd  ?? false,
        limits,
      };
    },
  );

  // ── Stripe webhook ──────────────────────────────────────────────────────
  app.post(
    '/api/billing/webhook',
    {
      config: { rawBody: true },  // Need raw body for signature verification
    },
    async (req: any, reply) => {
      const sig = req.headers['stripe-signature'];
      let event: Stripe.Event;

      try {
        event = stripe().webhooks.constructEvent(
          req.rawBody,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET!,
        );
      } catch (err: any) {
        console.error('[stripe] webhook signature failed:', err.message);
        return reply.code(400).send({ error: 'Invalid signature' });
      }

      await handleWebhookEvent(event);
      return { received: true };
    },
  );
}

async function handleWebhookEvent(event: Stripe.Event) {
  switch (event.type) {

    case 'checkout.session.completed': {
      const session  = event.data.object as Stripe.Checkout.Session;
      const { accountId, plan, seats } = session.metadata ?? {};
      if (!accountId || !plan) break;

      await sql`
        INSERT INTO billing
          (account_id, stripe_customer_id, stripe_sub_id, plan, seat_count)
        VALUES
          (${accountId}, ${session.customer as string},
           ${session.subscription as string}, ${plan}, ${Number(seats ?? 1)})
        ON CONFLICT (account_id) DO UPDATE SET
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_sub_id      = EXCLUDED.stripe_sub_id,
          plan               = EXCLUDED.plan,
          seat_count         = EXCLUDED.seat_count,
          updated_at         = NOW()
      `;

      // Update account plan
      await sql`UPDATE accounts SET plan = ${plan} WHERE id = ${accountId}`;

      console.log(`[stripe] ${accountId} upgraded to ${plan}`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const accountId = sub.metadata?.accountId;
      if (!accountId) break;

      const plan       = getPlanFromSub(sub);
      const seats      = sub.items.data[0]?.quantity ?? 1;
      const periodEnd  = new Date((sub as any).current_period_end * 1000);
      const cancelling = sub.cancel_at_period_end;

      await sql`
        UPDATE billing SET
          plan               = ${plan},
          seat_count         = ${seats},
          current_period_end = ${periodEnd},
          cancel_at_period_end = ${cancelling},
          updated_at         = NOW()
        WHERE stripe_sub_id = ${sub.id}
      `;

      await sql`UPDATE accounts SET plan = ${plan} WHERE id = ${accountId}`;
      break;
    }

    case 'customer.subscription.deleted': {
      const sub       = event.data.object as Stripe.Subscription;
      const accountId = sub.metadata?.accountId;
      if (!accountId) break;

      await sql`
        UPDATE billing SET
          plan       = 'free',
          stripe_sub_id = NULL,
          updated_at = NOW()
        WHERE stripe_sub_id = ${sub.id}
      `;

      await sql`UPDATE accounts SET plan = 'free' WHERE id = ${accountId}`;
      console.log(`[stripe] ${accountId} downgraded to free`);
      break;
    }
  }
}

function getPlanFromSub(sub: Stripe.Subscription): string {
  const priceId = sub.items.data[0]?.price?.id;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID)  return 'pro';
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'team';
  return 'free';
}
