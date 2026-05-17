import type { Session, Message, ApprovalOption } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO requires function-shaped EventsMap interfaces.
// Every event is (payload: T) => void — NOT just T.
// This is what gives compile-time safety on socket.on() and socket.emit().
// ─────────────────────────────────────────────────────────────────────────────

// ─── Daemon → Relay ───────────────────────────────────────────────────────

export interface DaemonEmitEvents {
  'daemon:sessions':        (p: { sessions: Session[] }) => void;
  'daemon:session:update':  (p: { session: Partial<Session> & { id: string } }) => void;
  'daemon:session:chunk':   (p: { sessionId: string; text: string; rawVt: string; seq: number }) => void;
  'daemon:session:snapshot':(p: { sessionId: string; plainText: string; rawVt: string }) => void;
  'daemon:session:approval':(p: { sessionId: string; messageId: string; options: ApprovalOption[] }) => void;
  'daemon:session:exit':    (p: { sessionId: string; exitCode: number }) => void;
  // V2: encrypted transport
  'daemon:session:chunk:encrypted': (p: { sessionId: string; encrypted: EncryptedChunk; seq: number }) => void;
  // V2: hook approval from HookServer
  'daemon:hook:approval':   (p: { approvalId: string; sessionId: string; toolName: string; toolInput: string }) => void;
}

// ─── Relay → Daemon ───────────────────────────────────────────────────────

export interface RelayToDaemonEvents {
  'relay:cmd:input':         (p: { sessionId: string; text: string }) => void;
  'relay:cmd:spawn':         (p: { name: string; cmd: string; cwd: string }) => void;
  'relay:cmd:kill':          (p: { sessionId: string; signal?: string }) => void;
  'relay:cmd:attach':        (p: { sessionId: string }) => void;
  // V2: encrypted input
  'relay:cmd:input:encrypted':(p: { sessionId: string; encrypted: EncryptedChunk }) => void;
  // V2: hook approval resolution
  'relay:cmd:approveHook':   (p: { approvalId: string; decision: 'approve' | 'deny' }) => void;
}

// ─── Client → Relay ───────────────────────────────────────────────────────

export interface ClientEmitEvents {
  'client:session:attach':   (p: { sessionId: string; lastSeq?: number }) => void;
  'client:session:detach':   (p: { sessionId: string }) => void;
  'client:session:input':    (p: { sessionId: string; text: string }) => void;
  'client:approval:respond': (p: { sessionId: string; messageId: string; choice: string }) => void;
  'client:session:spawn':    (p: { name: string; cmd: string; cwd: string }) => void;
  'client:session:kill':     (p: { sessionId: string; signal?: string }) => void;
  'client:push:subscribe':   (p: { endpoint: string; p256dh: string; auth: string }) => void;
  // V2: encrypted input
  'client:session:input:encrypted': (p: { sessionId: string; encrypted: EncryptedChunk }) => void;
  // V2: hook approval from mobile user
  'client:hook:approve':     (p: { approvalId: string; sessionId: string; decision: 'approve' | 'deny' }) => void;
}

// ─── Relay → Client ───────────────────────────────────────────────────────

export interface RelayToClientEvents {
  'relay:sessions':             (p: { sessions: Session[] }) => void;
  'relay:session:update':       (p: { session: Partial<Session> & { id: string } }) => void;
  'relay:session:chunk':        (p: { sessionId: string; text: string; rawVt: string; seq: number }) => void;
  'relay:session:history':      (p: { sessionId: string; messages: Message[]; hasMore: boolean }) => void;
  'relay:session:snapshot':     (p: { sessionId: string; plainText: string; rawVt: string }) => void;
  'relay:daemon:status':        (p: { daemonId: string; online: boolean }) => void;
  'relay:error':                (p: { code: string; message: string }) => void;
  // V2: encrypted transport
  'relay:session:chunk:encrypted': (p: { sessionId: string; encrypted: EncryptedChunk; seq: number }) => void;
  // V2: hook approval request pushed to mobile
  'relay:hook:approval':        (p: { approvalId: string; sessionId: string; toolName: string; toolInput: string }) => void;
  // V2: team — broadcast who resolved an approval
  'relay:approval:resolved':    (p: { sessionId: string; messageId: string; choice: string; resolvedBy: string }) => void;
}

// ─── Shared payload types ─────────────────────────────────────────────────

// V2: E2E encrypted chunk — relay routes without decrypting
export interface EncryptedChunk {
  iv:   string;   // hex
  data: string;   // hex
  tag:  string;   // hex (GCM auth tag)
}
