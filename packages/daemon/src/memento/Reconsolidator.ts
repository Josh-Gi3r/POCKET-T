// Corrections rewrite the original entry in place — not append alongside.
// Nader et al. (2000): reactivated memories return to labile state on prediction error.

import type { TaggedEvent } from './EventTagger.js';
import type { CompiledTruthItem } from './NohupMdWriter.js';
import type { NohupMdWriter } from './NohupMdWriter.js';
import type { EvidenceGate } from './EvidenceGate.js';

const CORRECTION_PATTERNS: RegExp[] = [
  /\bno\b.*\b(don't|do not|never|stop)\b/i,
  /\bwait\b/i,
  /\b(revert|undo|go back)\b/i,
  /\bthat's wrong\b/i,
  /\bI said\b/i,
  /\bnot that\b/i,
  /\binstead\b/i,
];

export class Reconsolidator {
  constructor(private writer: NohupMdWriter, private gate: EvidenceGate) {}

  detectAndApply(event: TaggedEvent, compiledItems: CompiledTruthItem[]): boolean {
    if (event.type !== 'user_constraint' && !CORRECTION_PATTERNS.some(p => p.test(event.raw))) return false;
    const correction = this.findTarget(event.raw, compiledItems);
    if (!correction) return false;

    const newContent = this.buildContent(correction.id, event.raw, compiledItems);
    this.writer.reconsolidate(correction.id, newContent, event.raw);
    this.gate.recordRetrievalFailure(correction.id);
    console.log(`[memento] Reconsolidated [${correction.id}]: ${newContent.slice(0, 80)}`);
    return true;
  }

  private findTarget(text: string, items: CompiledTruthItem[]): { id: string } | null {
    const words = new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
    let best: { id: string; score: number } | null = null;
    for (const item of items) {
      if (item.locked && item.notability === 'high') continue;
      const iWords = new Set(item.content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
      const inter  = [...words].filter(w => iWords.has(w)).length;
      const union  = new Set([...words, ...iWords]).size;
      const score  = union > 0 ? inter / union : 0;
      if (score > 0.2 && (!best || score > best.score)) best = { id: item.id, score };
    }
    return best;
  }

  private buildContent(id: string, correction: string, items: CompiledTruthItem[]): string {
    const orig = items.find(i => i.id === id);
    return `User rule: ${correction.trim().slice(0, 100)}${orig ? ` [corrected from: ${orig.content.slice(0, 50)}]` : ''}`;
  }
}
