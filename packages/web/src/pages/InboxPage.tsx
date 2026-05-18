import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useSessionsStore } from '../store/sessions.js';
import { InstallPrompt } from '../components/InstallPrompt.js';
import { usePush } from '../hooks/usePush.js';
import type { Session } from '@pocket-t/shared';

export function InboxPage() {
  const navigate      = useNavigate();
  const sessions      = useSessionsStore((s) => s.sessions);
  const daemonOnline  = useSessionsStore((s) => s.daemonOnline);
  const { state: pushState } = usePush();

  const anyOnline = Object.values(daemonOnline).some(Boolean);

  const sorted = [...sessions].sort((a, b) => {
    const p = { waiting: 0, running: 1, idle: 2, dead: 3 };
    const pa = p[a.status] ?? 4;
    const pb = p[b.status] ?? 4;
    if (pa !== pb) return pa - pb;
    return b.lastActiveAt - a.lastActiveAt;
  });

  return (
    <div className="flex flex-col h-screen bg-surface">
      <header className="flex items-center justify-between px-4 pt-safe pb-3 pt-3 border-b border-white/8 flex-shrink-0">
        <div className="font-mono font-bold text-lg tracking-tight">
          p<span className="text-white/30">ocket-t</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              anyOnline ? 'bg-emerald-400' : 'bg-white/20'
            }`} />
            <span className="text-xs text-white/30">
              {anyOnline ? 'Mac online' : 'No Mac'}
            </span>
          </div>
          <button
            onClick={() => navigate('/spawn')}
            className="flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300 font-medium"
          >
            <Plus size={16} />
            New
          </button>
        </div>
      </header>

      <InstallPrompt pushState={pushState} />

      {!anyOnline && sessions.length === 0 && <NoDaemonState />}

      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {anyOnline && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30">
            <span className="text-4xl">💤</span>
            <p className="text-sm">No sessions running</p>
            <button
              onClick={() => navigate('/spawn')}
              className="text-xs text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-full"
            >
              Start a session
            </button>
          </div>
        )}

        {sorted.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            onClick={() => navigate(`/chat/${s.id}`)}
          />
        ))}
      </div>
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
      className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/3 active:bg-white/6 transition-colors text-left"
      onClick={onClick}
    >
      <div className="relative flex-shrink-0">
        <div className="w-11 h-11 rounded-[10px] bg-white/8 border border-white/6 flex items-center justify-center font-mono text-xs font-medium text-white/60">
          {cmdBase.slice(0, 4)}
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface ${statusColor[session.status]}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-medium text-sm text-white/90 truncate">
            {session.name}
          </span>
          <span className="text-[10px] text-white/25 flex-shrink-0">
            {timeAgo(session.lastActiveAt)}
          </span>
        </div>
        <p className="text-xs text-white/35 truncate font-mono">
          {session.lastOutput || session.cmd}
        </p>
      </div>

      {session.status === 'waiting' && (
        <span className="flex-shrink-0 text-[10px] font-semibold bg-amber-500/15 text-amber-400 px-2 py-1 rounded-full">
          REPLY
        </span>
      )}
    </button>
  );
}

function NoDaemonState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8 gap-4 text-center">
      <div className="text-5xl">🖥️</div>
      <div>
        <h2 className="text-base font-semibold text-white/80 mb-1">
          Connect your Mac
        </h2>
        <p className="text-sm text-white/40 leading-relaxed">
          Install the pocket-t daemon to start monitoring sessions.
        </p>
      </div>
      <div className="bg-surface-raised border border-white/8 rounded-xl px-4 py-3 w-full text-left">
        <p className="text-xs text-white/30 font-mono mb-2">Install:</p>
        <code className="text-xs text-emerald-400 font-mono block">
          curl -fsSL install.pocket-t.ai | sh
        </code>
        <p className="text-xs text-white/30 font-mono mt-3 mb-1">Then:</p>
        <code className="text-xs text-indigo-400 font-mono block">
          pocket-t auth &lt;token&gt;
        </code>
      </div>
      <p className="text-xs text-white/25">
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
