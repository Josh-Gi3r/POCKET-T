import { create } from 'zustand';

export type ToastKind = 'error' | 'info' | 'success';
export interface Toast { id: string; message: string; kind: ToastKind; }

export type ConnState = 'connected' | 'connecting' | 'disconnected';

interface UiStore {
  toasts:    Toast[];
  conn:      ConnState;
  pushToast: (message: string, kind?: ToastKind) => void;
  dismiss:   (id: string) => void;
  setConn:   (c: ConnState) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  toasts: [],
  conn:   'connecting',

  pushToast: (message, kind = 'info') => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setConn: (conn) => set({ conn }),
}));
