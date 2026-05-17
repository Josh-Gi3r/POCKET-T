import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuthStore } from '../store/auth.js';
import { usePush } from '../hooks/usePush.js';

// Phase 2: hosted/paid plans. pocket-t ships fully free & open source —
// billing & team UI stay in the codebase but are not surfaced yet.
const PHASE_2_BILLING = false;

interface BillingStatus {
  plan:               string;
  seatCount:          number;
  currentPeriodEnd:   string | null;
  cancelAtPeriodEnd:  boolean;
  limits: {
    daemons:     number;
    sessions:    number;
    historyDays: number;
  };
}

function BillingSection() {
  const [billing, setBilling]   = useState<BillingStatus | null>(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    fetch('/api/billing/status', { credentials: 'include' })
      .then((r) => r.json())
      .then(setBilling)
      .catch(() => {});
  }, []);

  async function openPortal() {
    setLoading(true);
    const res  = await fetch('/api/billing/portal', {
      method: 'POST', credentials: 'include',
    });
    const data = await res.json() as any;
    setLoading(false);
    if (data.url) window.open(data.url, '_blank');
  }

  async function upgrade(plan: 'pro' | 'team') {
    setLoading(true);
    const res  = await fetch('/api/billing/checkout', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ plan }),
    });
    const data = await res.json() as any;
    setLoading(false);
    if (data.url) window.location.href = data.url;
  }

  if (!billing) return null;

  const planLabel: Record<string, string> = {
    free: 'Free',
    pro:  'Pro — $9/mo',
    team: 'Team — $29/seat/mo',
  };

  return (
    <div className="bg-surface-raised border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/6">
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide">
          Billing
        </p>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">Current plan</span>
          <span className="text-xs font-semibold text-white/80">
            {planLabel[billing.plan] ?? billing.plan}
          </span>
        </div>

        {billing.plan !== 'free' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Daemons</span>
              <span className="text-xs text-white/60">up to {billing.limits.daemons}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">Sessions</span>
              <span className="text-xs text-white/60">up to {billing.limits.sessions}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">History</span>
              <span className="text-xs text-white/60">{billing.limits.historyDays} days</span>
            </div>
            {billing.currentPeriodEnd && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">
                  {billing.cancelAtPeriodEnd ? 'Cancels' : 'Renews'}
                </span>
                <span className="text-xs text-white/60">
                  {new Date(billing.currentPeriodEnd).toLocaleDateString()}
                </span>
              </div>
            )}
          </>
        )}

        {billing.plan === 'free' ? (
          <div className="flex flex-col gap-2 mt-1">
            <button
              onClick={() => upgrade('pro')}
              disabled={loading}
              className="w-full bg-indigo-600 text-white text-xs font-medium py-2.5 rounded-xl disabled:opacity-50"
            >
              Upgrade to Pro — $9/mo
            </button>
            <button
              onClick={() => upgrade('team')}
              disabled={loading}
              className="w-full bg-white/8 text-white/70 text-xs font-medium py-2.5 rounded-xl"
            >
              Team plan — $29/seat/mo
            </button>
          </div>
        ) : (
          <button
            onClick={openPortal}
            disabled={loading}
            className="w-full bg-white/8 text-white/60 text-xs font-medium py-2.5 rounded-xl mt-1 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Manage subscription'}
          </button>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate              = useNavigate();
  const { email, plan, clearAuth } = useAuthStore();
  const { state: pushState, enablePush } = usePush();
  const [token, setToken]     = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copied, setCopied]   = useState(false);

  async function generateToken() {
    setTokenLoading(true);
    try {
      const res  = await fetch('/api/daemon/generate-token', {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json() as any;
      setToken(data.token);
    } finally {
      setTokenLoading(false);
    }
  }

  async function copyCmd() {
    const cmd = `curl -fsSL https://install.pocket-t.app | sh\npocket-t auth ${token}`;
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="flex flex-col h-screen bg-surface">
      <header className="flex items-center gap-3 px-4 pt-safe pb-3 pt-3 border-b border-white/8">
        <button onClick={() => navigate(-1)} className="text-white/40">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-sm font-semibold">Dashboard</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Account */}
        <Section title="Account">
          <Row label="Email" value={email ?? '—'} />
          <Row label="Plan"  value={<PlanBadge plan={plan ?? 'free'} />} />
        </Section>

        {/* Connect Mac */}
        <Section title="Connect your Mac">
          <p className="text-xs text-white/40 mb-3 leading-relaxed">
            Generate a one-time token (expires in 15 minutes), then run the
            install command on your Mac.
          </p>
          {!token ? (
            <button
              onClick={generateToken}
              disabled={tokenLoading}
              className="w-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-sm font-medium py-2.5 rounded-xl hover:bg-indigo-600/30 transition-colors disabled:opacity-50"
            >
              {tokenLoading ? 'Generating…' : 'Generate install token'}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="bg-surface-overlay rounded-xl p-3 border border-white/8">
                <p className="text-[10px] text-white/30 mb-1.5">Run on your Mac:</p>
                <code className="text-xs font-mono text-emerald-400 break-all leading-relaxed whitespace-pre">
                  {`curl -fsSL https://install.pocket-t.app | sh\npocket-t auth ${token}`}
                </code>
              </div>
              <button onClick={copyCmd} className="text-xs text-white/40">
                {copied ? '✓ Copied!' : 'Copy command'}
              </button>
              <button onClick={() => setToken(null)} className="text-xs text-white/25">
                Generate new token
              </button>
            </div>
          )}
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          {pushState === 'not-standalone' && (
            <p className="text-xs text-amber-400/80 leading-relaxed">
              Add pocket-t to your Home Screen to enable push notifications.
            </p>
          )}
          {pushState === 'prompt' && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-white/40">Push notifications off</p>
              <button onClick={enablePush} className="text-xs text-indigo-400 font-medium">
                Enable
              </button>
            </div>
          )}
          {pushState === 'enabled' && (
            <p className="text-xs text-emerald-400">✓ Push notifications enabled</p>
          )}
          {pushState === 'denied' && (
            <p className="text-xs text-red-400/70">
              Blocked. Enable in Safari Settings → pocket-t.
            </p>
          )}
        </Section>

        {/* Billing + Team — Phase 2 (hosted plans). Hidden: pocket-t is
            fully free & open source. Code retained for a future phase. */}
        {PHASE_2_BILLING && (
          <>
            <BillingSection />
            <Section title="Team">
              <button
                onClick={() => navigate('/team')}
                className="text-xs text-indigo-400"
              >
                Manage team →
              </button>
            </Section>
          </>
        )}

        {/* Open source */}
        <Section title="Open source">
          <p className="text-xs text-white/40 leading-relaxed mb-2">
            pocket-t is MIT licensed. Self-host the relay and daemon for free.
          </p>
          <a
            href="https://github.com/your-org/pocket-t"
            className="text-xs text-indigo-400 hover:text-indigo-300"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/your-org/pocket-t →
          </a>
        </Section>

        <button
          onClick={logout}
          className="text-sm text-red-400/60 hover:text-red-400 text-center py-2"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-raised border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/6">
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide">
          {title}
        </p>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-xs text-white/80">{value}</span>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    free: 'bg-white/8 text-white/50',
    pro:  'bg-purple-500/15 text-purple-400',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${styles[plan] ?? styles.free}`}>
      {plan}
    </span>
  );
}
