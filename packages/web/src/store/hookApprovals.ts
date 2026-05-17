import { create } from 'zustand';
import { getSocket } from '../socket.js';

interface HookApproval {
  approvalId: string;
  sessionId:  string;
  toolName:   string;
  toolInput:  string;
  createdAt:  number;
}

interface HookApprovalStore {
  pending:     Map<string, HookApproval>;
  addPending:  (a: Omit<HookApproval, 'createdAt'>) => void;
  resolve:     (approvalId: string, decision: 'approve' | 'deny') => void;
}

export const useHookApprovalStore = create<HookApprovalStore>((set, get) => ({
  pending: new Map(),

  addPending: (a) => set((s) => {
    const next = new Map(s.pending);
    next.set(a.approvalId, { ...a, createdAt: Date.now() });
    return { pending: next };
  }),

  resolve: (approvalId, decision) => {
    const approval = get().pending.get(approvalId);
    if (!approval) return;
    set((s) => {
      const next = new Map(s.pending);
      next.delete(approvalId);
      return { pending: next };
    });
    getSocket().emit('client:hook:approve', {
      approvalId,
      sessionId: approval.sessionId,
      decision,
    });
  },
}));
