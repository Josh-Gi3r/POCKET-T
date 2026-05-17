// ─── Session ──────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'running'   // actively producing output
  | 'waiting'   // paused, awaiting user input or approval
  | 'idle'      // quiet for >500ms, still alive
  | 'dead';     // process exited

export type MessageRole =
  | 'cli'       // output from the terminal process
  | 'user'      // input from the user
  | 'system';   // pocket-t system messages (session start/end, etc.)

export type MessageKind =
  | 'text'        // plain output or input
  | 'approval'    // approval prompt with options
  | 'error'       // stderr / exit code
  | 'tool-call'   // detected tool invocation (Claude Code, Aider, etc.)
  | 'tool-result' // result of a tool call
  | 'diff'        // file diff output
  | 'info';       // system information

export type Plan = 'free' | 'pro';

export interface Session {
  id:            string;
  daemonId:      string;
  accountId:     string;
  name:          string;       // display name (process name or user-set)
  cmd:           string;       // full command string
  cwd:           string;       // working directory
  status:        SessionStatus;
  lastOutput:    string;       // preview (last ~120 chars of normalized output)
  lastActiveAt:  number;       // unix ms
  seq:           number;       // monotonic message sequence number
  pid?:          number;       // PTY process ID
}

// ─── Message ──────────────────────────────────────────────────────────────

export interface Message {
  id:               string;
  sessionId:        string;
  role:             MessageRole;
  kind:             MessageKind;
  text:             string;
  rawVt?:           string;           // base64 raw VT bytes (for xterm.js replay)
  seq:              number;
  createdAt:        number;           // unix ms
  approvalOptions?: ApprovalOption[];
  approvalPending?: boolean;
  approvalChoice?:  string;
}

export interface ApprovalOption {
  key:     string;                    // text to send to stdin when chosen
  label:   string;                    // display label
  variant: 'primary' | 'danger' | 'secondary';
}

// ─── Daemon ───────────────────────────────────────────────────────────────

export interface Daemon {
  id:          string;
  accountId:   string;
  name:        string;
  hostname:    string;
  lastSeenAt:  number;
  online:      boolean;
}

// ─── Account / User ───────────────────────────────────────────────────────

export interface Account {
  id:    string;
  email: string;
  plan:  Plan;
}

export interface User {
  id:        string;
  accountId: string;
  email:     string;
}

// ─── Plan limits ──────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<Plan, {
  daemons:         number;
  sessions:        number;
  historyDays:     number;
}> = {
  free: { daemons: 1,  sessions: 10,  historyDays: 7  },
  pro:  { daemons: 10, sessions: 100, historyDays: 90 },
};
