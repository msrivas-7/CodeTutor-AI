import type { TokenUsage } from "../types";

// Approximate OpenAI API pricing in USD per 1M tokens, keyed by the longest
// model-id prefix we know. These numbers drift over time — this is a best-
// effort client-side estimate so the student can see what each ask costs.
// Unknown models return null and we render tokens-only.
//
// Source: https://openai.com/api/pricing as of early 2025. Update by editing
// this table — nothing else imports the constants.
const PRICING_PER_1M: Record<string, { in: number; out: number }> = {
  // GPT-4.1 family
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  // GPT-4o family
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
  // o-series reasoning models
  "o4-mini": { in: 1.1, out: 4.4 },
  "o3-mini": { in: 1.1, out: 4.4 },
  "o3": { in: 2.0, out: 8.0 },
  // Older but still offered
  "gpt-4-turbo": { in: 10.0, out: 30.0 },
  "gpt-4": { in: 30.0, out: 60.0 },
  "gpt-3.5": { in: 0.5, out: 1.5 },
};

export function lookupPrice(modelId: string): { in: number; out: number } | null {
  if (PRICING_PER_1M[modelId]) return PRICING_PER_1M[modelId];
  // Longest-prefix match so "gpt-4.1-mini-2024-07-18" picks the mini rate,
  // not the base "gpt-4.1" rate.
  const keys = Object.keys(PRICING_PER_1M).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (modelId.startsWith(k)) return PRICING_PER_1M[k];
  }
  return null;
}

// Returns estimated USD cost, or null if we don't recognise the model. Callers
// decide whether to render "~$X" or fall back to tokens-only.
export function estimateCost(modelId: string, usage: TokenUsage): number | null {
  const p = lookupPrice(modelId);
  if (!p) return null;
  return (usage.inputTokens * p.in + usage.outputTokens * p.out) / 1_000_000;
}

// Tight human-readable cost: pennies for very small amounts, dollars rounded
// to 2dp for typical asks. Students watching individual turn costs care most
// about "is this a tenth of a cent or a dollar" — the exact fractional cent
// is noise.
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    const cents = usd * 100;
    // Sub-cent: show 3 sig figs of a cent so "0.0004" reads as "0.04¢".
    return `${cents.toFixed(cents < 0.1 ? 2 : 1)}¢`;
  }
  return `$${usd.toFixed(2)}`;
}

// Compact "1,234" / "12.3k" token count so the chip stays narrow.
export function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
