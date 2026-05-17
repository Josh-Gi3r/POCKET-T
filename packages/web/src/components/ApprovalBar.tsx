import type { Message } from '@pocket-t/shared';

interface Props {
  message:   Message;
  onRespond: (choice: string, messageId: string) => void;
}

export function ApprovalBar({ message, onRespond }: Props) {
  if (!message.approvalOptions?.length || !message.approvalPending) return null;

  return (
    <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-3 flex-shrink-0">
      <p className="text-[11px] text-amber-400/70 font-semibold uppercase tracking-wide mb-2.5">
        Approval needed
      </p>
      <div className="flex gap-2 flex-wrap">
        {message.approvalOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onRespond(opt.key, message.id)}
            className={`
              text-sm font-medium px-4 py-2.5 rounded-xl transition-colors active:scale-95
              ${opt.variant === 'primary'
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                : opt.variant === 'danger'
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/20'
                : 'bg-white/10 hover:bg-white/15 text-white/70'}
            `}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
