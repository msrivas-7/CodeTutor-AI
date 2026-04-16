import { describe, it, expect } from "vitest";
import { estimateCost, formatCost, formatTokens, lookupPrice } from "./pricing";

describe("lookupPrice", () => {
  it("returns the exact-match entry when the id is in the table", () => {
    expect(lookupPrice("gpt-4o-mini")).toEqual({ in: 0.15, out: 0.6 });
  });

  it("uses longest-prefix match for dated model variants", () => {
    // The dated variant isn't in the table but "gpt-4.1-mini" is. We want
    // the specific mini rate — NOT the base "gpt-4.1" rate.
    expect(lookupPrice("gpt-4.1-mini-2024-07-18")).toEqual({ in: 0.4, out: 1.6 });
  });

  it("falls back to a shorter prefix when no specific variant matches", () => {
    expect(lookupPrice("gpt-4o-2024-11-20")).toEqual({ in: 2.5, out: 10.0 });
  });

  it("returns null for unknown models", () => {
    expect(lookupPrice("claude-3-opus")).toBeNull();
    expect(lookupPrice("llama-3")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("computes USD per 1M tokens correctly", () => {
    // gpt-4o-mini: 0.15 in, 0.6 out per 1M tokens.
    // 1000 input + 500 output = (1000 * 0.15 + 500 * 0.6) / 1_000_000
    //                         = (150 + 300) / 1_000_000 = 0.00045
    const cost = estimateCost("gpt-4o-mini", { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.00045, 10);
  });

  it("returns null for unknown models so callers can fall back to tokens-only", () => {
    expect(estimateCost("unknown-model", { inputTokens: 1000, outputTokens: 500 })).toBeNull();
  });

  it("returns 0 for zero usage on a known model", () => {
    expect(estimateCost("gpt-4o", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("formatCost", () => {
  it("shows sub-cent amounts as cents with 2dp when < 0.1¢", () => {
    // $0.0004 = 0.04¢
    expect(formatCost(0.0004)).toBe("0.04¢");
  });

  it("shows mid-cent amounts as cents with 1dp", () => {
    // $0.005 = 0.5¢
    expect(formatCost(0.005)).toBe("0.5¢");
  });

  it("shows dollars with 2dp once ≥ $0.01", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.2345)).toBe("$1.23");
  });
});

describe("formatTokens", () => {
  it("renders raw count below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("renders 1dp 'k' between 1000 and 10_000", () => {
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(9999)).toBe("10.0k");
  });

  it("rounds to whole 'k' at 10_000+", () => {
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(50_000)).toBe("50k");
  });
});
