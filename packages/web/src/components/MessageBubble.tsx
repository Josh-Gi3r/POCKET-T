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
        <span className="glass-card text-[10px] text-slate-500 px-2 py-0.5 rounded-full">
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
        <div className="glass-card rounded-[24px] p-3 max-w-[90%]">
          <p className="text-[10px] text-amber-700 font-semibold mb-2 uppercase tracking-wide">
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
                      ? 'bg-emerald-100/80 text-emerald-700 hover:bg-emerald-100'
                      : opt.variant === 'danger'
                      ? 'bg-red-100/80 text-red-700 hover:bg-red-100'
                      : 'bg-white/60 text-slate-600 hover:bg-white/80'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">→ {message.approvalChoice}</p>
          )}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';
  const time = !isStreaming && (
    <time className="text-[10px] text-slate-400/70 block text-right mt-1 select-none">
      {new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      })}
    </time>
  );

  // ── Agent ACTION — a tool call. Visually "doing", not "talking". ──
  if (message.kind === 'tool-call') {
    return (
      <div className="px-4 py-1 flex justify-start">
        <div className="glass-card max-w-[92%] rounded-[22px] rounded-tl-md px-3 py-2 selectable overflow-hidden">
          <div className="flex items-center gap-2 text-[10px] font-semibold
            uppercase tracking-wide text-violet-700 mb-1">
            <span>⏵</span><span>Action</span>
          </div>
          <pre className="whitespace-pre-wrap break-words overflow-x-auto m-0
            font-mono text-[11.5px] text-violet-950/80 selectable">{message.text}</pre>
          {time}
        </div>
      </div>
    );
  }

  // ── Tool result / diff / error — secondary, muted. ──
  if (message.kind === 'tool-result' || message.kind === 'diff' || message.kind === 'error') {
    return (
      <div className="px-4 py-1 flex justify-start">
        <div className="glass-card max-w-[92%] rounded-[22px] rounded-tl-md px-3 py-2 selectable overflow-hidden">
          <pre className="whitespace-pre-wrap break-words overflow-x-auto m-0
            font-mono text-[11px] text-slate-500 selectable">{message.text}</pre>
          {time}
        </div>
      </div>
    );
  }

  // ── You → agent. Your voice. ──
  if (isUser) {
    return (
      <div className="px-4 py-1 flex justify-end">
        <div className={`max-w-[88%] rounded-[24px] rounded-tr-md px-3.5 py-2.5
          lavender-button selectable overflow-hidden
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
      <div className={`rounded-[24px] rounded-tl-md px-3.5 py-2.5 selectable overflow-hidden
        ${liveTerminal
          ? 'w-full max-w-full bg-slate-950/82 border border-white/30 shadow-xl'
          : 'glass-card max-w-[92%]'}
        ${isStreaming ? 'opacity-70' : ''}`}>
        <pre className={`whitespace-pre-wrap break-words overflow-x-auto leading-relaxed m-0 selectable
          ${liveTerminal
            ? 'font-mono text-[11.5px] text-white/88'
            : 'text-sm text-slate-800'}`}>
          {message.text}
          {isStreaming && <span className="animate-pulse">▋</span>}
        </pre>
        {time}
      </div>
    </div>
  );
});
