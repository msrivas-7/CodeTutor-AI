// Phase 24B Slice 8: AciExecutionBackend warm-pool methods.
//
// Validates: spawnWarm, drainOldestWarm, tryClaimWarm, getWarmCount,
// and the cost-tracker continuity contract on claim (warm-id ends, real-
// session-id starts at the same instant — no double-counting, no gap).
//
// Same SDK + cost-tracker mocking pattern as aci.failures.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBeginCreateOrUpdateAndWait = vi.fn();
const mockBeginDeleteAndWait = vi.fn();
const mockGet = vi.fn();
const mockListByResourceGroup = vi.fn();

vi.mock("@azure/arm-containerinstance", () => {
  return {
    ContainerInstanceManagementClient: vi.fn().mockImplementation(() => ({
      containerGroups: {
        beginCreateOrUpdateAndWait: mockBeginCreateOrUpdateAndWait,
        beginDeleteAndWait: mockBeginDeleteAndWait,
        get: mockGet,
        listByResourceGroup: mockListByResourceGroup,
      },
    })),
  };
});

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn(),
}));

const mockRecordSessionStart = vi.fn();
const mockRecordSessionEnd = vi.fn();
vi.mock("../../observability/aciCostTracker.js", () => ({
  aciCostTracker: {
    recordSessionStart: mockRecordSessionStart,
    recordSessionEnd: mockRecordSessionEnd,
  },
  ACI_COST_RATE_USD_PER_SESSION_HOUR: 0.053,
}));

const { AciExecutionBackend } = await import("./aci.js");

const baseOpts = {
  subscriptionId: "00000000-0000-0000-0000-000000000000",
  resourceGroup: "rg-test",
  location: "eastus2",
  subnetId:
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet/subnets/aci",
  runnerImage: "ghcr.io/example/runner@sha256:deadbeef",
  sidecarPort: 5757,
  coldStartTimeoutMs: 200,
  agentReadyTimeoutMs: 300,
};

// listByResourceGroup is an async iterable in the SDK. Provide a real
// one so both `iter.next()` (auth probe) and `for await ... of` (P0-3
// orphan reaper, called from ensureReady) work against the same mock.
function mockListResolves(items: Array<{ name: string }> = []): void {
  mockListByResourceGroup.mockReturnValue({
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () =>
          i < items.length
            ? { done: false, value: items[i++] }
            : { done: true, value: undefined },
      };
    },
    next: () =>
      items.length === 0
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.resolve({ done: false, value: items[0] }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;
function stubFetchOk(): void {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ ok: true, exists: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  mockBeginCreateOrUpdateAndWait.mockReset();
  mockBeginDeleteAndWait.mockReset();
  mockGet.mockReset();
  mockListByResourceGroup.mockReset();
  mockRecordSessionStart.mockReset();
  mockRecordSessionEnd.mockReset();
  mockListResolves();
  mockBeginDeleteAndWait.mockResolvedValue(undefined);
});

afterEach(() => {
  fetchSpy?.mockRestore();
});

describe("AciExecutionBackend — warm pool", () => {
  it("spawnWarm adds to the pool + records the warm-id in the cost tracker", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    expect(backend.getWarmCount()).toBe(0);
    expect(await backend.spawnWarm()).toBe(true);
    expect(backend.getWarmCount()).toBe(1);

    expect(mockRecordSessionStart).toHaveBeenCalledTimes(1);
    expect(mockRecordSessionStart.mock.calls[0][0]).toMatch(/^aci-warm-/);
  });

  it("spawnWarm returns false on Azure failure + does NOT pollute the pool", async () => {
    mockBeginCreateOrUpdateAndWait.mockRejectedValue(
      new Error("Azure: throttled"),
    );
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await backend.spawnWarm()).toBe(false);
    consoleErr.mockRestore();

    expect(backend.getWarmCount()).toBe(0);
    expect(mockRecordSessionStart).not.toHaveBeenCalled();
    // Cleanup of the partial group was attempted by spawnContainerGroup.
    expect(mockBeginDeleteAndWait).toHaveBeenCalledTimes(1);
  });

  it("drainOldestWarm pops FIFO + ends the warm-id cost bucket + deletes the container", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    await backend.spawnWarm();
    await backend.spawnWarm();
    expect(backend.getWarmCount()).toBe(2);

    const firstWarmId = mockRecordSessionStart.mock.calls[0][0];
    expect(await backend.drainOldestWarm()).toBe(true);
    expect(backend.getWarmCount()).toBe(1);
    // FIFO — the first-spawned warm-id is the one that ended.
    expect(mockRecordSessionEnd).toHaveBeenCalledWith(firstWarmId);
    // Cleanup of the corresponding container group.
    expect(mockBeginDeleteAndWait).toHaveBeenCalledTimes(1);
  });

  it("drainOldestWarm on empty pool is a no-op + returns false", async () => {
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady().catch(() => {}); // ensureReady probe

    expect(await backend.drainOldestWarm()).toBe(false);
    expect(mockRecordSessionEnd).not.toHaveBeenCalled();
  });

  it("createSession claims a warm container — sub-millisecond fast path, no Azure SDK call", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    // Pre-spawn a warm container.
    await backend.spawnWarm();
    expect(backend.getWarmCount()).toBe(1);
    const sdkCallsAfterWarm = mockBeginCreateOrUpdateAndWait.mock.calls.length;

    // Claim it via createSession.
    const handle = await backend.createSession({ sessionId: "real-session-1" });

    // The handle is bound to the warm container's IP + port + token.
    expect(handle.sessionId).toBe("real-session-1");
    expect((handle as { privateIp?: string }).privateIp).toBe("10.20.2.5");

    // No additional Azure SDK call — the warm container was claimed,
    // not freshly spawned.
    expect(mockBeginCreateOrUpdateAndWait.mock.calls.length).toBe(
      sdkCallsAfterWarm,
    );
    expect(backend.getWarmCount()).toBe(0);

    // Cost-tracker continuity: warm-id ENDED, real session-id STARTED
    // at the SAME instant (the `now` passed to both calls is identical).
    const endCalls = mockRecordSessionEnd.mock.calls;
    const startCalls = mockRecordSessionStart.mock.calls;
    // 1 warm spawn → 1 start call. Then claim → 1 end + 1 start = 2 total starts.
    expect(startCalls.length).toBe(2);
    expect(endCalls.length).toBe(1);
    expect(endCalls[0][0]).toMatch(/^aci-warm-/); // the warm-id was ended
    expect(startCalls[1][0]).toBe("real-session-1");
    // Same instant — second-arg timestamps are equal.
    expect(endCalls[0][1]).toBe(startCalls[1][1]);
  });

  it("createSession with empty pool falls through to cold-start path", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.99" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    // Pool is empty.
    expect(backend.getWarmCount()).toBe(0);
    const handle = await backend.createSession({ sessionId: "fresh-1" });

    expect(handle.sessionId).toBe("fresh-1");
    // SDK was called once for the cold-start spawn.
    expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(1);
    // Cost tracker recorded the real session start (third arg is the
    // optional reservationId, undefined when getDailyUsdCap isn't wired).
    expect(mockRecordSessionStart).toHaveBeenCalledWith(
      "fresh-1",
      expect.any(Number),
      undefined,
    );
  });

  it("destroying a claimed-from-warm session deletes its container (single-use)", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    await backend.spawnWarm();
    const handle = await backend.createSession({ sessionId: "single-use" });
    await backend.destroy(handle);

    // Container group is destroyed — claimed warm containers are NEVER
    // returned to the pool (cross-tenant data leak risk).
    expect(mockBeginDeleteAndWait).toHaveBeenCalledTimes(1);
    expect(backend.getWarmCount()).toBe(0);
    expect(backend.activeSessionCount()).toBe(0);
  });

  it("warm-id is unique per spawn — no collision in the cost tracker", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    await backend.spawnWarm();
    await backend.spawnWarm();
    await backend.spawnWarm();

    const ids = mockRecordSessionStart.mock.calls.map((c) => c[0] as string);
    expect(new Set(ids).size).toBe(3); // all distinct
    for (const id of ids) expect(id).toMatch(/^aci-warm-/);
  });
});
