import { isGptFiveOrLaterTutorModel } from "./modelRegistry.js";

// Phase 20-P4: price table owned by the backend, NOT derived from anything
// OpenAI's response hands us. We stamp every ledger row with the computed
// cost_usd and the price_version that produced it, so historical rows stay
// interpretable after a pricing rev — a later price bump doesn't rewrite
// yesterday's spend, and a regression-detection query can compare rates.
//
// Bump PRICE_VERSION whenever PRICES_USD_PER_MILLION changes. The ledger's
// partial indexes are independent of version, so no migration is needed.
//
// Fail-loud on unknown models. An operator can select only compatible GPT-5+
// models represented here, so metering can never be bypassed by choosing a
// newly discovered but unpriced model. A thrown error here is the canary that
// prevents a new internal route from becoming unmetered.

export const PRICE_VERSION = 4;

export interface ModelTokenPrice {
  input: number;
  output: number;
}

const PRICES_USD_PER_MILLION: Record<string, ModelTokenPrice> = {
  // gpt-4.1-nano: $0.10/M input + $0.40/M output (public pricing, April 2026).
  // Average tutor exchange at 3K input + 1K output ≈ $0.0007/call; the free
  // tier's cost math in the plan is pegged to these numbers.
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  // gpt-4.1-mini: $0.40/M input + $1.60/M output. Retained so historical
  // ledger rows remain interpretable after the Luna migration.
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  // Compatible Tutor candidates and approved Luna rate (OpenAI public pricing,
  // August 2026). Pricing alone does not imply provider availability.
  "gpt-5": { input: 1.25, output: 10.00 },
  "gpt-5-mini": { input: 0.25, output: 2.00 },
  "gpt-5-nano": { input: 0.05, output: 0.40 },
  "gpt-5.1": { input: 1.25, output: 10.00 },
  "gpt-5.2": { input: 1.75, output: 14.00 },
  "gpt-5.4": { input: 2.50, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, output: 1.25 },
  "gpt-5.5": { input: 5.00, output: 30.00 },
  "gpt-5.6-sol": { input: 5.00, output: 30.00 },
  "gpt-5.6": { input: 5.00, output: 30.00 },
  "gpt-5.6-terra": { input: 2.50, output: 15.00 },
  "gpt-5.6-luna": { input: 1.00, output: 6.00 },
};

function pricingAlias(model: string): string | null {
  if (PRICES_USD_PER_MILLION[model]) return model;
  const snapshotFamilies = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4-nano",
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5",
  ];
  return snapshotFamilies.find((family) => model.startsWith(`${family}-20`)) ?? null;
}

export interface PriceResult {
  costUsd: number;
  priceVersion: number;
}

export function priceUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): PriceResult {
  const alias = pricingAlias(model);
  const row = alias ? PRICES_USD_PER_MILLION[alias] : undefined;
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
  return isGptFiveOrLaterTutorModel(model) && hasKnownModelPrice(model);
}

export function hasKnownModelPrice(model: string): boolean {
  return pricingAlias(model) !== null;
}

export function modelTokenPrice(model: string): ModelTokenPrice | null {
  const alias = pricingAlias(model);
  return alias ? PRICES_USD_PER_MILLION[alias] ?? null : null;
}

export function maxTokenCostMultiplier(model: string, baselineModel: string): number | null {
  const price = modelTokenPrice(model);
  const baseline = modelTokenPrice(baselineModel);
  if (!price || !baseline) return null;
  return Math.max(price.input / baseline.input, price.output / baseline.output);
}

// Models that are both compatible with the Tutor request contract and priced.
// Platform-funded requests never choose from this list in the browser: the
// server-owned effective model is authoritative.
export const PLATFORM_ALLOWED_MODELS = Object.keys(PRICES_USD_PER_MILLION).filter(
  isGptFiveOrLaterTutorModel,
);
