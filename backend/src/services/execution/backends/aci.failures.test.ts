// Phase 24B Slice 7: AciExecutionBackend failure paths.
//
// Validates the cleanup contract:
//   - A failed createSession NEVER leaks a partial container group
//     (tryDelete is invoked, even if the group never reached Running)
//   - A failed createSession NEVER pollutes the cost tracker
//     (recordSessionStart only fires after success)
//   - A failed destroy still clears the internal active map so the
//     session can be retried / its capacity reclaimed
//   - isAlive maps any Azure SDK error to "false" — sessionManager's
//     reaper handles the rest
//
// These tests mock @azure/arm-containerinstance + @azure/identity to
// drive the failure modes from the inside. The agent HTTP path uses
// global fetch which we stub per-test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Azure SDK client — every method we use is a `vi.fn()` so the
// test can assert call shape and inject failures.
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

// Mock the cost tracker so we can assert recordSessionStart/End was
// (or was not) called on the failure paths. This is the load-bearing
// security/correctness property — failed creates must not pollute
// the daily-cap accumulator.
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
  // 200 ms cold-start budget keeps each test snappy.
  coldStartTimeoutMs: 200,
  // Agent-ready budget similarly tight so the "sidecar unreachable"
  // failure-path test surfaces in <500ms instead of vitest's 5s timeout.
  agentReadyTimeoutMs: 300,
  // P2-5: skip the post-boot reaper delay so reaper-related tests run
  // synchronously after `ensureReady` resolves.
  orphanReapDelayMs: 0,
};

// listByResourceGroup is an async iterable in the SDK. Build a real one
// so both `iter.next()` (auth probe) and `for await ... of` (P0-3 orphan
// reaper) work against the same mock. Defaults to empty list.
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

function mockListRejects(err: Error): void {
  mockListByResourceGroup.mockReturnValue({
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(err),
      };
    },
    next: () => Promise.reject(err),
  });
}

// Stub global fetch for the agent /health + /fileExists probes that
// AciExecutionBackend.waitForAgent uses. Default: always 200 OK.
// Type loosely — vi.spyOn's inferred type for the parametrized fetch
// signature drifts between vitest minor versions and we don't need the
// type to assert anything specific here.
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

function stubFetchAlwaysFails(err: Error = new Error("ECONNREFUSED")): void {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw err;
  });
}

beforeEach(() => {
  mockBeginCreateOrUpdateAndWait.mockReset();
  mockBeginDeleteAndWait.mockReset();
  mockGet.mockReset();
  mockListByResourceGroup.mockReset();
  mockRecordSessionStart.mockReset();
  mockRecordSessionEnd.mockReset();
  // Default: list-by-rg succeeds (so ensureReady passes) and beginDelete
  // resolves (cleanup never throws unless a test wants it to).
  mockListResolves();
  mockBeginDeleteAndWait.mockResolvedValue(undefined);
});

afterEach(() => {
  fetchSpy?.mockRestore();
});

describe("AciExecutionBackend — failure paths", () => {
  it("createSession failing at beginCreateOrUpdateAndWait calls tryDelete + does NOT pollute cost tracker", async () => {
    mockBeginCreateOrUpdateAndWait.mockRejectedValue(
      new Error("Azure: ConflictError quota exceeded"),
    );
    stubFetchOk(); // unused, but keeps the global stable

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    await expect(
      backend.createSession({ sessionId: "s1" }),
    ).rejects.toThrow(/ConflictError quota exceeded/);

    // Cleanup MUST have been attempted — leaked container groups
    // accrue cost the operator can't see in cost-tracker.
    expect(mockBeginDeleteAndWait).toHaveBeenCalledTimes(1);
    expect(mockBeginDeleteAndWait).toHaveBeenCalledWith(
      "rg-test",
      "codetutor-ai-aci-s1",
    );

    // Cost tracker MUST NOT have been told about this session.
    // recordSessionStart only fires on success.
    expect(mockRecordSessionStart).not.toHaveBeenCalled();
  });

  it("createSession returning no IP triggers cleanup + cost tracker untouched", async () => {
    // ACI returned the container group but with no `ipAddress.ip` —
    // shouldn't happen with a Private IP type, but defending against
    // this is cheap and prevents a NetworkProfileLink edge case from
    // surfacing as an undefined-pointer crash downstream.
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private" },
    });
    stubFetchOk();

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    await expect(
      backend.createSession({ sessionId: "s2" }),
    ).rejects.toThrow(/has no private IP/);

    expect(mockBeginDeleteAndWait).toHaveBeenCalledTimes(1);
    expect(mockRecordSessionStart).not.toHaveBeenCalled();
  });

  it("createSession with sidecar unreachable within budget triggers cleanup", async () => {
    // Container group itself comes up, but the in-runner agent never
    // responds to /health — could be (a) the entrypoint script
    // crashed, (b) the image was tampered post-pull, (c) the network
    // path is broken. Whatever the cause, we abandon the spawn and
    // delete the partial group.
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchAlwaysFails(new Error("ECONNREFUSED"));

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();

    await expect(
      backend.createSession({ sessionId: "s3" }),
    ).rejects.toThrow(/sidecar agent did not respond/);

    expect(mockBeginDeleteAndWait).toHaveBeenCalledTimes(1);
    expect(mockRecordSessionStart).not.toHaveBeenCalled();
  });

  it("createSession success records start in the cost tracker exactly once", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s-ok" });

    expect(handle.sessionId).toBe("s-ok");
    expect(mockRecordSessionStart).toHaveBeenCalledTimes(1);
    expect(mockRecordSessionStart).toHaveBeenCalledWith(
      "s-ok",
      expect.any(Number),
      // P0-2: third arg is the optional reservationId, undefined when
      // getDailyUsdCap isn't wired (test mode).
      undefined,
    );
    // No cleanup on the success path.
    expect(mockBeginDeleteAndWait).not.toHaveBeenCalled();
  });

  it("destroy success records end in the cost tracker", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s-ok" });

    await backend.destroy(handle);
    expect(mockRecordSessionEnd).toHaveBeenCalledTimes(1);
    expect(mockRecordSessionEnd).toHaveBeenCalledWith("s-ok");
    // Active map should be cleared so capacity is reclaimed.
    expect(backend.activeSessionCount()).toBe(0);
  });

  it("destroy with Azure beginDelete failing still clears active map (capacity reclaimed)", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s-x" });
    expect(backend.activeSessionCount()).toBe(1);

    // Cloud-side delete fails. tryDelete swallows + logs (it's
    // best-effort), so destroy should resolve, NOT throw — and the
    // session is gone from the local active map regardless.
    mockBeginDeleteAndWait.mockRejectedValueOnce(new Error("Azure DELETE 504"));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(backend.destroy(handle)).resolves.toBeUndefined();
    expect(backend.activeSessionCount()).toBe(0);
    // The end event still fires — local cost-cap accounting is
    // independent of cloud-side delete success.
    expect(mockRecordSessionEnd).toHaveBeenCalledTimes(1);
    consoleErr.mockRestore();
  });

  it("isAlive returns false on Azure 404 / SDK throw — never throws", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s1" });

    // 404 path — group already deleted, sessionManager will reap.
    mockGet.mockRejectedValueOnce(new Error("ResourceNotFound"));
    expect(await backend.isAlive(handle)).toBe(false);

    // Generic SDK throw — auth blip, region issue. Same answer.
    mockGet.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await backend.isAlive(handle)).toBe(false);
  });

  it("isAlive returns true ONLY when ACI reports Running OR Pending", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s1" });

    // P3-2: clear the alive-cache between probes so each instance-view
    // state actually re-hits ARM. In production the 30s cache is
    // intentional; in this state-transition assertion we want to exercise
    // every code path independently.
    mockGet.mockResolvedValueOnce({ instanceView: { state: "Running" } });
    expect(await backend.isAlive(handle)).toBe(true);
    backend.__clearAliveCacheForTests();
    mockGet.mockResolvedValueOnce({ instanceView: { state: "Pending" } });
    expect(await backend.isAlive(handle)).toBe(true);
    backend.__clearAliveCacheForTests();
    mockGet.mockResolvedValueOnce({ instanceView: { state: "Failed" } });
    expect(await backend.isAlive(handle)).toBe(false);
    mockGet.mockResolvedValueOnce({ instanceView: { state: "Succeeded" } });
    expect(await backend.isAlive(handle)).toBe(false);
    mockGet.mockResolvedValueOnce({}); // no instanceView
    expect(await backend.isAlive(handle)).toBe(false);
  });

  it("ensureReady throws on auth probe failure — surfaced at boot, not at first overflow", async () => {
    mockListRejects(new Error("AADSTS70011: invalid scope"));
    const backend = new AciExecutionBackend(baseOpts);
    await expect(backend.ensureReady()).rejects.toThrow(
      /auth probe failed against rg-test.*invalid scope/,
    );
  });

  it("non-aci handle on every method throws — security check", async () => {
    const backend = new AciExecutionBackend(baseOpts);
    const wrong = { sessionId: "x", __kind: "local-docker" } as never;
    await expect(backend.exec(wrong, "echo", 1000)).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.writeFiles(wrong, [])).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.removeFiles(wrong, ["a"])).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.fileExists(wrong, "a")).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.replaceSnapshot(wrong, [])).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.destroy(wrong)).rejects.toThrow(/expected aci handle/);
    // isAlive accepts a SessionHandle but cast happens before client
    // access; wrong __kind throws the same way.
    await expect(backend.isAlive(wrong)).rejects.toThrow(/expected aci handle/);
  });

  it("exec sends Bearer token + targets the handle's private IP — no cross-session leakage", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.99" },
    });
    // Capture the requests so we can verify URL + auth header per session.
    const captured: Array<{ url: string; auth: string | null }> = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const auth = (init?.headers as Record<string, string> | undefined)
        ?.authorization ?? null;
      captured.push({ url, auth });
      // /exec returns a happy result; /fileExists returns exists:false.
      if (url.endsWith("/exec")) {
        return new Response(
          JSON.stringify({
            stdout: "",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            durationMs: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, exists: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s-1" });

    captured.length = 0;
    await backend.exec(handle, "echo", 1000);

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("http://10.20.2.99:5757/exec");
    // Token format: "Bearer <32-char base64url>". Verify shape, not value.
    expect(captured[0].auth).toMatch(/^Bearer [A-Za-z0-9_-]{32}$/);
  });

  it("queueDepth reflects activeSessionCount; ACI doesn't queue locally", async () => {
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    expect(backend.queueDepth()).toEqual({ inFlight: 0, queued: 0 });
    await backend.createSession({ sessionId: "s1" });
    await backend.createSession({ sessionId: "s2" });
    expect(backend.queueDepth()).toEqual({ inFlight: 2, queued: 0 });
  });

  // ── P0-3: tryDelete budget + boot-time orphan reaper ──────────────

  it("tryDelete waits for the actual ARM delete to complete (no fire-and-forget)", async () => {
    // Drive the destroy path. With beginDeleteAndWait mocked to resolve
    // after a 5ms tick, destroy should not return until that promise
    // settles — proving the await chains all the way through.
    mockBeginCreateOrUpdateAndWait.mockResolvedValue({
      ipAddress: { type: "Private", ip: "10.20.2.5" },
    });
    stubFetchOk();
    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    const handle = await backend.createSession({ sessionId: "s-await" });

    let resolveDelete: () => void = () => {};
    const deleteGate = new Promise<void>((r) => {
      resolveDelete = r;
    });
    mockBeginDeleteAndWait.mockImplementationOnce(async () => {
      await deleteGate;
    });

    let destroyDone = false;
    const destroyPromise = backend.destroy(handle).then(() => {
      destroyDone = true;
    });

    // Yield a tick — destroy should still be pending because the delete
    // gate has not been released. (Pre-fix this would have returned
    // immediately because beginDelete was fire-and-forget.)
    await new Promise((r) => setImmediate(r));
    expect(destroyDone).toBe(false);

    resolveDelete();
    await destroyPromise;
    expect(destroyDone).toBe(true);
  });

  it("reapOrphans deletes every codetutor-ai-aci-* group at boot", async () => {
    // Pre-existing orphans from a prior backend process. ensureReady()
    // discovers + deletes them. This is the post-restart safety net for
    // SIGTERM/OOM/deploy windows where in-process state was lost.
    mockListResolves([
      { name: "codetutor-ai-aci-orphan-1" },
      { name: "codetutor-ai-aci-orphan-2" },
      { name: "unrelated-group" }, // out-of-prefix → not touched
      { name: "codetutor-ai-aci-aci-warm-1700-3" }, // warm-pool slot
    ]);
    let deleteCount = 0;
    const deleted: string[] = [];
    mockBeginDeleteAndWait.mockImplementation(async (rg, name) => {
      deleteCount += 1;
      deleted.push(name);
    });

    const backend = new AciExecutionBackend(baseOpts);
    await backend.ensureReady();
    // Reaper kicks off in the background after ensureReady returns. Give
    // it a few ticks to drain.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }

    expect(deleteCount).toBe(3);
    expect(deleted.sort()).toEqual([
      "codetutor-ai-aci-aci-warm-1700-3",
      "codetutor-ai-aci-orphan-1",
      "codetutor-ai-aci-orphan-2",
    ]);
  });

  it("reapOrphans tolerates a list error — log + skip, doesn't break boot", async () => {
    // listByResourceGroup runs twice during ensureReady: once for the
    // auth probe and once for the reaper. The auth probe needs to
    // succeed; the reap-side enumeration fails. The mock returns an
    // iterable that yields nothing on the first call (auth probe) but
    // throws on the second (reap-side for-await).
    let listCallCount = 0;
    mockListByResourceGroup.mockImplementation(() => {
      listCallCount += 1;
      if (listCallCount === 1) {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => ({ done: true, value: undefined }),
            };
          },
          next: () => Promise.resolve({ done: true, value: undefined }),
        };
      }
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(new Error("ARM 503")),
          };
        },
        next: () => Promise.reject(new Error("ARM 503")),
      };
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const backend = new AciExecutionBackend(baseOpts);
    // ensureReady should resolve cleanly even though the reaper's list
    // call rejects. The reaper is best-effort.
    await expect(backend.ensureReady()).resolves.toBeUndefined();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
