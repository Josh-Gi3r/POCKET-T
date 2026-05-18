import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, UserPlus, Trash2 } from 'lucide-react';
import { useAuthStore } from '../store/auth.js';

interface Member {
  id:       string;
  userId:   string;
  email:    string;
  role:     string;
  joinedAt: string;
}

export function TeamPage() {
  const navigate        = useNavigate();
  const { email: me }   = useAuthStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUrl, setInviteUrl]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/team/members', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: any) => setMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  async function invite() {
    if (!inviteEmail.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/team/invite', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json() as any;
      if (!res.ok) { setError(data.error); return; }
      setInviteUrl(data.inviteUrl);
      setInviteEmail('');
    } finally {
      setLoading(false);
    }
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this team member?')) return;
    await fetch(`/api/team/members/${userId}`, {
      method: 'DELETE', credentials: 'include',
    });
    setMembers((m) => m.filter((x) => x.userId !== userId));
  }

  return (
    <div className="flex flex-col app-h bg-surface">
      <header className="flex items-center gap-3 px-4 pt-safe pb-3 pt-3 border-b border-white/8">
        <button onClick={() => navigate(-1)} className="text-white/40">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-sm font-semibold">Team</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Members list */}
        <div className="bg-surface-raised border border-white/8 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/6">
            <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide">
              Members ({members.length})
            </p>
          </div>
          {members.length === 0 ? (
            <p className="px-4 py-4 text-xs text-white/30">No members yet.</p>
          ) : (
            members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0">
                <div className="w-8 h-8 rounded-full bg-indigo-500/15 flex items-center justify-center text-[11px] font-semibold text-indigo-400">
                  {m.email[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/80 truncate">{m.email}</p>
                  <p className="text-[10px] text-white/30 capitalize">{m.role}</p>
                </div>
                {m.email !== me && (
                  <button
                    onClick={() => removeMember(m.userId)}
                    className="text-white/20 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Invite */}
        <div className="bg-surface-raised border border-white/8 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/6">
            <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide">
              Invite member
            </p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none"
            />
            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {inviteUrl && (
              <div className="bg-surface-overlay rounded-xl p-3 border border-white/8">
                <p className="text-[10px] text-white/30 mb-1">Share this invite link:</p>
                <code className="text-xs text-emerald-400 break-all">{inviteUrl}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(inviteUrl)}
                  className="text-[10px] text-white/30 mt-2 block"
                >
                  Copy
                </button>
              </div>
            )}
            <button
              onClick={invite}
              disabled={loading || !inviteEmail.trim()}
              className="flex items-center justify-center gap-2 w-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-sm font-medium py-2.5 rounded-xl disabled:opacity-40"
            >
              <UserPlus size={14} />
              {loading ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
