import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { EvidenceRecord } from './EvidenceGate.js';

export type Category = 'constraint' | 'decision' | 'pattern' | 'context';

export interface CompiledTruthItem {
  id:             string;
  weight:         number;
  content:        string;
  category:       Category;
  addedAt:        string;
  corroborations: number;
  locked:         boolean;
  notability:     'high' | 'medium' | 'low';
  labilePending?: boolean;
  correctionText?: string;
}

export interface TimelineEntry {
  id:        string;
  timestamp: string;
  type:      string;
  summary:   string;
  salience:  number;
}

const MAX_PER_CATEGORY = 4;
const MAX_TIMELINE     = 20;
const DECAY_FLOOR      = 0.15;

export class NohupMdWriter {
  private compiledItems:   CompiledTruthItem[] = [];
  private timelineEntries: TimelineEntry[]     = [];
  private statePath: string;
  readonly nohupPath: string;

  constructor(private projectRoot: string) {
    const dir = join(projectRoot, '.nohup', 'brain');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.statePath = join(dir, 'compiled.json');
    this.nohupPath = join(projectRoot, 'NOHUP.md');
    this.loadState();
  }

  addOrUpdateItem(record: EvidenceRecord, content: string, category: Category, weight: number, locked = false): void {
    const existing = this.compiledItems.find(i => i.id === record.patternHash);
    if (existing) {
      existing.weight = Math.max(weight, existing.weight);
      existing.corroborations = record.count;
      existing.content = content;
      existing.labilePending = false;
    } else {
      this.compiledItems.push({ id: record.patternHash, weight, content, category,
        addedAt: new Date().toISOString(), corroborations: record.count,
        locked, notability: locked ? 'high' : 'medium' });
    }
    this.saveState();
  }

  // V2: rewrite original entry on user correction — not append alongside
  reconsolidate(id: string, newContent: string, correctionText: string): void {
    const item = this.compiledItems.find(i => i.id === id);
    if (!item) return;
    item.content       = newContent;
    item.correctionText = correctionText;
    item.weight        = Math.min(item.weight * 1.2, 1.0);
    item.locked        = true;
    item.notability    = 'high';
    item.labilePending = false;
    this.saveState();
  }

  // V2: called by DecayEngine with updated weights
  applyDecayWeights(updates: Map<string, number>): void {
    for (const item of this.compiledItems) {
      const w = updates.get(item.id);
      if (w !== undefined && !item.locked && item.notability !== 'high') {
        item.weight = Math.max(w, DECAY_FLOOR);
      }
    }
    this.compiledItems = this.compiledItems.filter(
      i => i.weight >= DECAY_FLOOR || i.locked || i.notability === 'high'
    );
    this.saveState();
  }

  appendTimeline(entry: TimelineEntry): void {
    this.timelineEntries.push(entry);
    if (this.timelineEntries.length > MAX_TIMELINE * 3) {
      this.timelineEntries = this.timelineEntries.slice(-MAX_TIMELINE * 2);
    }
    this.saveState();
  }

  write(): void {
    try { writeFileSync(this.nohupPath, this.render(), 'utf-8'); }
    catch (err) { console.error('[memento] NohupMdWriter write failed:', err); }
  }

  getItems():    CompiledTruthItem[] { return this.compiledItems; }
  getTimeline(): TimelineEntry[]     { return this.timelineEntries; }

  private render(): string {
    const byCategory = groupBy(this.compiledItems, i => i.category);
    const lines: string[] = [
      '# NOHUP.md — Agent Memory',
      `> Generated: ${new Date().toISOString()}`,
      '> Read this at session start. Trust compiled truth. Timeline is raw evidence.',
      '', '## === COMPILED TRUTH ===',
      '> Corroborated across sessions. Rewritten when understanding changes.', '',
    ];

    for (const cat of ['constraint', 'decision', 'pattern', 'context'] as Category[]) {
      const items = (byCategory[cat] ?? [])
        .filter(i => i.weight >= DECAY_FLOOR)
        .sort((a, b) => (b.weight * b.corroborations) - (a.weight * a.corroborations))
        .slice(0, MAX_PER_CATEGORY);
      if (!items.length) continue;
      lines.push(`### ${capitalize(cat)}s`);
      for (const item of items) {
        lines.push(`- [${item.id}] (w:${item.weight.toFixed(2)}, n:${item.corroborations})${item.locked ? ' 🔒' : ''} ${item.content}`);
      }
      lines.push('');
    }

    lines.push('---', '', '## === TIMELINE ===', '> Append-only. Most recent first.', '');
    const recent = [...this.timelineEntries]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_TIMELINE);
    if (!recent.length) {
      lines.push('> No events recorded yet.');
    } else {
      for (const e of recent) lines.push(`- ${e.timestamp.slice(0, 10)} [${e.id}] **${e.type}**: ${e.summary}`);
    }
    return lines.join('\n') + '\n';
  }

  private saveState(): void {
    try {
      writeFileSync(this.statePath, JSON.stringify(
        { compiled: this.compiledItems, timeline: this.timelineEntries }, null, 2), 'utf-8');
    } catch (err) { console.error('[memento] state save failed:', err); }
  }

  private loadState(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const d = JSON.parse(readFileSync(this.statePath, 'utf-8'));
      this.compiledItems   = d.compiled  ?? [];
      this.timelineEntries = d.timeline  ?? [];
    } catch (err) { console.error('[memento] state load failed (fresh):', err); }
  }
}

function groupBy<T>(arr: T[], key: (x: T) => string): Record<string, T[]> {
  return arr.reduce((acc, x) => {
    const k = key(x); return { ...acc, [k]: [...(acc[k] ?? []), x] };
  }, {} as Record<string, T[]>);
}
function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
