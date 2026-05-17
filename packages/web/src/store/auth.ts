import { create } from 'zustand';

interface AuthStore {
  accountId: string | null;
  email:     string | null;
  plan:      'free' | 'pro' | null;
  isLoading: boolean;
  setAuth:   (a: { accountId: string; email: string; plan: AuthStore['plan'] }) => void;
  clearAuth: () => void;
  setLoading:(v: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  accountId: null,
  email:     null,
  plan:      null,
  isLoading: true,
  setAuth:   ({ accountId, email, plan }) =>
    set({ accountId, email, plan, isLoading: false }),
  clearAuth: () =>
    set({ accountId: null, email: null, plan: null }),
  setLoading:(isLoading) => set({ isLoading }),
}));
