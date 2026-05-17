import { memo } from 'react';
import type { Message } from '@pocket-t/shared';

interface Props {
  message:    Message;
  isStreaming?: boolean;
  onApprove?: (choice: string, messageId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  onApprove,
}: Props) {
  // System messages
  if (message.role === 'system') {
    return (
      <div className="px-4 py-2 text-center">
        <span className="text-[10px] text-white/20 bg-white/5 px-2 py-0.5 rounded-full">
          {message.text.split('\n')[0]}
        </span>
      </div>
    );
  }

  // Approval prompts
  if (message.kind === 'approval' && message.approvalOptions?.length) {
    return (
      <div className="px-4 py-2">
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-3 max-w-[90%]">
          <p className="text-[10px] text-amber-400/80 font-semibold mb-2 uppercase tracking-wide">
            Approval needed
          </p>
          {message.approvalPending ? (
            <div className="flex flex-wrap gap-2">
              {message.approvalOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => onApprove?.(opt.key, message.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors active:scale-95 ${
                    opt.variant === 'primary'
                      ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                      : opt.variant === 'danger'
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-white/10 text-white/60 hover:bg-white/15'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/30">→ {message.approvalChoice}</p>
          )}
        </div>
      </div>
    );
  }

  const isCli  = message.role === 'cli';
  const isUser = message.role === 'user';

  return (
    <div className={`px-4 py-1 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`
        max-w-[88%] rounded-2xl px-3.5 py-2.5 selectable
        ${isCli
          ? 'bg-white/6 border border-white/5 rounded-tl-sm'
          : 'bg-indigo-600/30 text-white rounded-tr-sm'}
        ${isStreaming ? 'opacity-60' : ''}
      `}>
        <pre className={`
          whitespace-pre-wrap break-words leading-relaxed m-0 selectable
          ${isCli ? 'font-mono text-[11.5px] text-white/85' : 'text-sm'}
        `}>
          {message.text}
          {isStreaming && (
            <span className="animate-pulse">▋</span>
          )}
        </pre>
        {!isStreaming && (
          <time className="text-[10px] text-white/20 block text-right mt-1 select-none">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit',
            })}
          </time>
        )}
      </div>
    </div>
  );
});
