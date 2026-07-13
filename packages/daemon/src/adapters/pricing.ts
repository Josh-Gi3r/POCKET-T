// Anthropic API pricing per million tokens, in USD.
//
// Snapshot of public pricing for the model lineup current as of mid-2026
// (source: Anthropic public pricing — Opus 4.6/4.7/4.8 $5/$25, Sonnet
// 5/4.6 $3/$15, Haiku 4.5 $1/$5). Cache reads bill at ~0.1x input; cache
// writes (5-minute TTL) at 1.25x input.
// Keep this file as the single edit point when prices move — adapters and
// the cost-meter UI all read from `priceForModel()`. If we don't recognise
// the model name we fall back to a "best-guess Sonnet" pricing so the
// meter still produces a useful number rather than silently zero-ing.

export interface ModelPricing {
  /** Plain prompt tokens. */
  inputPerMTok:           number;
  /** Completion tokens. */
  outputPerMTok:          number;
  /** Prompt cache reads (cheap). */
  cacheReadPerMTok:       number;
  /** Prompt cache writes (slightly above input). */
  cacheCreationPerMTok:   number;
}

const SONNET: ModelPricing = {
  inputPerMTok:          3.00,
  outputPerMTok:         15.00,
  cacheReadPerMTok:      0.30,
  cacheCreationPerMTok:  3.75,
};

const OPUS: ModelPricing = {
  inputPerMTok:          5.00,
  outputPerMTok:         25.00,
  cacheReadPerMTok:      0.50,
  cacheCreationPerMTok:  6.25,
};

const HAIKU: ModelPricing = {
  inputPerMTok:          1.00,
  outputPerMTok:         5.00,
  cacheReadPerMTok:      0.10,
  cacheCreationPerMTok:  1.25,
};

// OpenAI GPT-5 family (Codex backbone). Public list pricing as of
// mid-2026 — adjust when the API page changes.
const GPT5: ModelPricing = {
  inputPerMTok:          1.25,
  outputPerMTok:         10.00,
  cacheReadPerMTok:      0.13,
  cacheCreationPerMTok:  1.25,
};

const GPT5_MINI: ModelPricing = {
  inputPerMTok:          0.25,
  outputPerMTok:         2.00,
  cacheReadPerMTok:      0.025,
  cacheCreationPerMTok:  0.25,
};

// xAI Grok 4 family. Approximate — public pricing for the CLI tier.
const GROK4: ModelPricing = {
  inputPerMTok:          5.00,
  outputPerMTok:         15.00,
  cacheReadPerMTok:      0.50,
  cacheCreationPerMTok:  5.00,
};

const GROK4_MINI: ModelPricing = {
  inputPerMTok:          0.50,
  outputPerMTok:         3.00,
  cacheReadPerMTok:      0.05,
  cacheCreationPerMTok:  0.50,
};

export function priceForModel(model: string | undefined | null): ModelPricing {
  const m = (model ?? '').toLowerCase();

  // Anthropic
  if (m.includes('opus'))    return OPUS;
  if (m.includes('haiku'))   return HAIKU;
  if (m.includes('sonnet'))  return SONNET;

  // OpenAI / Codex
  if (m.includes('gpt-5-mini') || m.includes('gpt5-mini')) return GPT5_MINI;
  if (m.includes('gpt-5')      || m.includes('gpt5')      || m.startsWith('codex')) return GPT5;

  // xAI / Grok
  if (m.includes('grok-4-mini') || m.includes('grok4-mini')) return GROK4_MINI;
  if (m.includes('grok')) return GROK4;

  // Unknown — default to Sonnet so the meter shows *some* approximation.
  // The browser overlay labels this clearly.
  return SONNET;
}

/** Compute the USD cost of a single Claude turn given its `usage` block.
 *  Returns 0 if nothing usable is present. */
export function costOfUsage(
  model: string | undefined,
  usage: {
    input_tokens?:               number;
    output_tokens?:              number;
    cache_read_input_tokens?:    number;
    cache_creation_input_tokens?: number;
  } | undefined | null,
): number {
  if (!usage) return 0;
  const p = priceForModel(model);
  const inToks    = usage.input_tokens               ?? 0;
  const outToks   = usage.output_tokens              ?? 0;
  const cacheRd   = usage.cache_read_input_tokens    ?? 0;
  const cacheWr   = usage.cache_creation_input_tokens ?? 0;
  return (
    (inToks    / 1_000_000) * p.inputPerMTok        +
    (outToks   / 1_000_000) * p.outputPerMTok       +
    (cacheRd   / 1_000_000) * p.cacheReadPerMTok    +
    (cacheWr   / 1_000_000) * p.cacheCreationPerMTok
  );
}
