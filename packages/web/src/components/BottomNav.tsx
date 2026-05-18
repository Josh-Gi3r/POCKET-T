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
      className="flex-shrink-0 flex items-stretch border-t border-white/8
                 bg-surface pb-safe"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => {
        const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
        return (
          <button
            key={to}
            onClick={() => navigate(to)}
            className={`flex-1 tap flex flex-col items-center justify-center gap-0.5
                        py-2 transition-colors ${
              active ? 'text-indigo-400' : 'text-white/35 hover:text-white/60'
            }`}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
