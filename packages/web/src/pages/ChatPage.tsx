import {
  useEffect, useRef, useCallback, useState,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, Terminal as TerminalIcon, MessageSquare, X } from 'lucide-react';
import { useSessionsStore } from '../store/sessions.js';
import { useMessagesStore } from '../store/messages.js';
import { useLoadMore } from '../hooks/useLoadMore.js';
import { getSocket } from '../socket.js';
import { MessageBubble } from '../components/MessageBubble.js';
import { ApprovalBar } from '../components/ApprovalBar.js';
import { HookApprovalBar } from '../components/HookApprovalBar.js';
import { Composer } from '../components/Composer.js';
import { TerminalView } from '../components/TerminalView.js';
import { ConnectionBar } from '../components/ConnectionBar.js';
import type { Message } from '@pocket-t/shared';

export function ChatPage() {
  const { sessionId }     = useParams<{ sessionId: string }>();
  const navigate          = useNavigate();
  const session           = useSessionsStore(
    (s) => s.sessions.find((x) => x.id === sessionId)
  );
  const messages          = useMessagesStore((s) => s.bySession[sessionId!] ?? []);
  const streaming         = useMessagesStore((s) => s.streaming[sessionId!] ?? '');
  const rawVts            = useMessagesStore((s) => s.rawVtBySession[sessionId!] ?? []);
  const addUserMessage    = useMessagesStore((s) => s.addUserMessage);
  const { hasMore, loading, loadMore } = useLoadMore(sessionId!);

  const parentRef    = useRef<HTMLDivElement>(null);
  const atBottomRef  = useRef(true);
  const [showJump, setShowJump]   = useState(false);
  const [viewMode, setViewMode]   = useState<'chat' | 'terminal'>('chat');
  const [confirmKill, setConfirmKill] = useState(false);
  const terminalAvailable = rawVts.some(Boolean);

  const allMessages: Message[] = streaming
    ? [...messages, {
        id: '__streaming__', sessionId: sessionId!, role: 'cli', kind: 'text',
        text: streaming, seq: Date.now(), createdAt: Date.now(),
      } as Message]
    : messages;

  const virtualizer = useVirtualizer({
    count:          allMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize:   () => 80,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan:       8,
    getItemKey:     (i) => allMessages[i]?.id ?? i,
  });

  // Follow output live. Keying only on message COUNT meant the view never
  // moved while a chunk streamed (the synthetic streaming bubble grows but
  // the count is unchanged) — output scrolled off and the screen looked
  // frozen. Depend on the streaming text too so it tracks growth.
  useEffect(() => {
    if (atBottomRef.current && allMessages.length > 0) {
      virtualizer.scrollToIndex(allMessages.length - 1, {
        align: 'end', behavior: 'smooth',
      });
    }
  }, [allMessages.length, streaming]);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 100;
    setShowJump(dist > 200);
    if (el.scrollTop < 100 && hasMore && !loading) loadMore();
  }, [hasMore, loading, loadMore]);

  useEffect(() => {
    if (!sessionId) return;
    getSocket().emit('client:session:attach', { sessionId });
    return () => { getSocket().emit('client:session:detach', { sessionId }); };
  }, [sessionId]);

  useEffect(() => {
    setViewMode('chat');
  }, [sessionId]);

  useEffect(() => {
    if (!terminalAvailable && viewMode === 'terminal') setViewMode('chat');
  }, [terminalAvailable, viewMode]);

  function send(text: string) {
    if (!sessionId || !text.trim()) return;
    addUserMessage(sessionId, text);
    getSocket().emit('client:session:input', { sessionId, text });
  }

  function handleApproval(choice: string, messageId: string) {
    if (!sessionId) return;
    getSocket().emit('client:approval:respond', { sessionId, messageId, choice });
  }

  const pendingApproval = [...messages].reverse().find(
    (m) => m.kind === 'approval' &&
      m.approvalPending &&
      Array.isArray(m.approvalOptions) &&
      m.approvalOptions.length > 0
  );

  const statusColor: Record<string, string> = {
    running: 'text-emerald-400',
    waiting: 'text-amber-400',
    idle:    'text-white/30',
    dead:    'text-red-400',
  };

  return (
    <div className="flex flex-col app-h bg-surface">
      {/* Header */}
      <header className="relative z-10 flex items-center gap-2 px-2 pt-safe pb-2 pt-2 border-b border-white/8 flex-shrink-0 bg-surface">
        <button
          onClick={() => navigate(-1)}
          className="tap flex items-center justify-center text-white/40 hover:text-white/70"
          aria-label="Back"
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-white truncate">
              {session?.name ?? '…'}
            </span>
            <span className={`text-[10px] font-medium ${statusColor[session?.status ?? 'idle']}`}>
              {session?.status ?? '…'}
            </span>
          </div>
          <p className="text-[10px] text-white/30 font-mono truncate">
            {session?.cwd} · {session?.cmd}
          </p>
        </div>

        {terminalAvailable && (
          <button
            onClick={() => {
              setViewMode(v => v === 'chat' ? 'terminal' : 'chat');
            }}
            className="tap flex items-center justify-center text-white/30 hover:text-white/60 transition-colors"
            title={viewMode === 'chat' ? 'Switch to terminal' : 'Switch to chat'}
          >
            {viewMode === 'chat'
              ? <TerminalIcon size={18} />
              : <MessageSquare size={18} />}
          </button>
        )}

        <button
          onClick={() => setConfirmKill(true)}
          className="tap flex items-center justify-center text-white/25 hover:text-red-400 transition-colors"
          aria-label="Kill session"
        >
          <X size={18} />
        </button>
      </header>

      <ConnectionBar />

      {/* In-app kill confirmation (replaces the native window.confirm,
          which is blocking and unreliable in a standalone PWA) */}
      {confirmKill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-8"
          onClick={() => setConfirmKill(false)}
        >
          <div
            className="w-full max-w-xs bg-surface-overlay border border-white/10 rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-white/90 font-medium mb-1">Kill this session?</p>
            <p className="text-xs text-white/40 mb-4">
              The terminal process will be terminated.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmKill(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-white/70 bg-white/5 active:scale-95 transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (sessionId) getSocket().emit('client:session:kill', { sessionId });
                  setConfirmKill(false);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 active:scale-95 transition-transform"
              >
                Kill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {viewMode === 'terminal' && terminalAvailable ? (
        <TerminalView
          session={session!}
          rawVts={rawVts}
          onInput={send}
        />
      ) : (
        <div className="flex-1 relative min-h-0">
          {/* Message list */}
          <div
            ref={parentRef}
            className="absolute inset-0 overflow-y-auto overscroll-contain"
            onScroll={handleScroll}
            style={{ overscrollBehavior: 'contain', touchAction: 'pan-y' }}
          >
            {loading && (
              <div className="text-center py-3 text-white/20 text-xs">
                Loading…
              </div>
            )}

            <div style={{
              height:   virtualizer.getTotalSize(),
              position: 'relative',
            }}>
              {virtualizer.getVirtualItems().map((vItem) => {
                const msg = allMessages[vItem.index];
                if (!msg) return null;
                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position:  'absolute',
                      top: 0, left: 0, width: '100%',
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    <MessageBubble
                      message={msg}
                      isStreaming={msg.id === '__streaming__'}
                      onApprove={handleApproval}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {showJump && (
            <button
              onClick={() =>
                virtualizer.scrollToIndex(allMessages.length - 1, {
                  align: 'end', behavior: 'smooth',
                })
              }
              className="absolute bottom-4 right-4 bg-indigo-600/90 text-white text-xs
                         px-3 py-2 rounded-full shadow-lg active:scale-95 transition-transform"
            >
              ↓ Latest
            </button>
          )}
        </div>
      )}

      {/* Approval bar */}
      {pendingApproval && viewMode === 'chat' && (
        <ApprovalBar message={pendingApproval} onRespond={handleApproval} />
      )}

      {/* V2: blocking tool approval bar */}
      {viewMode === 'chat' && sessionId && (
        <HookApprovalBar sessionId={sessionId} />
      )}

      {/* Composer */}
      <Composer
        onSend={send}
        disabled={session?.status === 'dead'}
        placeholder={
          session?.status === 'dead' ? 'Session ended' : 'Type a message…'
        }
      />
    </div>
  );
}
