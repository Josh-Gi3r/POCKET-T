// score(t) = S₀ · r^α · e^(-λ(n-nr))
// λ=0.30 (Ebbinghaus forgetting rate), α=1.5 (retrieval strengthening), floor=0.15

import type { CompiledTruthItem } from './NohupMdWriter.js';

export interface DecayConfig { lambda: number; alpha: number; floor: number; }
export const DEFAULT_DECAY_CONFIG: DecayConfig = { lambda: 0.30, alpha: 1.5, floor: 0.15 };

export interface DecayResult {
  id:          string;
  oldWeight:   number;
  newWeight:   number;
  shouldPrune: boolean;
}

export class DecayEngine {
  private config: DecayConfig;
  constructor(config: Partial<DecayConfig> = {}) {
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
  }

  computeDecay(
    items: CompiledTruthItem[],
    snapshotsSinceRetrieval: Map<string, number>,
    retrievalCounts:         Map<string, number>,
  ): DecayResult[] {
    return items.map(item => {
      if (item.locked || item.notability === 'high') {
        return { id: item.id, oldWeight: item.weight, newWeight: item.weight, shouldPrune: false };
      }
      const r        = retrievalCounts.get(item.id) ?? 0;
      const n_minus_nr = snapshotsSinceRetrieval.get(item.id) ?? 0;
      const forgetting = Math.exp(-this.config.lambda * n_minus_nr);

      let newWeight: number;
      if (r === 0) {
        newWeight = item.weight * forgetting;
      } else {
        const retrievalResistance = Math.min(Math.pow(r, this.config.alpha) * 0.05, 0.3);
        newWeight = item.weight * (forgetting + retrievalResistance);
      }
      newWeight = Math.min(newWeight, 1.0);
      const shouldPrune = newWeight < this.config.floor;
      return { id: item.id, oldWeight: item.weight, newWeight: shouldPrune ? this.config.floor : newWeight, shouldPrune };
    });
  }

  boostOnRetrieval(currentWeight: number, retrievalCount: number): number {
    return Math.min(currentWeight + Math.min(Math.pow(retrievalCount, this.config.alpha) * 0.05, 0.3), 1.0);
  }
}
