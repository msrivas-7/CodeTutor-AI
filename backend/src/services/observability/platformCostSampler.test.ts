import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies BEFORE dynamic-importing the sampler so its
// module-level config read lands on our fake.
let mockSum = 0;
const mockCap = 2;
vi.mock("../../db/usageLedger.js", () => ({
  sumPlatformCostTodayGlobal: vi.fn(async () => mockSum),
}));
vi.mock("../../config.js", () => ({
  config: {
    freeTier: {
      enabled: true,
      dailyUsdCap: mockCap,
    },
  },
}));

const { _sampleOnceForTest } = await import("./platformCostSampler.js");

describe("platformCostSampler", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Sampler uses console.log for the structured line — spy so we can
    // assert the shape without polluting CI stdout.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits exceeded:false when sum is below 2× the daily cap", async () => {
    mockSum = 1; // cap=2, threshold=4, 1 < 4
    await _sampleOnceForTest();
    expect(logSpy).toHaveBeenCalledOnce();
    const line = logSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.evt).toBe("platform_cost_hourly");
    expect(parsed.sum_usd).toBe(1);
    expect(parsed.threshold_usd).toBe(4);
    expect(parsed.exceeded).toBe(false);
  });

  it("emits exceeded:true when sum exceeds 2× the daily cap", async () => {
    mockSum = 5; // cap=2, threshold=4, 5 > 4
    await _sampleOnceForTest();
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.exceeded).toBe(true);
    expect(parsed.sum_usd).toBe(5);
  });

  it("does not flag exceeded at the exact threshold (strict >)", async () => {
    // Alert key matches `exceeded:true` so we must not cross at equality —
    // otherwise the alert pages on every quiet day that happens to hit the
    // round-trip cap number exactly.
    mockSum = 4;
    await _sampleOnceForTest();
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.exceeded).toBe(false);
  });

  it("rounds sum_usd to four decimal places (readable + deterministic)", async () => {
    mockSum = 0.123456789;
    await _sampleOnceForTest();
    const parsed = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed.sum_usd).toBe(0.1235);
  });
});
