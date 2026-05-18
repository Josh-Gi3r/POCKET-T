import { useUiStore } from '../store/ui.js';

// Thin banner shown only when the realtime socket is not connected, so the
// user never stares at a silently-frozen screen wondering why nothing
// updates.
export function ConnectionBar() {
  const conn = useUiStore((s) => s.conn);
  if (conn === 'connected') return null;

  const reconnecting = conn === 'connecting';
  return (
    <div
      className={`flex-shrink-0 text-center text-[11px] font-medium py-1 ${
        reconnecting
          ? 'bg-amber-500/15 text-amber-300'
          : 'bg-red-500/15 text-red-300'
      }`}
      role="status"
    >
      {reconnecting ? 'Reconnecting…' : 'Offline — changes won’t sync'}
    </div>
  );
}
