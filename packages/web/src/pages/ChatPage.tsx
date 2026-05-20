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

  const visibleMessages = isClaudeSession(session)
    ? messages.filter((m) => !isRawClaudeTerminalMessage(m))
    : messages;

  const allMessages: Message[] = streaming
    ? [...visibleMessages, {
        id: '__streaming__', sessionId: sessionId!, role: 'cli', kind: 'text',
        text: streaming, seq: Date.now(), createdAt: Date.now(),
      } as Message]
    : visibleMessages;

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
    running: 'text-emerald-600',
    waiting: 'text-amber-600',
    idle:    'text-slate-400',
    dead:    'text-red-500',
  };

  return (
    <div className="app-shell flex flex-col app-h">
      {/* Header */}
      <header className="glass-panel relative z-10 mx-3 mt-3 flex items-center gap-2 px-2 pt-safe pb-2 pt-2 rounded-[28px] flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="tap flex items-center justify-center text-slate-500 hover:text-violet-600"
          aria-label="Back"
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-900 truncate">
              {session?.name ?? '…'}
            </span>
            <span className={`text-[10px] font-medium ${statusColor[session?.status ?? 'idle']}`}>
              {session?.status ?? '…'}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono truncate">
            {session?.cwd} · {session?.cmd}
          </p>
        </div>

        {terminalAvailable && (
          <button
            onClick={() => {
              setViewMode(v => v === 'chat' ? 'terminal' : 'chat');
            }}
            className="tap flex items-center justify-center text-slate-500 hover:text-violet-600 transition-colors"
            title={viewMode === 'chat' ? 'Switch to terminal' : 'Switch to chat'}
          >
            {viewMode === 'chat'
              ? <TerminalIcon size={18} />
              : <MessageSquare size={18} />}
          </button>
        )}

        <button
          onClick={() => setConfirmKill(true)}
          className="tap flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-violet-950/35 backdrop-blur-md px-8"
          onClick={() => setConfirmKill(false)}
        >
          <div
            className="glass-panel w-full max-w-xs rounded-[28px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-slate-900 font-semibold mb-1">Kill this session?</p>
            <p className="text-xs text-slate-500 mb-4">
              The terminal process will be terminated.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmKill(false)}
                className="glass-card flex-1 py-2.5 rounded-2xl text-sm text-slate-600 active:scale-95 transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (sessionId) getSocket().emit('client:session:kill', { sessionId });
                  setConfirmKill(false);
                }}
                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold text-white bg-red-500 active:scale-95 transition-transform"
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
              <div className="text-center py-3 text-slate-400 text-xs">
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
              className="lavender-button absolute bottom-4 right-4 text-xs
                         px-3 py-2 rounded-full active:scale-95 transition-transform"
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

function isClaudeSession(session: ReturnType<typeof useSessionsStore.getState>['sessions'][number] | undefined): boolean {
  return session?.cmd.split(/\s+/)[0]?.split('/').pop() === 'claude';
}

function isRawClaudeTerminalMessage(message: Message): boolean {
  if (message.role !== 'cli') return false;
  if (message.kind === 'approval' && !message.approvalOptions?.length) return true;
  if (message.kind !== 'text') return false;
  if (message.rawVt) return true;
  const text = message.text;
  return text.includes('accept edits on') ||
    text.includes('claude.ai connector') ||
    text.includes('esc to interrupt') ||
    text.includes('shift+tab to cycle') ||
    text.includes('Finagling') ||
    text.includes('Crunched for') ||
    text.includes('Cogitated for') ||
    text.includes('Yes, I trust this folder') ||
    text.includes('No, exit');
}
