// Adapter — turns a session's underlying agent output into typed
// "bubble events" that the browser can render as differentiated cards.
//
// The contract is intentionally vendor-agnostic. Each adapter watches
// whatever side-channel its agent CLI exposes (Claude's JSONL transcript,
// Codex's stream, OpenClaw's event log) and emits the same shape of
// BubbleEvent. The bubble UI on the browser is one renderer; new
// adapters just need to map their vendor's format into these events.

import type { EventEmitter } from 'node:events';

export type BubbleKind =
  | 'chat'         // user message or assistant message (full text)
  | 'thought'      // assistant thinking / internal monologue
  | 'action'       // tool invocation: name + parameters
  | 'tool_result'  // tool output
  | 'approval'     // tool-call needs user approval
  | 'cost'         // cumulative cost update for the session
  | 'error';

export interface BubbleEvent {
  kind:       BubbleKind;
  role?:      'user' | 'assistant';
  text?:      string;
  // action / tool_result
  tool?:        string;
  parameters?:  Record<string, unknown>;
  toolUseId?:   string;
  output?:      string;
  // approval
  approvalId?:  string;
  options?:     string[];
  // cost
  model?:                string;
  inputTokens?:          number;
  outputTokens?:         number;
  cacheReadTokens?:      number;
  cacheCreationTokens?:  number;
  turnCostUSD?:          number;
  cumulativeCostUSD?:    number;
  // shared
  timestamp?: number;
}

export interface Adapter extends EventEmitter {
  /** Vendor identifier ('claude', 'codex', 'openclaw', etc.) */
  readonly vendor: string;
  /** Begin watching. Returns false if this session can't be adapted
   *  (e.g. transcript file isn't present); caller falls back to
   *  terminal-only mode. */
  start(): boolean | Promise<boolean>;
  /** Tear down watchers + timers. Safe to call multiple times. */
  stop(): void;

  // Event API. The bubble-events stream is `event` for compatibility
  // with EventEmitter's typed-on overloads — adapter implementations
  // emit('event', BubbleEvent).
  on(event: 'event', cb: (ev: BubbleEvent) => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  emit(event: 'event', ev: BubbleEvent): boolean;
  emit(event: 'error', err: Error): boolean;
}
