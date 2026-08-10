import { describe, expect, it } from "vitest";
import {
  PLATFORM_ALLOWED_MODELS,
  PRICE_VERSION,
  maxTokenCostMultiplier,
  isPlatformAllowedModel,
  priceUsd,
} from "./pricing.js";

describe("priceUsd", () => {
  it("computes cost for gpt-4.1-nano at the published rate", () => {
    // 3K input + 1K output = (3000 * 0.10 + 1000 * 0.40) / 1e6 = 0.0007
    const r = priceUsd("gpt-4.1-nano", 3000, 1000);
    expect(r.costUsd).toBe(0.0007);
    expect(r.priceVersion).toBe(PRICE_VERSION);
  });

  it("computes cost for the internally routed gpt-4.1-mini model", () => {
    // 3K input + 1K output = (3000 * 0.40 + 1000 * 1.60) / 1e6 = 0.0028
    const r = priceUsd("gpt-4.1-mini", 3000, 1000);
    expect(r.costUsd).toBe(0.0028);
    expect(r.priceVersion).toBe(PRICE_VERSION);
  });

  it.each([
    ["gpt-5-mini", 0.00275],
    ["gpt-5.4-mini", 0.00675],
    ["gpt-5.6-luna", 0.009],
  ])("computes cost for tutor migration candidate %s", (model, expected) => {
    const r = priceUsd(model, 3000, 1000);
    expect(r.costUsd).toBe(expected);
    expect(r.priceVersion).toBe(PRICE_VERSION);
  });

  it("returns 0 cost when both token counts are 0", () => {
    const r = priceUsd("gpt-4.1-nano", 0, 0);
    expect(r.costUsd).toBe(0);
  });

  it("rounds to 6 decimal places (ledger numeric(10,6))", () => {
    // 1 input token = 0.10 / 1e6 = 1e-7, which rounds to 0 at 6dp.
    const r = priceUsd("gpt-4.1-nano", 1, 0);
    expect(r.costUsd).toBe(0);
    // 10 input tokens = 1e-6 = exactly 6dp.
    const r2 = priceUsd("gpt-4.1-nano", 10, 0);
    expect(r2.costUsd).toBe(0.000001);
  });

  it("throws fail-loud on unknown model", () => {
    expect(() => priceUsd("gpt-99", 100, 100)).toThrow(/unknown model/);
  });

  it("throws on negative token counts", () => {
    expect(() => priceUsd("gpt-4.1-nano", -1, 0)).toThrow(/non-negative/);
    expect(() => priceUsd("gpt-4.1-nano", 0, -1)).toThrow(/non-negative/);
  });
});

describe("isPlatformAllowedModel", () => {
  it("accepts compatible, priced GPT-5+ platform models", () => {
    expect(isPlatformAllowedModel("gpt-5.6-luna")).toBe(true);
    expect(isPlatformAllowedModel("gpt-5.6-terra")).toBe(true);
    expect(isPlatformAllowedModel("gpt-5.4-mini")).toBe(true);
  });

  it("rejects retired, specialized, and unpriced models", () => {
    expect(isPlatformAllowedModel("gpt-4.1-mini")).toBe(false);
    expect(isPlatformAllowedModel("gpt-4.1-nano")).toBe(false);
    expect(isPlatformAllowedModel("gpt-4o")).toBe(false);
    expect(isPlatformAllowedModel("gpt-4.1-nano-super")).toBe(false);
    expect(isPlatformAllowedModel("gpt-5-pro")).toBe(false);
    expect(isPlatformAllowedModel("gpt-5.99")).toBe(false);
    expect(isPlatformAllowedModel("")).toBe(false);
  });

  it("has every client-allowed model represented in the price table", () => {
    for (const m of PLATFORM_ALLOWED_MODELS) {
      expect(isPlatformAllowedModel(m)).toBe(true);
    }
  });
});

describe("maxTokenCostMultiplier", () => {
  it("shows Terra as at most 2.5x Luna and Sol as at most 5x", () => {
    expect(maxTokenCostMultiplier("gpt-5.6-terra", "gpt-5.6-luna")).toBe(2.5);
    expect(maxTokenCostMultiplier("gpt-5.6-sol", "gpt-5.6-luna")).toBe(5);
  });

  it("returns null unless both models have registered prices", () => {
    expect(maxTokenCostMultiplier("gpt-5.99", "gpt-5.6-luna")).toBeNull();
  });
});
