import { randomUUID } from 'node:crypto';
import {
  Session,
  type ChunkEvent,
  type EncryptedChunkEvent,
  type ApprovalEvent,
  type ExitEvent,
} from './Session.js';
import { MementoEngine } from '../memento/index.js';
import { KeyManager } from '../crypto/KeyManager.js';

export interface PtyHostCallbacks {
  onChunk:        (sessionId: string, ev: ChunkEvent) => void;
  onChunkEncrypted?: (sessionId: string, ev: EncryptedChunkEvent) => void;
  onStatusChange: (session: Session) => void;
  onApproval:     (sessionId: string, ev: ApprovalEvent) => void;
  onExit:         (sessionId: string, ev: ExitEvent) => void;
}

export class PtyHost {
  private sessions = new Map<string, Session>();

  constructor(
    readonly daemonId:  string,
    readonly accountId: string,
    private callbacks:  PtyHostCallbacks,
    private mementoRoot?: string,    // project cwd when --memento enabled
    private e2eEnabled = false,      // V2: encrypt PTY output before relay
  ) {}

  spawn(name: string, cmdStr: string, cwd: string): Session {
    const [bin, ...args] = cmdStr.trim().split(/\s+/);
    const id             = randomUUID();
    const effectiveCwd   = cwd || process.env.HOME || '/';

    const mementoEngine = this.mementoRoot
      ? new MementoEngine({ projectRoot: this.mementoRoot, sessionId: id })
      : undefined;

    const keyManager = this.e2eEnabled ? new KeyManager() : undefined;

    const session = new Session(
      id, name, bin, args, effectiveCwd,
      mementoEngine, keyManager, this.e2eEnabled,
    );

    session.on('chunk',        (ev: ChunkEvent)   =>
      this.callbacks.onChunk(session.id, ev));

    session.on('chunkEncrypted', (ev: EncryptedChunkEvent) =>
      this.callbacks.onChunkEncrypted?.(session.id, ev));

    session.on('statusChange', () =>
      this.callbacks.onStatusChange(session));

    session.on('approval',     (ev: ApprovalEvent) =>
      this.callbacks.onApproval(session.id, ev));

    session.on('exit',         (ev: ExitEvent)     => {
      this.sessions.delete(session.id);
      this.callbacks.onExit(session.id, ev);
    });

    this.sessions.set(id, session);
    console.log(`[pty] spawned ${name} (pid=${session.pid}, id=${id})`);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }

  allMeta(): ReturnType<Session['toMeta']>[] {
    return this.all().map((s) =>
      s.toMeta(this.daemonId, this.accountId));
  }

  write(sessionId: string, text: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session not found: ${sessionId}`);
    s.write(text);
  }

  kill(sessionId: string, signal?: string) {
    this.sessions.get(sessionId)?.kill(signal);
  }

  clearWaiting(sessionId: string) {
    this.sessions.get(sessionId)?.clearWaiting();
  }

  count(): number {
    return this.sessions.size;
  }
}
