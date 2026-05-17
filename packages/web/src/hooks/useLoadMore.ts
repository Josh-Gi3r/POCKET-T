import { useState, useCallback } from 'react';
import { useMessagesStore } from '../store/messages.js';
import type { Message } from '@pocket-t/shared';

export function useLoadMore(sessionId: string) {
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const messages    = useMessagesStore((s) => s.bySession[sessionId] ?? []);
  const prependHistory = useMessagesStore((s) => s.prependHistory);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    const oldestSeq = messages[0]?.seq;
    if (!oldestSeq) return;

    setLoading(true);
    try {
      const res  = await fetch(
        `/api/sessions/${sessionId}/messages?before=${oldestSeq}&limit=100`,
        { credentials: 'include' },
      );
      const data = await res.json() as { messages: Message[]; hasMore: boolean };
      prependHistory(sessionId, data.messages);
      setHasMore(data.hasMore);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [sessionId, messages, loading, hasMore]);

  return { hasMore, loading, loadMore };
}
