import { create } from 'zustand';
import type { Message } from '@pocket-t/shared';

const DEBOUNCE_MS = 500;
const timers: Record<string, ReturnType<typeof setTimeout>> = {};

interface MessagesStore {
  bySession:      Record<string, Message[]>;
  streaming:      Record<string, string>;
  rawVtBySession: Record<string, string[]>;  // for xterm.js replay

  loadHistory:    (sessionId: string, msgs: Message[]) => void;
  prependHistory: (sessionId: string, msgs: Message[]) => void;
  addChunk:       (sessionId: string, text: string, rawVt: string, seq: number) => void;
  commitStreaming: (sessionId: string, seq: number) => void;
  addUserMessage: (sessionId: string, text: string) => void;
  addSnapshot:    (sessionId: string, text: string) => void;
}

function makeId() { return crypto.randomUUID(); }

export const useMessagesStore = create<MessagesStore>((set, get) => ({
  bySession:      {},
  streaming:      {},
  rawVtBySession: {},

  loadHistory: (sessionId, msgs) =>
    set((s) => ({
      bySession: { ...s.bySession, [sessionId]: msgs },
    })),

  prependHistory: (sessionId, older) =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: [...older, ...(s.bySession[sessionId] ?? [])],
      },
    })),

  addChunk: (sessionId, text, rawVt, seq) => {
    set((s) => ({
      streaming:      { ...s.streaming, [sessionId]: (s.streaming[sessionId] ?? '') + text },
      rawVtBySession: {
        ...s.rawVtBySession,
        [sessionId]: [...(s.rawVtBySession[sessionId] ?? []), rawVt],
      },
    }));

    clearTimeout(timers[sessionId]);
    timers[sessionId] = setTimeout(
      () => get().commitStreaming(sessionId, seq),
      DEBOUNCE_MS,
    );
  },

  commitStreaming: (sessionId, seq) => {
    set((s) => {
      const text = s.streaming[sessionId];
      if (!text?.trim()) return {};
      const msg: Message = {
        id:        makeId(),
        sessionId,
        role:      'cli',
        kind:      'text',
        text,
        seq,
        createdAt: Date.now(),
      };
      return {
        streaming: { ...s.streaming, [sessionId]: '' },
        bySession: {
          ...s.bySession,
          [sessionId]: [...(s.bySession[sessionId] ?? []), msg],
        },
      };
    });
  },

  addUserMessage: (sessionId, text) =>
    set((s) => {
      const msg: Message = {
        id: makeId(), sessionId, role: 'user', kind: 'text',
        text, seq: Date.now(), createdAt: Date.now(),
      };
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: [...(s.bySession[sessionId] ?? []), msg],
        },
      };
    }),

  addSnapshot: (sessionId, text) => {
    if (!text.trim()) return;
    set((s) => {
      if ((s.bySession[sessionId] ?? []).length > 0) return {};
      const msg: Message = {
        id: makeId(), sessionId, role: 'system', kind: 'info',
        text: `── Current screen ──\n${text}\n── Live output below ──`,
        seq: Date.now() - 1, createdAt: Date.now() - 1,
      };
      return {
        bySession: { ...s.bySession, [sessionId]: [msg] },
      };
    });
  },
}));
