import { useNavigate, useLocation } from 'react-router-dom';
import { Inbox, Plus, Settings } from 'lucide-react';

const ITEMS = [
  { to: '/',          label: 'Sessions',  icon: Inbox },
  { to: '/spawn',     label: 'New',       icon: Plus },
  { to: '/dashboard', label: 'Settings',  icon: Settings },
] as const;

// Persistent app navigation. Before this, the Dashboard (where you get the
// pairing token) was unreachable from the UI — the empty state told users
// to "open the Dashboard tab" that did not exist.
export function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav
      className="glass-nav flex-shrink-0 flex items-stretch pb-safe"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => {
        const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
        return (
          <button
            key={to}
            onClick={() => navigate(to)}
            className={`flex-1 tap flex flex-col items-center justify-center gap-0.5
                        py-2 transition-colors ${
              active ? 'text-violet-600' : 'text-slate-500/70 hover:text-violet-500'
            }`}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} />
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
