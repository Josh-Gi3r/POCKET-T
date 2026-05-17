import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { TaggedEvent } from './EventTagger.js';

export interface EvidenceRecord {
  patternHash:    string;
  count:          number;
  firstSeen:      string;
  lastSeen:       string;
  type:           string;
  examples:       string[];
  promoted:       boolean;
  retrievalCount: number;        // V2: tracks successful retrievals
  lastRetrieved:  string | null; // V2: for spaced repetition
}

const MIN_CORROBORATION = 2;
const MIN_SALIENCE      = 0.5;

export class EvidenceGate {
  private records     = new Map<string, EvidenceRecord>();
  private persistPath: string;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, '.nohup', 'brain');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.persistPath = join(dir, 'evidence.json');
    this.load();
  }

  observe(event: TaggedEvent): boolean {
    if (event.salience < MIN_SALIENCE) return false;
    const key      = this.patternKey(event.raw, event.type);
    const existing = this.records.get(key);

    if (!existing) {
      this.records.set(key, { patternHash: key, count: 1, firstSeen: event.timestamp,
        lastSeen: event.timestamp, type: event.type, examples: [event.raw.slice(0, 120)],
        promoted: false, retrievalCount: 0, lastRetrieved: null });
      this.save(); return false;
    }

    existing.count++;
    existing.lastSeen = event.timestamp;
    if (existing.examples.length < 3) existing.examples.push(event.raw.slice(0, 120));

    const crossed = existing.count >= MIN_CORROBORATION && !existing.promoted;
    if (crossed) existing.promoted = true;
    this.save();
    return crossed;
  }

  recordRetrieval(patternHash: string): void {
    const r = this.records.get(patternHash);
    if (r) { r.retrievalCount++; r.lastRetrieved = new Date().toISOString(); this.save(); }
  }

  recordRetrievalFailure(_patternHash: string): void {
    // Future: can boost salience here; for now just a hook
    this.save();
  }

  getRecord(patternHash: string): EvidenceRecord | undefined { return this.records.get(patternHash); }
  markPromoted(h: string): void { const r = this.records.get(h); if (r) { r.promoted = true; this.save(); } }
  all(): EvidenceRecord[] { return Array.from(this.records.values()); }

  patternKey(raw: string, type: string): string {
    const normalized = raw
      .replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, '<ts>')
      .replace(/\/[^\s'"`]+\.[a-z]{1,4}/g, '<path>')
      .replace(/'[^']+'/g, "'<str>'").replace(/"[^"]+"/g, '"<str>"')
      .replace(/\d+/g, '<n>').trim().slice(0, 100);
    return createHash('sha256').update(type + ':' + normalized).digest('hex').slice(0, 8);
  }

  private save(): void {
    try { writeFileSync(this.persistPath, JSON.stringify(Array.from(this.records.values()), null, 2), 'utf-8'); }
    catch (err) { console.error('[memento] EvidenceGate save failed:', err); }
  }

  private load(): void {
    if (!existsSync(this.persistPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.persistPath, 'utf-8'));
      if (Array.isArray(data)) {
        for (const r of data as EvidenceRecord[]) {
          if (r.retrievalCount === undefined) r.retrievalCount = 0;
          if (r.lastRetrieved  === undefined) r.lastRetrieved  = null;
          this.records.set(r.patternHash, r);
        }
      }
    } catch (err) { console.error('[memento] EvidenceGate load failed (fresh):', err); }
  }
}
