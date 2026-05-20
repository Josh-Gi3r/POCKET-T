import { create } from 'zustand';
import type { Session } from '@pocket-t/shared';

interface SessionsStore {
  sessions:      Session[];
  daemonOnline:  Record<string, boolean>;
  setSessions:   (s: Session[]) => void;
  updateSession: (u: Partial<Session> & { id: string }) => void;
  setDaemonOnline: (daemonId: string, online: boolean) => void;
}

export const useSessionsStore = create<SessionsStore>((set) => ({
  sessions:    [],
  daemonOnline: {},

  setSessions: (sessions) => set({ sessions }),

  updateSession: (update) =>
    set((s) => ({
      sessions: update.status === 'dead'
        ? s.sessions.filter((x) => x.id !== update.id)
        : s.sessions.some((x) => x.id === update.id)
          ? s.sessions.map((x) =>
              x.id === update.id ? { ...x, ...update } : x
            )
          : isFullSession(update)
            ? [...s.sessions, update]
            : s.sessions,
    })),

  setDaemonOnline: (daemonId, online) =>
    set((s) => ({
      daemonOnline: { ...s.daemonOnline, [daemonId]: online },
    })),
}));

function isFullSession(s: Partial<Session> & { id: string }): s is Session {
  return typeof s.daemonId === 'string' &&
    typeof s.accountId === 'string' &&
    typeof s.name === 'string' &&
    typeof s.cmd === 'string' &&
    typeof s.cwd === 'string' &&
    typeof s.status === 'string' &&
    typeof s.lastOutput === 'string' &&
    typeof s.lastActiveAt === 'number' &&
    typeof s.seq === 'number';
}
