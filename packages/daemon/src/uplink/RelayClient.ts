import { io, type Socket } from 'socket.io-client';
import type { PtyHost } from '../pty/PtyHost.js';
import type { HookServer } from '../hooks/HookServer.js';
import type {
  RelayToDaemonEvents,
  DaemonEmitEvents,
  Session,
  ApprovalOption,
  EncryptedChunk,
} from '@pocket-t/shared';

const MAX_OFFLINE_BUFFER = 500; // max chunks to buffer while disconnected

export class RelayClient {
  private socket!: Socket<RelayToDaemonEvents, DaemonEmitEvents>;
  private connected    = false;
  private chunkBuffer: Array<{
    sessionId: string;
    text:      string;
    rawVt:     string;
    seq:       number;
    kind?:     import('@pocket-t/shared').MessageKind;
    role?:     import('@pocket-t/shared').MessageRole;
  }> = [];

  // Optional hooks — when set, take precedence over the built-in PtyHost
  // path so a TmuxHost (or anything else) can own input/spawn/kill/attach.
  onConnect?: () => void;
  onInput?:   (sessionId: string, text: string) => void | Promise<void>;
  onSpawn?:   (name: string, cmd: string, cwd: string) => void | Promise<void>;
  onKill?:    (sessionId: string, signal?: string) => void | Promise<void>;
  onAttach?:  (sessionId: string) => void | Promise<void>;

  constructor(
    private readonly relayUrl:   string,
    private readonly token:      string,
    private readonly host:       PtyHost,
    private readonly hookServer?: HookServer,
  ) {}

  connect() {
    // Connect to the /daemon namespace (the relay only handles /daemon and
    // /client — the bare relayUrl would land on the unhandled root ns).
    const nsUrl = this.relayUrl.replace(/\/+$/, '') + '/daemon';
    this.socket = io(nsUrl, {
      path:                  '/socket.io',
      auth:                  { token: this.token, type: 'daemon' },
      transports:            ['websocket'],
      reconnectionDelay:     1000,
      reconnectionDelayMax:  30_000,
      reconnectionAttempts:  Infinity,
    }) as unknown as Socket<RelayToDaemonEvents, DaemonEmitEvents>;

    this.socket.on('connect', () => {
      console.log('[relay] connected ✓');
      this.connected = true;

      // Announce any PtyHost-spawned sessions (usually none under tmux mode)
      this.socket.emit('daemon:sessions', { sessions: this.host.allMeta() });

      // Let the owner (e.g. TmuxHost) announce its sessions
      this.onConnect?.();

      // Replay buffered chunks
      for (const c of this.chunkBuffer) {
        this.socket.emit('daemon:session:chunk', c);
      }
      this.chunkBuffer = [];
    });

    this.socket.on('connect_error', (err) => {
      console.error('[relay] connect error:', err.message);
      this.connected = false;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[relay] disconnected:', reason);
      this.connected = false;
    });

    // ── Incoming commands from web clients ─────────────────────────

    this.socket.on('relay:cmd:input', ({ sessionId, text }) => {
      try {
        if (this.onInput) { void this.onInput(sessionId, text); return; }
        this.host.write(sessionId, text);
        this.host.clearWaiting(sessionId);
      } catch (e) {
        console.error('[relay] write error:', e);
      }
    });

    this.socket.on('relay:cmd:spawn', ({ name, cmd, cwd }) => {
      try {
        if (this.onSpawn) { void this.onSpawn(name, cmd, cwd); return; }
        const session = this.host.spawn(name, cmd, cwd);
        this.socket.emit('daemon:session:update', {
          session: session.toMeta(this.host.daemonId, this.host.accountId),
        });
      } catch (e) {
        console.error('[relay] spawn error:', e);
      }
    });

    this.socket.on('relay:cmd:kill', ({ sessionId, signal }) => {
      if (this.onKill) { void this.onKill(sessionId, signal); return; }
      this.host.kill(sessionId, signal);
    });

    this.socket.on('relay:cmd:attach', ({ sessionId }) => {
      if (this.onAttach) { void this.onAttach(sessionId); return; }
      const s = this.host.get(sessionId);
      if (!s) return;
      const snap = s.snapshot();
      this.socket.emit('daemon:session:snapshot', {
        sessionId,
        plainText: snap.plainText,
        rawVt:     snap.rawVt,
      });
    });

    // Handle approval resolution from mobile user
    this.socket.on('relay:cmd:approveHook', ({ approvalId, decision }) => {
      const resolved = this.hookServer?.resolveApproval(approvalId, decision);
      if (!resolved) {
        console.warn(`[relay] approval ${approvalId} not found (already resolved?)`);
      }
    });
  }

  emitChunk(
    sessionId: string, text: string, rawVt: string, seq: number,
    kind?: import('@pocket-t/shared').MessageKind,
    role?: import('@pocket-t/shared').MessageRole,
  ) {
    const payload = { sessionId, text, rawVt, seq, kind, role };
    if (!this.connected) {
      if (this.chunkBuffer.length < MAX_OFFLINE_BUFFER) {
        this.chunkBuffer.push(payload);
      }
      return;
    }
    this.socket.emit('daemon:session:chunk', payload);
  }

  emitChunkEncrypted(sessionId: string, encrypted: EncryptedChunk, seq: number) {
    if (!this.connected) return;
    this.socket.emit('daemon:session:chunk:encrypted', { sessionId, encrypted, seq });
  }

  // Accepts either a PtyHost Session instance (has toMeta) or a plain
  // Session object (TmuxHost) — both end up as a full Session payload.
  emitSessionUpdate(session: any) {
    if (!session || !this.connected) return;
    const meta: Session = typeof session.toMeta === 'function'
      ? session.toMeta(this.host.daemonId, this.host.accountId)
      : session;
    this.socket.emit('daemon:session:update', { session: meta });
  }

  emitAllSessions(sessions: Session[]) {
    if (!this.connected) return;
    this.socket.emit('daemon:sessions', { sessions });
  }

  emitSnapshot(sessionId: string, plainText: string, rawVt: string) {
    if (!this.connected) return;
    this.socket.emit('daemon:session:snapshot', { sessionId, plainText, rawVt });
  }

  emitApproval(sessionId: string, messageId: string, options: ApprovalOption[]) {
    if (!this.connected) return;
    this.socket.emit('daemon:session:approval', { sessionId, messageId, options });
  }

  emitExit(sessionId: string, exitCode: number) {
    if (!this.connected) return;
    this.socket.emit('daemon:session:exit', { sessionId, exitCode });
  }

  emitHookApproval(payload: {
    approvalId: string;
    sessionId:  string;
    toolName:   string;
    toolInput:  string;
  }) {
    if (!this.connected) return;
    this.socket.emit('daemon:hook:approval', payload);
  }

  isConnected() { return this.connected; }
}
