import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { join } from 'node:path';
import {
  Session,
  type ChunkEvent,
  type EncryptedChunkEvent,
  type ApprovalEvent,
  type ExitEvent,
} from './Session.js';
import { MementoEngine } from '../memento/index.js';
import { KeyManager } from '../crypto/KeyManager.js';
import { ClaudeTranscript, type Turn } from '../agent/ClaudeTranscript.js';

export interface PtyHostCallbacks {
  onChunk:        (sessionId: string, ev: ChunkEvent) => void;
  onChunkEncrypted?: (sessionId: string, ev: EncryptedChunkEvent) => void;
  onTurn?:        (sessionId: string, turn: Turn, seq: number) => void;
  onStatusChange: (session: Session) => void;
  onApproval:     (sessionId: string, ev: ApprovalEvent) => void;
  onExit:         (sessionId: string, ev: ExitEvent) => void;
}

export class PtyHost {
  private sessions = new Map<string, Session>();
  private transcripts = new Map<string, ClaudeTranscript>();
  private seqMap = new Map<string, number>();

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
    const effectiveCwd   = resolveCwd(cwd);

    const mementoEngine = this.mementoRoot
      ? new MementoEngine({ projectRoot: this.mementoRoot, sessionId: id })
      : undefined;

    const keyManager = this.e2eEnabled ? new KeyManager() : undefined;

    const session = new Session(
      id, name, bin, args, effectiveCwd,
      mementoEngine, keyManager, this.e2eEnabled,
    );

    const isClaude = bin.split(/[\\/]/).pop()?.toLowerCase() === 'claude';

    session.on('chunk',        (ev: ChunkEvent)   => {
      // Claude Code sessions get clean chat turns from the JSONL transcript.
      // Suppress the redrawing TUI stream once transcript mode is active.
      if (isClaude && this.transcripts.has(session.id)) return;
      this.callbacks.onChunk(session.id, ev);
    });

    session.on('chunkEncrypted', (ev: EncryptedChunkEvent) =>
      this.callbacks.onChunkEncrypted?.(session.id, ev));

    session.on('statusChange', () =>
      this.callbacks.onStatusChange(session));

    session.on('approval',     (ev: ApprovalEvent) =>
      this.callbacks.onApproval(session.id, ev));

    session.on('exit',         (ev: ExitEvent)     => {
      this.sessions.delete(session.id);
      this.transcripts.get(session.id)?.stop();
      this.transcripts.delete(session.id);
      this.seqMap.delete(session.id);
      this.callbacks.onExit(session.id, ev);
    });

    this.sessions.set(id, session);
    if (isClaude) this.attachClaudeTranscript(session);
    console.log(`[pty] spawned ${name} (pid=${session.pid}, id=${id})`);
    return session;
  }

  private attachClaudeTranscript(session: Session, attempts = 0): void {
    if (!this.sessions.has(session.id) || this.transcripts.has(session.id)) return;

    const transcript = new ClaudeTranscript(session.cwd, session.startedAt - 2000);
    if (!transcript.start()) {
      if (attempts < 20) {
        setTimeout(() => this.attachClaudeTranscript(session, attempts + 1), 1000);
      }
      return;
    }

    transcript.on('turn', (turn: Turn) => {
      const seq = (this.seqMap.get(session.id) ?? 0) + 1;
      this.seqMap.set(session.id, seq);
      this.callbacks.onTurn?.(session.id, turn, seq);
    });
    transcript.on('error', (e: Error) =>
      console.error(`[pty] Claude transcript error [${session.id}]:`, e.message));
    this.transcripts.set(session.id, transcript);
    console.log(`[pty] Claude transcript mode: ${session.id}`);
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

function resolveCwd(cwd: string): string {
  const home = os.homedir() || process.env.HOME || '/';
  const raw = (cwd || home).trim();
  if (!raw || raw === '~') return home;
  if (raw.startsWith('~/')) return join(home, raw.slice(2));
  return raw;
}
