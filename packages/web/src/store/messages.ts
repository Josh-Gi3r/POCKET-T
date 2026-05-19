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
  addTurn:        (sessionId: string, role: Message['role'], kind: Message['kind'], text: string, seq: number) => void;
  commitStreaming: (sessionId: string, seq: number) => void;
  addUserMessage: (sessionId: string, text: string) => void;
  addSnapshot:    (sessionId: string, text: string, rawVt?: string) => void;
}

function makeId() { return crypto.randomUUID(); }

export const useMessagesStore = create<MessagesStore>((set, get) => ({
  bySession:      {},
  streaming:      {},
  rawVtBySession: {},

  loadHistory: (sessionId, msgs) =>
    set((s) => ({
      bySession: { ...s.bySession, [sessionId]: msgs },
      rawVtBySession: {
        ...s.rawVtBySession,
        [sessionId]: msgs.map((m) => m.rawVt).filter(Boolean) as string[],
      },
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
      rawVtBySession: rawVt
        ? {
            ...s.rawVtBySession,
            [sessionId]: [...(s.rawVtBySession[sessionId] ?? []), rawVt],
          }
        : s.rawVtBySession,
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

  // A complete, typed agent turn (from the structured transcript) — its
  // own discrete bubble, never appended to the raw streaming buffer.
  addTurn: (sessionId, role, kind, text, seq) =>
    set((s) => {
      if (!text.trim()) return {};
      const list = s.bySession[sessionId] ?? [];
      // De-dupe: the daemon re-reads a fresh transcript from the top on
      // session switch, so the same (seq,text) can arrive twice.
      if (list.some((m) => m.seq === seq && m.text === text)) return {};
      const msg: Message = {
        id: makeId(), sessionId, role, kind, text,
        seq, createdAt: Date.now(),
      };
      return {
        bySession: { ...s.bySession, [sessionId]: [...list, msg] },
      };
    }),

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

  addSnapshot: (sessionId, text, rawVt) => {
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
        rawVtBySession: rawVt
          ? { ...s.rawVtBySession, [sessionId]: [rawVt] }
          : s.rawVtBySession,
      };
    });
  },
}));
