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
      sessions: s.sessions.map((x) =>
        x.id === update.id ? { ...x, ...update } : x
      ),
    })),

  setDaemonOnline: (daemonId, online) =>
    set((s) => ({
      daemonOnline: { ...s.daemonOnline, [daemonId]: online },
    })),
}));
