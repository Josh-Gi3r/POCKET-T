import { createHash } from 'crypto';

export type EventType =
  | 'tool_call_result'
  | 'user_constraint'
  | 'approval_request'
  | 'agent_reasoning'
  | 'error_output'
  | 'shell_output'
  | 'log_noise';

export interface TaggedEvent {
  id:        string;
  type:      EventType;
  salience:  number;
  timestamp: string;
  raw:       string;
  sessionId: string;
}

export const SALIENCE_MAP: Record<EventType, number> = {
  tool_call_result:  1.0,
  user_constraint:   0.9,
  approval_request:  0.85,
  agent_reasoning:   0.7,
  error_output:      0.6,
  shell_output:      0.4,
  log_noise:         0.2,
};

const TYPE_PATTERNS: Array<{ type: EventType; pattern: RegExp }> = [
  { type: 'tool_call_result', pattern: /^(✓|✗|Tool result:|<result>|<tool_response>)/ },
  { type: 'tool_call_result', pattern: /^\[tool_use\]|\[tool_result\]/ },
  { type: 'approval_request', pattern: /\?\s*(Approve|Allow|Deny|y\/n|yes\/no)/i },
  { type: 'approval_request', pattern: /^>\s*(Approve|Allow)\s/i },
  { type: 'user_constraint',  pattern: /\b(never|always|don't|do not|stop|must not|must)\b.*\b(file|dir|folder|branch|commit|push|delete|modify|touch)\b/i },
  { type: 'user_constraint',  pattern: /^(No\.|Stop\.|Don't\.|Never\.|Wait\.)/i },
  { type: 'agent_reasoning',  pattern: /^(Thinking|Planning|Analyzing|Let me|I'll|I will|I should|I need to)\b/i },
  { type: 'agent_reasoning',  pattern: /^(Based on|Looking at|I see|I notice|I understand)\b/i },
  { type: 'error_output',     pattern: /^(Error:|TypeError:|SyntaxError:|ENOENT|EACCES|EPERM|ECONNREFUSED)/i },
  { type: 'error_output',     pattern: /\b(failed|failure|exception|crash|abort|killed)\b/i },
  { type: 'error_output',     pattern: /exit\s+code?\s+[1-9]\d*/i },
  { type: 'error_output',     pattern: /^✗\s/ },
  { type: 'shell_output',     pattern: /^\$\s|^#\s/ },
  { type: 'shell_output',     pattern: /^(npm|bun|yarn|pnpm|git|docker|kubectl|python|node)\s/i },
];

const SNAPSHOT_BOUNDARY_PATTERNS: RegExp[] = [
  /✓\s+Task complete/i,
  /\?\s*(Approve|Allow)\s/i,
  /exit\s+code?\s+0/i,
  /^Session ended/i,
  /^Done\.|^Complete\.|^Finished\./i,
];

export function tagEvent(rawLine: string, sessionId: string, ts: Date = new Date()): TaggedEvent {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return { id: generateId(rawLine + ts.toISOString()), type: 'log_noise',
             salience: SALIENCE_MAP.log_noise, timestamp: ts.toISOString(),
             raw: rawLine.slice(0, 500), sessionId };
  }
  let type: EventType = 'log_noise';
  for (const { type: t, pattern } of TYPE_PATTERNS) {
    if (pattern.test(trimmed)) { type = t; break; }
  }
  return { id: generateId(rawLine + ts.toISOString()), type,
           salience: SALIENCE_MAP[type], timestamp: ts.toISOString(),
           raw: rawLine.slice(0, 500), sessionId };
}

export function isSnapshotBoundary(rawLine: string): boolean {
  return SNAPSHOT_BOUNDARY_PATTERNS.some(p => p.test(rawLine.trim()));
}

export function escalateSalience(base: number, repeatCount: number): number {
  if (repeatCount <= 1) return base;
  if (repeatCount === 2) return Math.min(base * 1.3, 0.85);
  return 1.0;
}

export function generateId(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}
