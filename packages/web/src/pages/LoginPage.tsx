import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.js';

type Mode = 'login' | 'register';

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth  = useAuthStore((s) => s.setAuth);
  const [mode, setMode]       = useState<Mode>('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(
        mode === 'login' ? '/api/auth/login' : '/api/auth/register',
        {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body:        JSON.stringify({ email, password }),
        },
      );
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return; }

      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json() as any;
      setAuth({ accountId: me.accountId, email: me.email, plan: me.plan });
      navigate('/');
    } catch {
      setError('Network error. Is the relay running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell min-app-h flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3 font-mono font-bold tracking-tighter text-slate-900">
            p<span className="text-violet-500/80">ocket-t</span>
          </div>
          <p className="text-slate-500 text-sm">p stands for terminal</p>
        </div>

        <div className="glass-panel rounded-[32px] p-6">
          <div className="flex gap-1 mb-6 bg-white/45 rounded-[22px] p-1 border border-white/60">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 text-sm font-semibold py-1.5 rounded-2xl transition-colors ${
                  mode === m
                    ? 'lavender-button'
                    : 'text-slate-500 hover:text-violet-600'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-slate-500 block mb-1.5 font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="soft-input w-full rounded-[22px] px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-violet-300/50"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500 block mb-1.5 font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="soft-input w-full rounded-[22px] px-3.5 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-violet-300/50"
                placeholder={mode === 'register' ? 'min 8 characters' : '••••••••'}
              />
            </div>

            {error && (
              <p className="text-red-700 text-xs bg-red-100/70 rounded-2xl px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="lavender-button w-full disabled:opacity-50 font-semibold py-2.5 rounded-[22px] text-sm transition active:scale-[0.99]"
            >
              {loading
                ? 'Please wait…'
                : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          Free forever to self-host ·{' '}
          <a
            href="https://github.com/your-org/pocket-t"
            className="underline hover:text-violet-600"
          >
            Open source
          </a>
        </p>
      </div>
    </div>
  );
}
