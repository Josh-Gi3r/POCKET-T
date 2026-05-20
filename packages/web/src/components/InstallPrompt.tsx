import { usePush } from '../hooks/usePush.js';

export function InstallPrompt({ pushState }: { pushState: string }) {
  const { enablePush } = usePush();

  if (pushState === 'not-standalone') {
    return (
      <div className="mx-3 mt-2 glass-card rounded-[24px] px-4 py-2.5 flex items-start gap-3">
        <span className="text-lg flex-shrink-0 mt-0.5 text-violet-600">▣</span>
        <div>
          <p className="text-xs font-semibold text-violet-700">
            Install for push notifications
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
            Tap <strong>⎋ Share</strong> → "Add to Home Screen" → open from home screen.
          </p>
        </div>
      </div>
    );
  }

  if (pushState === 'prompt') {
    return (
      <div className="mx-3 mt-2 glass-card rounded-[24px] px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-emerald-700">
          Get notified when sessions need input
        </p>
        <button
          onClick={enablePush}
          className="text-xs font-semibold text-emerald-700 bg-emerald-100/80 px-3 py-1 rounded-full flex-shrink-0"
        >
          Enable
        </button>
      </div>
    );
  }

  return null;
}
