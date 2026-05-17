// Nightly consolidation. gbrain cycle.ts lock pattern.
// Phases: lock → prune → cross-session schema extract → decay → write → unlock

import {
  existsSync, readFileSync, writeFileSync, unlinkSync,
  readdirSync, statSync, mkdirSync,
} from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { DecayEngine } from './DecayEngine.js';
import { NohupMdWriter } from './NohupMdWriter.js';
import { EvidenceGate } from './EvidenceGate.js';
import { SpacedRepetition } from './SpacedRepetition.js';

void createHash;

const RETENTION_DAYS  = 30;
const SCHEMA_THRESHOLD = 3; // sessions before pattern → procedural schema

export interface DreamCycleResult {
  phasesCompleted: string[];
  sessionsPruned:  number;
  schemasExtracted: number;
  itemsDecayed:    number;
  itemsAtFloor:    number;
  durationMs:      number;
  error?:          string;
}

export class DreamCycle {
  private lockPath:    string;
  private sessionsDir: string;

  constructor(private projectRoot: string) {
    this.lockPath    = join(projectRoot, '.nohup', 'dream.lock');
    this.sessionsDir = join(projectRoot, '.nohup', 'sessions');
  }

  async run(): Promise<DreamCycleResult> {
    const start = Date.now();
    const result: DreamCycleResult = { phasesCompleted: [], sessionsPruned: 0,
      schemasExtracted: 0, itemsDecayed: 0, itemsAtFloor: 0, durationMs: 0 };

    if (!this.acquireLock()) {
      return { ...result, error: 'Dream cycle already running', durationMs: Date.now() - start };
    }

    try {
      result.phasesCompleted.push('lock');
      result.sessionsPruned    = this.pruneOldSessions();
      result.phasesCompleted.push('prune');
      result.schemasExtracted  = await this.extractSchemas();
      result.phasesCompleted.push('schema_extract');
      const ds = this.runDecayPass();
      result.itemsDecayed = ds.decayed; result.itemsAtFloor = ds.atFloor;
      result.phasesCompleted.push('decay');
      new NohupMdWriter(this.projectRoot).write();
      result.phasesCompleted.push('write');
      result.durationMs = Date.now() - start;
      console.log(`[dream] Complete in ${result.durationMs}ms`);
    } catch (err) {
      result.error = String(err);
    } finally {
      this.releaseLock();
    }
    return result;
  }

  private acquireLock(): boolean {
    if (!existsSync(this.lockPath)) { this.writeLock(); return true; }
    try {
      const { pid, timestamp } = JSON.parse(readFileSync(this.lockPath, 'utf-8'));
      if (Date.now() - new Date(timestamp).getTime() > 3_600_000) { this.writeLock(); return true; }
      try { process.kill(pid, 0); return false; } catch { this.writeLock(); return true; }
    } catch { this.writeLock(); return true; }
  }

  private writeLock(): void {
    const dir = join(this.projectRoot, '.nohup');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }));
  }

  private releaseLock(): void {
    try { if (existsSync(this.lockPath)) unlinkSync(this.lockPath); } catch { /* best effort */ }
  }

  private pruneOldSessions(): number {
    if (!existsSync(this.sessionsDir)) return 0;
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    let pruned = 0;
    for (const file of readdirSync(this.sessionsDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = join(this.sessionsDir, file);
      if (statSync(filePath).mtimeMs < cutoff) { unlinkSync(filePath); pruned++; }
    }
    return pruned;
  }

  private async extractSchemas(): Promise<number> {
    if (!existsSync(this.sessionsDir)) return 0;
    const gate   = new EvidenceGate(this.projectRoot);
    const writer = new NohupMdWriter(this.projectRoot);
    const counts = new Map<string, { count: number; sessions: Set<string>; examples: string[] }>();

    for (const file of readdirSync(this.sessionsDir).filter(f => f.endsWith('.jsonl'))) {
      try {
        const seen = new Set<string>();
        for (const line of readFileSync(join(this.sessionsDir, file), 'utf-8').split('\n').filter(Boolean)) {
          try {
            const event = JSON.parse(line);
            if ((event.salience ?? 0) < 0.5) continue;
            const key = gate.patternKey(event.raw ?? '', event.type ?? '');
            if (seen.has(key)) continue;
            seen.add(key);
            const ex = counts.get(key) ?? { count: 0, sessions: new Set(), examples: [] };
            ex.count++; ex.sessions.add(event.sessionId ?? file);
            if (ex.examples.length < 3) ex.examples.push(event.raw?.slice(0, 100) ?? '');
            counts.set(key, ex);
          } catch { /* malformed line */ }
        }
      } catch { /* unreadable */ }
    }

    let extracted = 0;
    for (const [key, data] of counts) {
      if (data.sessions.size >= SCHEMA_THRESHOLD) {
        const record = gate.getRecord(key) ?? {
          patternHash: key, count: data.count, firstSeen: '', lastSeen: new Date().toISOString(),
          type: 'pattern', examples: data.examples, promoted: true,
          retrievalCount: 0, lastRetrieved: null,
        };
        writer.addOrUpdateItem(
          record as any,
          `Cross-session schema: ${data.examples[0]?.slice(0, 80) ?? 'unknown'} (seen in ${data.sessions.size} sessions)`,
          'pattern', Math.min(0.6 + data.sessions.size * 0.1, 1.0), false,
        );
        extracted++;
      }
    }
    return extracted;
  }

  private runDecayPass(): { decayed: number; atFloor: number } {
    const writer = new NohupMdWriter(this.projectRoot);
    const gate   = new EvidenceGate(this.projectRoot);
    const sr     = new SpacedRepetition(this.projectRoot);
    const decay  = new DecayEngine();
    const items  = writer.getItems();
    const snSince = new Map<string, number>();
    const rCounts = new Map<string, number>();
    for (const item of items) {
      const r = gate.getRecord(item.id);
      if (r) {
        rCounts.set(item.id, r.retrievalCount);
        snSince.set(item.id, r.lastRetrieved
          ? Math.floor((Date.now() - new Date(r.lastRetrieved).getTime()) / 86_400_000)
          : sr.sessionNumber);
      }
    }
    const results = decay.computeDecay(items, snSince, rCounts);
    writer.applyDecayWeights(new Map(results.map(r => [r.id, r.newWeight])));
    return { decayed: results.filter(r => r.newWeight < r.oldWeight).length,
             atFloor: results.filter(r => r.shouldPrune).length };
  }
}
