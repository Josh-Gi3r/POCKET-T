// Leitner box model. Proactive resurfacing BEFORE retrieval fails.
// Nobody else ships this. Every current system waits for failure first.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { CompiledTruthItem } from './NohupMdWriter.js';

export interface LeitnerRecord {
  id:                    string;
  box:                   number;  // 1–5
  nextSurfaceSession:    number;
  intervalSessions:      number;
  consecutiveSuccesses:  number;
}

const BOX_INTERVALS: Record<number, number> = { 1:1, 2:2, 3:4, 4:8, 5:16 };

export class SpacedRepetition {
  private records        = new Map<string, LeitnerRecord>();
  private persistPath:   string;
  private _sessionNumber = 0;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, '.nohup', 'brain');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.persistPath = join(dir, 'spaced-repetition.json');
    this.load();
  }

  startSession(): void { this._sessionNumber++; this.save(); }

  getDueItems(compiledItems: CompiledTruthItem[]): CompiledTruthItem[] {
    const dueIds = new Set<string>();
    for (const r of this.records.values()) {
      if (this._sessionNumber >= r.nextSurfaceSession) dueIds.add(r.id);
    }
    for (const item of compiledItems) {
      if (!this.records.has(item.id) && item.weight >= 0.7) {
        this.enroll(item); dueIds.add(item.id);
      }
    }
    return compiledItems.filter(i => dueIds.has(i.id));
  }

  enroll(item: CompiledTruthItem): void {
    if (this.records.has(item.id)) return;
    const box = item.weight >= 0.85 ? 2 : 1;
    this.records.set(item.id, { id: item.id, box,
      nextSurfaceSession: this._sessionNumber + BOX_INTERVALS[box],
      intervalSessions: BOX_INTERVALS[box], consecutiveSuccesses: 0 });
    this.save();
  }

  onSuccess(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.consecutiveSuccesses++;
    r.box = Math.min(r.box + 1, 5);
    r.intervalSessions = BOX_INTERVALS[r.box];
    r.nextSurfaceSession = this._sessionNumber + r.intervalSessions;
    this.save();
  }

  onFailure(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.consecutiveSuccesses = 0;
    r.box = 1;
    r.intervalSessions = BOX_INTERVALS[1];
    r.nextSurfaceSession = this._sessionNumber + 1;
    this.save();
  }

  get sessionNumber(): number { return this._sessionNumber; }

  private save(): void {
    try { writeFileSync(this.persistPath, JSON.stringify({ currentSession: this._sessionNumber, records: Array.from(this.records.values()) }, null, 2), 'utf-8'); }
    catch (err) { console.error('[memento] SpacedRepetition save failed:', err); }
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const d = JSON.parse(readFileSync(this.persistPath, 'utf-8'));
      this._sessionNumber = d.currentSession ?? 0;
      for (const r of (d.records ?? []) as LeitnerRecord[]) this.records.set(r.id, r);
    } catch (err) { console.error('[memento] SpacedRepetition load failed:', err); }
  }
}
