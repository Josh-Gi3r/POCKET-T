import { usePush } from '../hooks/usePush.js';

export function InstallPrompt({ pushState }: { pushState: string }) {
  const { enablePush } = usePush();

  if (pushState === 'not-standalone') {
    return (
      <div className="bg-indigo-600/10 border-b border-indigo-500/15 px-4 py-2.5 flex items-start gap-3">
        <span className="text-lg flex-shrink-0 mt-0.5">📲</span>
        <div>
          <p className="text-xs font-medium text-indigo-300">
            Install for push notifications
          </p>
          <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed">
            Tap <strong>⎋ Share</strong> → "Add to Home Screen" → open from home screen.
          </p>
        </div>
      </div>
    );
  }

  if (pushState === 'prompt') {
    return (
      <div className="bg-emerald-600/8 border-b border-emerald-500/15 px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-emerald-400/80">
          Get notified when sessions need input
        </p>
        <button
          onClick={enablePush}
          className="text-xs font-semibold text-emerald-400 bg-emerald-500/15 px-3 py-1 rounded-full flex-shrink-0"
        >
          Enable
        </button>
      </div>
    );
  }

  return null;
}
