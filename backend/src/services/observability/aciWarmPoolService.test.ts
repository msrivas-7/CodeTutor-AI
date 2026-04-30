// Phase 24B Slice 8: aciWarmPoolService hysteresis + tick correctness.
//
// We don't drive a real AciExecutionBackend here — that's covered by
// aci.failures.test.ts. This file just validates the SERVICE'S decision
// logic: given a (localActive, currentWarmCount) pair, does it call the
// right backend method (spawn / drain / nothing)?

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setAciWarmPoolOptionsForTests,
  startAciWarmPoolService,
  stopAciWarmPoolService,
  tick,
} from "./aciWarmPoolService.js";

interface FakeBackend {
  spawnWarm: ReturnType<typeof vi.fn>;
  drainOldestWarm: ReturnType<typeof vi.fn>;
  getWarmCount: ReturnType<typeof vi.fn>;
}

function makeBackendStub(initialWarmCount: number): FakeBackend {
  let count = initialWarmCount;
  return {
    spawnWarm: vi.fn(async () => {
      count += 1;
      return true;
    }),
    drainOldestWarm: vi.fn(async () => {
      if (count <= 0) return false;
      count -= 1;
      return true;
    }),
    getWarmCount: vi.fn(() => count),
  };
}

describe("aciWarmPoolService — hysteresis + dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopAciWarmPoolService();
    vi.useRealTimers();
  });

  it("disabled tick is a no-op (default config)", async () => {
    const backend = makeBackendStub(0);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => 100, // saturated — would normally trigger
    });
    // Service starts disabled by default.
    await tick();
    expect(backend.spawnWarm).not.toHaveBeenCalled();
    expect(backend.drainOldestWarm).not.toHaveBeenCalled();
  });

  it("ramps up by 1 per tick when localActive ≥ highWatermark", async () => {
    const backend = makeBackendStub(0);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => 13, // ≥ high watermark (12)
      options: {
        enabled: true,
        highWatermark: 12,
        lowWatermark: 10,
        maxPoolSize: 2,
      },
    });
    // First tick: 0 → 1
    await tick();
    expect(backend.spawnWarm).toHaveBeenCalledTimes(1);
    expect(backend.drainOldestWarm).not.toHaveBeenCalled();

    // Second tick: 1 → 2
    await tick();
    expect(backend.spawnWarm).toHaveBeenCalledTimes(2);

    // Third tick: at cap, no further spawn.
    await tick();
    expect(backend.spawnWarm).toHaveBeenCalledTimes(2);
  });

  it("drains by 1 per tick when localActive ≤ lowWatermark", async () => {
    const backend = makeBackendStub(2);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => 8, // ≤ low watermark (10)
      options: {
        enabled: true,
        highWatermark: 12,
        lowWatermark: 10,
        maxPoolSize: 2,
      },
    });
    await tick();
    expect(backend.drainOldestWarm).toHaveBeenCalledTimes(1);
    await tick();
    expect(backend.drainOldestWarm).toHaveBeenCalledTimes(2);
    // Pool empty — next tick is no-op.
    await tick();
    expect(backend.drainOldestWarm).toHaveBeenCalledTimes(2);
  });

  it("hysteresis band (low < localActive < high) holds the current size", async () => {
    const backend = makeBackendStub(1);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => 11, // between low (10) and high (12)
      options: {
        enabled: true,
        highWatermark: 12,
        lowWatermark: 10,
        maxPoolSize: 2,
      },
    });
    await tick();
    await tick();
    await tick();
    expect(backend.spawnWarm).not.toHaveBeenCalled();
    expect(backend.drainOldestWarm).not.toHaveBeenCalled();
  });

  it("transitions: rises with pressure, drains after pressure clears", async () => {
    let active = 5;
    const backend = makeBackendStub(0);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => active,
      options: {
        enabled: true,
        highWatermark: 12,
        lowWatermark: 10,
        maxPoolSize: 2,
      },
    });
    // Cold start: localActive = 5, no action.
    await tick();
    expect(backend.spawnWarm).not.toHaveBeenCalled();

    // Spike: localActive = 13, ramp to 2.
    active = 13;
    await tick(); // 0 → 1
    await tick(); // 1 → 2
    await tick(); // at cap
    expect(backend.spawnWarm).toHaveBeenCalledTimes(2);

    // In hysteresis band: localActive = 11, hold at 2.
    active = 11;
    await tick();
    expect(backend.drainOldestWarm).not.toHaveBeenCalled();

    // Pressure cleared: localActive = 5, drain.
    active = 5;
    await tick(); // 2 → 1
    await tick(); // 1 → 0
    await tick(); // empty, no-op
    expect(backend.drainOldestWarm).toHaveBeenCalledTimes(2);
  });

  it("ignores ticks that throw on getLocalActive (defensive)", async () => {
    const backend = makeBackendStub(0);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => {
        throw new Error("hybrid not ready");
      },
      options: { enabled: true, highWatermark: 12, lowWatermark: 10, maxPoolSize: 2 },
    });
    // Must NOT crash — the service swallows the error and tries again
    // next tick.
    await expect(tick()).resolves.toBeUndefined();
    expect(backend.spawnWarm).not.toHaveBeenCalled();
  });

  it("stop is idempotent + clears the timer cleanly", async () => {
    const backend = makeBackendStub(0);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => 0,
    });
    stopAciWarmPoolService();
    stopAciWarmPoolService(); // idempotent
    await tick();
    expect(backend.spawnWarm).not.toHaveBeenCalled();
  });

  it("__setAciWarmPoolOptionsForTests overrides safely (used by soak test)", async () => {
    const backend = makeBackendStub(0);
    startAciWarmPoolService({
      backend: backend as never,
      getLocalActive: () => 100,
      options: { enabled: false, highWatermark: 12, lowWatermark: 10, maxPoolSize: 2 },
    });
    await tick();
    expect(backend.spawnWarm).not.toHaveBeenCalled();

    // Test override flips enabled true.
    __setAciWarmPoolOptionsForTests({ enabled: true });
    await tick();
    expect(backend.spawnWarm).toHaveBeenCalledTimes(1);
  });
});
