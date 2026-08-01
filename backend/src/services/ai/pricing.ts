// Phase 20-P4: price table owned by the backend, NOT derived from anything
// OpenAI's response hands us. We stamp every ledger row with the computed
// cost_usd and the price_version that produced it, so historical rows stay
// interpretable after a pricing rev — a later price bump doesn't rewrite
// yesterday's spend, and a regression-detection query can compare rates.
//
// Bump PRICE_VERSION whenever PRICES_USD_PER_MILLION changes. The ledger's
// partial indexes are independent of version, so no migration is needed.
//
// Fail-loud on unknown models. The public request allowlist and this internal
// price table are intentionally separate: browsers may request only Nano on
// the platform credential, while the server may route an evaluated intent to
// another priced model. A thrown error here is the canary that prevents a new
// internal route from becoming unmetered.

export const PRICE_VERSION = 2;

const PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  // gpt-4.1-nano: $0.10/M input + $0.40/M output (public pricing, April 2026).
  // Average tutor exchange at 3K input + 1K output ≈ $0.0007/call; the free
  // tier's cost math in the plan is pegged to these numbers.
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  // gpt-4.1-mini: $0.40/M input + $1.60/M output. B3 permits this only
  // for server-classified check-ins that passed the independent model gate.
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
};

export interface PriceResult {
  costUsd: number;
  priceVersion: number;
}

export function priceUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): PriceResult {
  const row = PRICES_USD_PER_MILLION[model];
  if (!row) {
    throw new Error(
      `[pricing] unknown model ${JSON.stringify(model)}. Extend PRICES_USD_PER_MILLION and bump PRICE_VERSION.`,
    );
  }
  if (inputTokens < 0 || outputTokens < 0) {
    throw new Error(
      `[pricing] token counts must be non-negative (got input=${inputTokens} output=${outputTokens})`,
    );
  }
  const cost =
    (inputTokens * row.input + outputTokens * row.output) / 1_000_000;
  // Round to 6 decimal places to match the ledger column's numeric(10,6)
  // precision. Keeps arithmetic stable across insert+read.
  const rounded = Math.round(cost * 1_000_000) / 1_000_000;
  return { costUsd: rounded, priceVersion: PRICE_VERSION };
}

export function isPlatformAllowedModel(model: string): boolean {
  return (PLATFORM_ALLOWED_MODELS as readonly string[]).includes(model);
}

// Models accepted from an untrusted client for a platform-funded request.
// Internal routing models MUST NOT be added here: doing so would let a browser
// select the more expensive model directly and bypass the intent gate.
export const PLATFORM_ALLOWED_MODELS = ["gpt-4.1-nano"] as const;
