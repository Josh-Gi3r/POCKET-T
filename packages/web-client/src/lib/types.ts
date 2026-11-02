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
  | { kind: 'bubble'; sessionId: string; event: BubbleEvent }
  | { kind: 'existingTerminals'; sessions: ExistingTerminal[] }
  | { kind: 'joinExistingTmuxResult'; requestId: string; ok: boolean; joinedSessionId?: string; message?: string }
  | { kind: 'fileRoots'; roots: FileRoot[] }
  | { kind: 'fileListing'; requestId: string; listing: DirectoryListing }
  | { kind: 'fileBrowseError'; requestId: string; message: string }
  | { kind: 'approvedApps'; apps: ApprovedApp[] }
  | { kind: 'appLaunchResult'; requestId: string; ok: boolean; message: string };

export interface ExistingTerminal {
  sessionId: string;
  source: 'tmux' | 'terminal' | 'iterm2';
  title: string;
  cwd: string;
  tty?: string;
  pane?: string;
  tmuxSession?: string;
  capabilities: Array<'discover' | 'join'>; // join requires a verified existing tmux session
}

export interface FileRoot {
  id: string;
  label: string;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  size: number | null;
  modifiedAt: number | null;
}

export interface DirectoryListing {
  rootId: string;
  relativePath: string;
  entries: FileEntry[];
  truncated: boolean;
}

export interface ApprovedApp {
  name: string;
  bundleId: string;
}

export interface AppLaunchResult {
  requestId: string;
  ok: boolean;
  message: string;
}

export interface FileState {
  requestId: string;
  loading: boolean;
  listing: DirectoryListing | null;
  error: string | null;
}

export interface CostState {
  cumulativeCostUSD?: number;
  model?: string;
}

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
