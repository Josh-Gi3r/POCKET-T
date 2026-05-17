// Two-component compression from ACON (Microsoft Research, ICLR 2026).
// Key: compress RELATIVE to what's already in NOHUP.md.

import { existsSync, readFileSync } from 'fs';
import type { TaggedEvent } from './EventTagger.js';
import type { CompiledTruthItem } from './NohupMdWriter.js';

function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }

export interface CompactionResult {
  kept:    TaggedEvent[];
  dropped: number;
  reason:  'token_budget' | 'no_compaction_needed';
}

export class EventCompactor {
  compact(events: TaggedEvent[], nohupPath: string, tokenBudget = 2000): CompactionResult {
    if (!events.length) return { kept: [], dropped: 0, reason: 'no_compaction_needed' };
    const totalTokens = events.reduce((sum, e) => sum + estimateTokens(e.raw), 0);
    if (totalTokens <= tokenBudget) return { kept: events, dropped: 0, reason: 'no_compaction_needed' };

    const knownContent = existsSync(nohupPath) ? readFileSync(nohupPath, 'utf-8') : '';
    const scored = events.map(e => ({
      event: e,
      score: e.salience * (knownContent.includes(e.raw.slice(0, 40)) ? 0.3 : 1.0),
    })).sort((a, b) => b.score - a.score);

    const kept: TaggedEvent[] = [];
    let used = 0;
    for (const { event } of scored) {
      const t = estimateTokens(event.raw);
      if (used + t <= tokenBudget) { kept.push(event); used += t; }
    }
    return { kept, dropped: events.length - kept.length, reason: 'token_budget' };
  }
}

export class SessionCompactor {
  compact(items: CompiledTruthItem[], maxTotalTokens = 3000, maxPerCategory = 4)
    : { kept: CompiledTruthItem[]; pruned: string[] } {
    const total = items.reduce((sum, i) => sum + estimateTokens(i.content), 0);
    if (total <= maxTotalTokens) return { kept: items, pruned: [] };

    const sorted = [...items].sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? -1 : 1;
      const order = { high: 0, medium: 1, low: 2 };
      if (a.notability !== b.notability) return order[a.notability] - order[b.notability];
      return (b.weight * b.corroborations) - (a.weight * a.corroborations);
    });

    const byCat = new Map<string, CompiledTruthItem[]>();
    for (const item of sorted) {
      const list = byCat.get(item.category) ?? [];
      if (list.length < maxPerCategory) list.push(item);
      byCat.set(item.category, list);
    }
    const kept    = Array.from(byCat.values()).flat();
    const keptIds = new Set(kept.map(i => i.id));
    return { kept, pruned: items.filter(i => !keptIds.has(i.id)).map(i => i.id) };
  }
}
