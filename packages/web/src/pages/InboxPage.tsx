import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useSessionsStore } from '../store/sessions.js';
import { InstallPrompt } from '../components/InstallPrompt.js';
import { BottomNav } from '../components/BottomNav.js';
import { ConnectionBar } from '../components/ConnectionBar.js';
import { usePush } from '../hooks/usePush.js';
import type { Session } from '@pocket-t/shared';

const RANK: Record<string, number> =
  { waiting: 0, running: 1, idle: 2, dead: 3 };

export function InboxPage() {
  const navigate      = useNavigate();
  const sessions      = useSessionsStore((s) => s.sessions);
  const daemonOnline  = useSessionsStore((s) => s.daemonOnline);
  const { state: pushState } = usePush();
  const [query, setQuery] = useState('');

  const anyOnline = Object.values(daemonOnline).some(Boolean);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? sessions.filter((s) =>
          `${s.name} ${s.cmd} ${s.cwd}`.toLowerCase().includes(q))
      : sessions;
    return [...list].sort((a, b) => {
      const pa = RANK[a.status] ?? 4;
      const pb = RANK[b.status] ?? 4;
      if (pa !== pb) return pa - pb;
      return b.lastActiveAt - a.lastActiveAt;
    });
  }, [sessions, query]);

  // Group by Mac only when more than one daemon is involved, so a
  // multi-Mac account stays legible instead of an undifferentiated list.
  const daemonIds = useMemo(
    () => [...new Set(sessions.map((s) => s.daemonId))],
    [sessions],
  );
  const grouped = daemonIds.length > 1;
  const groups = useMemo(() => {
    if (!grouped) return [['', filtered]] as [string, Session[]][];
    const m = new Map<string, Session[]>();
    for (const s of filtered) {
      const arr = m.get(s.daemonId);
      if (arr) arr.push(s);
      else m.set(s.daemonId, [s]);
    }
    return [...m.entries()];
  }, [filtered, grouped]);

  return (
    <div className="app-shell flex flex-col app-h">
      <header className="glass-panel mx-3 mt-3 flex items-center justify-between px-4 pt-safe pb-3 pt-3 rounded-[28px] flex-shrink-0">
        <div className="font-mono font-bold text-lg tracking-tight text-slate-900">
          p<span className="text-violet-500/80">ocket-t</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              anyOnline ? 'bg-emerald-400' : 'bg-white/20'
            }`} />
            <span className="text-xs text-slate-500">
              {anyOnline ? 'Mac online' : 'No Mac'}
            </span>
          </div>
          <button
            onClick={() => navigate('/spawn')}
            className="tap flex items-center gap-1 text-sm text-violet-600 hover:text-violet-500 font-semibold"
          >
            <Plus size={16} />
            New
          </button>
        </div>
      </header>

      <ConnectionBar />
      <InstallPrompt pushState={pushState} />

      {sessions.length > 4 && (
        <div className="px-4 py-3 flex-shrink-0">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500/55"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              className="soft-input w-full rounded-2xl pl-9 pr-3 py-2 text-base
                         focus:outline-none focus:ring-2 focus:ring-violet-300/50"
            />
          </div>
        </div>
      )}

      {!anyOnline && sessions.length === 0 && <NoDaemonState />}

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {anyOnline && sessions.length === 0 && (
          <div className="glass-card rounded-[28px] flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <span className="text-4xl">+</span>
            <p className="text-sm font-medium">No sessions running</p>
            <button
              onClick={() => navigate('/spawn')}
              className="lavender-button text-xs font-semibold px-4 py-2 rounded-full"
            >
              Start a session
            </button>
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-10">
            No sessions match “{query}”.
          </p>
        )}

        {groups.map(([daemonId, rows]) => (
          <div key={daemonId || 'all'}>
            {grouped && (
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-wide
                              text-slate-500/70 font-mono">
                Mac · {daemonId.slice(0, 8)}
              </div>
            )}
            <div className="flex flex-col gap-2">
              {rows.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onClick={() => navigate(`/chat/${s.id}`)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  );
}

function SessionRow({ session, onClick }: { session: Session; onClick: () => void }) {
  const statusColor: Record<string, string> = {
    running: 'bg-emerald-400',
    waiting: 'bg-amber-400 animate-pulse',
    idle:    'bg-white/20',
    dead:    'bg-red-500/40',
  };

  const cmdBase = session.cmd.split(' ')[0].split('/').pop() ?? session.cmd;

  return (
    <button
      className="glass-card w-full flex items-center gap-3 px-4 py-3.5 rounded-[24px]
                 hover:bg-white/65 active:scale-[0.99] transition text-left"
      onClick={onClick}
    >
      <div className="relative flex-shrink-0">
        <div className="w-11 h-11 rounded-2xl bg-white/60 border border-white/80 flex items-center justify-center font-mono text-xs font-semibold text-violet-700 shadow-sm">
          {cmdBase.slice(0, 4)}
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${statusColor[session.status]}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-semibold text-sm text-slate-900 truncate">
            {session.name}
          </span>
          <span className="text-[10px] text-slate-500/70 flex-shrink-0">
            {timeAgo(session.lastActiveAt)}
          </span>
        </div>
        <p className="text-xs text-slate-500 truncate font-mono">
          {session.lastOutput || session.cmd}
        </p>
      </div>

      {session.status === 'waiting' && (
        <span className="flex-shrink-0 text-[10px] font-semibold bg-amber-200/70 text-amber-700 px-2 py-1 rounded-full">
          REPLY
        </span>
      )}
    </button>
  );
}

function NoDaemonState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8 gap-4 text-center">
      <div className="glass-card w-16 h-16 rounded-[24px] flex items-center justify-center text-3xl text-violet-600">⌘</div>
      <div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Connect your Mac
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          Install the pocket-t daemon to start monitoring sessions.
        </p>
      </div>
      <div className="glass-card rounded-[24px] px-4 py-3 w-full text-left">
        <p className="text-xs text-slate-500 font-mono mb-2">Install:</p>
        <code className="text-xs text-emerald-700 font-mono block">
          curl -fsSL install.pocket-t.ai | sh
        </code>
        <p className="text-xs text-slate-500 font-mono mt-3 mb-1">Then:</p>
        <code className="text-xs text-violet-700 font-mono block">
          pocket-t auth &lt;token&gt;
        </code>
      </div>
      <p className="text-xs text-slate-500">
        Get your token from the Dashboard tab
      </p>
    </div>
  );
}

function timeAgo(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000)       return 'now';
  if (d < 3_600_000)    return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000)   return `${Math.floor(d / 3_600_000)}h`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
