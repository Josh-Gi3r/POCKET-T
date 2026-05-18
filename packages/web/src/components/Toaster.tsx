import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useUiStore, type ToastKind } from '../store/ui.js';

const ICON: Record<ToastKind, typeof Info> = {
  error:   AlertCircle,
  success: CheckCircle2,
  info:    Info,
};
const ACCENT: Record<ToastKind, string> = {
  error:   'text-red-400',
  success: 'text-emerald-400',
  info:    'text-indigo-300',
};

export function Toaster() {
  const toasts  = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
    >
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto w-full max-w-sm flex items-start gap-2.5
                       bg-surface-overlay border border-white/10 rounded-xl
                       px-3.5 py-3 shadow-lg animate-toast-in"
            role="status"
          >
            <Icon size={16} className={`${ACCENT[t.kind]} flex-shrink-0 mt-0.5`} />
            <p className="flex-1 text-sm text-white/85 leading-snug break-words">
              {t.message}
            </p>
            <button
              onClick={() => dismiss(t.id)}
              className="flex-shrink-0 text-white/30 hover:text-white/70"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
