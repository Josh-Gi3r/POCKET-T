// Wire-visible shapes emitted by the daemon (server.ts publicView +
// adapters/Adapter.ts BubbleEvent). Kept in sync with those files.

export type BubbleKind =
  | 'chat'
  | 'thought'
  | 'action'
  | 'tool_result'
  | 'approval'
  | 'cost'
  | 'error';

export interface BubbleEvent {
  kind: BubbleKind;
  role?: 'user' | 'assistant';
  text?: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  toolUseId?: string;
  output?: string;
  approvalId?: string;
  options?: string[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  turnCostUSD?: number;
  cumulativeCostUSD?: number;
  timestamp?: number;
}

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  pid: number;
  rows: number;
  cols: number;
  shell: string;
  registeredAt: number;
  lastActiveAt: number;
  bytesIn: number;
  bytesOut: number;
  exitCode: number | null;
  vendor: string | null;
  detached: boolean;
  pendingApprovals: number;
}

// EVENT-frame JSON envelopes (server.ts broadcastEvent / sendWelcomeAndCatalog).
export type EventEnvelope =
  | { kind: 'sessionAdded'; session: SessionInfo }
  | { kind: 'sessionUpdated'; session: SessionInfo }
  | { kind: 'sessionRemoved'; sessionId: string }
  | { kind: 'bubble'; sessionId: string; event: BubbleEvent };

export interface CostState {
  cumulativeCostUSD?: number;
  model?: string;
}

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
