import { useHookApprovalStore } from '../store/hookApprovals.js';
import { Shield } from 'lucide-react';

interface Props { sessionId: string; }

export function HookApprovalBar({ sessionId }: Props) {
  const pending  = useHookApprovalStore((s) => s.pending);
  const resolve  = useHookApprovalStore((s) => s.resolve);

  const approval = [...pending.values()].find(
    (a) => a.sessionId === sessionId
  );

  if (!approval) return null;

  const inputPreview = (() => {
    try {
      const parsed = JSON.parse(approval.toolInput);
      const cmd = parsed.command ?? parsed.path ?? parsed.content ?? '';
      return String(cmd).slice(0, 80);
    } catch { return approval.toolInput.slice(0, 80); }
  })();

  return (
    <div className="border-t border-violet-500/20 bg-violet-500/5 px-4 py-3 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={12} className="text-violet-400" />
        <p className="text-[10px] font-semibold text-violet-400/80 uppercase tracking-wide">
          Tool approval required
        </p>
      </div>
      <div className="bg-white/5 rounded-lg px-3 py-2 mb-3">
        <p className="text-[10px] font-mono text-white/50 mb-0.5">{approval.toolName}</p>
        {inputPreview && (
          <p className="text-xs font-mono text-white/70 truncate">{inputPreview}</p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => resolve(approval.approvalId, 'approve')}
          className="flex-1 bg-emerald-500 text-white text-sm font-medium py-2.5 rounded-xl"
        >
          Allow
        </button>
        <button
          onClick={() => resolve(approval.approvalId, 'deny')}
          className="flex-1 bg-red-500/20 text-red-400 border border-red-500/20 text-sm font-medium py-2.5 rounded-xl"
        >
          Deny
        </button>
      </div>
      <p className="text-[10px] text-white/20 text-center mt-2">
        Auto-denies in 5 minutes
      </p>
    </div>
  );
}
