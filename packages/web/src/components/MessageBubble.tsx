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
  const approvalOptions = Array.isArray(message.approvalOptions)
    ? message.approvalOptions
    : [];
  if (message.kind === 'approval' && approvalOptions.length) {
    return (
      <div className="px-4 py-2">
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-3 max-w-[90%]">
          <p className="text-[10px] text-amber-400/80 font-semibold mb-2 uppercase tracking-wide">
            Approval needed
          </p>
          {message.approvalPending ? (
            <div className="flex flex-wrap gap-2">
              {approvalOptions.map((opt) => (
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

  const isUser = message.role === 'user';
  const time = !isStreaming && (
    <time className="text-[10px] text-white/20 block text-right mt-1 select-none">
      {new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      })}
    </time>
  );

  // ── Agent ACTION — a tool call. Visually "doing", not "talking". ──
  if (message.kind === 'tool-call') {
    return (
      <div className="px-4 py-1 flex justify-start">
        <div className="max-w-[92%] rounded-xl rounded-tl-sm px-3 py-2
          bg-violet-500/10 border border-violet-500/25 selectable overflow-hidden">
          <div className="flex items-center gap-2 text-[10px] font-semibold
            uppercase tracking-wide text-violet-300/80 mb-1">
            <span>⏵</span><span>Action</span>
          </div>
          <pre className="whitespace-pre-wrap break-words overflow-x-auto m-0
            font-mono text-[11.5px] text-violet-100/90 selectable">{message.text}</pre>
          {time}
        </div>
      </div>
    );
  }

  // ── Tool result / diff / error — secondary, muted. ──
  if (message.kind === 'tool-result' || message.kind === 'diff' || message.kind === 'error') {
    return (
      <div className="px-4 py-1 flex justify-start">
        <div className="max-w-[92%] rounded-xl rounded-tl-sm px-3 py-2
          bg-white/4 border border-white/5 selectable overflow-hidden">
          <pre className="whitespace-pre-wrap break-words overflow-x-auto m-0
            font-mono text-[11px] text-white/45 selectable">{message.text}</pre>
          {time}
        </div>
      </div>
    );
  }

  // ── You → agent. Your voice. ──
  if (isUser) {
    return (
      <div className="px-4 py-1 flex justify-end">
        <div className={`max-w-[88%] rounded-2xl rounded-tr-sm px-3.5 py-2.5
          bg-indigo-600/40 text-white selectable overflow-hidden
          ${isStreaming ? 'opacity-60' : ''}`}>
          <pre className="whitespace-pre-wrap break-words m-0 text-sm selectable">{message.text}</pre>
          {time}
        </div>
      </div>
    );
  }

  // ── Agent → you. cli/text. Live stream = mono + pulse (raw terminal);
  //    a settled transcript turn = readable prose. ──
  const liveTerminal = isStreaming;
  return (
    <div className="px-4 py-1 flex justify-start">
      <div className={`rounded-2xl rounded-tl-sm px-3.5 py-2.5 selectable overflow-hidden
        ${liveTerminal
          ? 'w-full max-w-full bg-black/30 border border-white/5'
          : 'max-w-[92%] bg-white/[0.07] border border-white/5'}
        ${isStreaming ? 'opacity-70' : ''}`}>
        <pre className={`whitespace-pre-wrap break-words overflow-x-auto leading-relaxed m-0 selectable
          ${liveTerminal
            ? 'font-mono text-[11.5px] text-white/80'
            : 'text-sm text-white/90'}`}>
          {message.text}
          {isStreaming && <span className="animate-pulse">▋</span>}
        </pre>
        {time}
      </div>
    </div>
  );
});
