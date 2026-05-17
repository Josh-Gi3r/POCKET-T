import { io, type Socket } from 'socket.io-client';
import type { PtyHost } from '../pty/PtyHost.js';
import type { HookServer } from '../hooks/HookServer.js';
import type {
  RelayToDaemonEvents,
  DaemonEmitEvents,
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
  }> = [];

  constructor(
    private readonly relayUrl:   string,
    private readonly token:      string,
    private readonly host:       PtyHost,
    private readonly hookServer?: HookServer,
  ) {}

  connect() {
    this.socket = io(this.relayUrl, {
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

      // Announce all running sessions
      this.socket.emit('daemon:sessions', {
        sessions: this.host.allMeta(),
      });

      // Replay buffered chunks
      for (const c of this.chunkBuffer) {
        this.socket.emit('daemon:session:chunk', c);
      }
      this.chunkBuffer = [];
      console.log(`[relay] announced ${this.host.count()} sessions`);
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
        this.host.write(sessionId, text);
        this.host.clearWaiting(sessionId);
      } catch (e) {
        console.error('[relay] write error:', e);
      }
    });

    this.socket.on('relay:cmd:spawn', ({ name, cmd, cwd }) => {
      try {
        const session = this.host.spawn(name, cmd, cwd);
        this.socket.emit('daemon:session:update', {
          session: session.toMeta(this.host.daemonId, this.host.accountId),
        });
      } catch (e) {
        console.error('[relay] spawn error:', e);
      }
    });

    this.socket.on('relay:cmd:kill', ({ sessionId, signal }) => {
      this.host.kill(sessionId, signal);
    });

    this.socket.on('relay:cmd:attach', ({ sessionId }) => {
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

  emitChunk(sessionId: string, text: string, rawVt: string, seq: number) {
    const payload = { sessionId, text, rawVt, seq };
    if (!this.connected) {
      if (this.chunkBuffer.length < MAX_OFFLINE_BUFFER) {
        this.chunkBuffer.push(payload);
      }
      return;
    }
    this.socket.emit('daemon:session:chunk', payload);
  }

  emitChunkEncrypted(
    sessionId: string,
    encrypted: import('@pocket-t/shared').EncryptedChunk,
    seq:       number,
  ) {
    if (!this.connected) return;
    this.socket.emit('daemon:session:chunk:encrypted', { sessionId, encrypted, seq });
  }

  emitSessionUpdate(session: ReturnType<PtyHost['get']>) {
    if (!session || !this.connected) return;
    this.socket.emit('daemon:session:update', {
      session: session.toMeta(this.host.daemonId, this.host.accountId),
    });
  }

  emitApproval(
    sessionId: string,
    messageId: string,
    options:   import('@pocket-t/shared').ApprovalOption[],
  ) {
    if (!this.connected) return;
    this.socket.emit('daemon:session:approval', {
      sessionId,
      messageId,
      options,
    });
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
