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
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3 font-mono font-bold tracking-tighter">
            p<span className="text-white/30">ocket-t</span>
          </div>
          <p className="text-white/30 text-sm">p stands for terminal</p>
        </div>

        <div className="bg-surface-raised border border-white/8 rounded-2xl p-6">
          <div className="flex gap-1 mb-6 bg-surface-overlay rounded-xl p-1">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 text-sm font-medium py-1.5 rounded-lg transition-colors ${
                  mode === m
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-white/50 block mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-indigo-500/50"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="text-xs text-white/50 block mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-indigo-500/50"
                placeholder={mode === 'register' ? 'min 8 characters' : '••••••••'}
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              {loading
                ? 'Please wait…'
                : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/25 text-xs mt-6">
          Free forever to self-host ·{' '}
          <a
            href="https://github.com/your-org/pocket-t"
            className="underline hover:text-white/40"
          >
            Open source
          </a>
        </p>
      </div>
    </div>
  );
}
