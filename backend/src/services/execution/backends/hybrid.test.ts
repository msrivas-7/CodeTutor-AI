// Phase 24B: HybridBackend routing tests.
//
// Validates the dispatch logic with mocked underlying backends. We don't
// touch real Docker or Azure here — both ExecutionBackend impls are
// stubbed to record which one received each call.

import { describe, expect, it, vi } from "vitest";
import { HybridBackend } from "./hybrid.js";
import type {
  ExecutionBackend,
  RuntimeSpec,
  SessionHandle,
} from "./types.js";

// ── Test doubles ────────────────────────────────────────────────────

function makeFakeBackend(kind: string): ExecutionBackend & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handles = new Map<string, SessionHandle>();
  return {
    kind,
    calls,
    async ensureReady() {
      calls.push({ method: "ensureReady", args: [] });
    },
    async ping() {
      calls.push({ method: "ping", args: [] });
    },
    async createSession(spec: RuntimeSpec) {
      calls.push({ method: "createSession", args: [spec] });
      const handle: SessionHandle = {
        sessionId: spec.sessionId,
        __kind: kind,
      };
      handles.set(spec.sessionId, handle);
      return handle;
    },
    async isAlive(handle) {
      calls.push({ method: "isAlive", args: [handle] });
      return handles.has(handle.sessionId);
    },
    async destroy(handle) {
      calls.push({ method: "destroy", args: [handle] });
      handles.delete(handle.sessionId);
    },
    async exec(handle, command, timeoutMs, opts) {
      calls.push({ method: "exec", args: [handle, command, timeoutMs, opts] });
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 0 };
    },
    async cancel(handle) {
      calls.push({ method: "cancel", args: [handle] });
    },
    async writeFiles(handle, files) {
      calls.push({ method: "writeFiles", args: [handle, files] });
    },
    async removeFiles(handle, paths) {
      calls.push({ method: "removeFiles", args: [handle, paths] });
    },
    async fileExists(handle, p) {
      calls.push({ method: "fileExists", args: [handle, p] });
      return false;
    },
    async replaceSnapshot(handle, files) {
      calls.push({ method: "replaceSnapshot", args: [handle, files] });
    },
    queueDepth() {
      return { inFlight: 0, queued: 0 };
    },
  };
}

// HybridBackend's `aci` parameter is typed as AciExecutionBackend so a
// raw fake doesn't satisfy it. Cast through `unknown` to suppress that
// — we only exercise the ExecutionBackend surface in these tests, and
// HybridBackend dispatches by handle.__kind regardless of the concrete
// class.
function asAciFake(b: ExecutionBackend): never {
  return b as unknown as never;
}

describe("HybridBackend — routing", () => {
  it("routes cancellation to the backend that owns the handle", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 1, aciCap: 3 });
    const localHandle = await hybrid.createSession({ sessionId: "local" });
    const aciHandle = await hybrid.createSession({ sessionId: "cloud" });

    await hybrid.cancel(localHandle);
    await hybrid.cancel(aciHandle);

    expect(local.calls.filter((call) => call.method === "cancel")).toHaveLength(1);
    expect(aci.calls.filter((call) => call.method === "cancel")).toHaveLength(1);
  });

  it("routes the first N sessions to local until local hits its cap", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 3, aciCap: 36 });

    for (const id of ["s1", "s2", "s3"]) {
      const h = await hybrid.createSession({ sessionId: id });
      expect(h.__kind).toBe("local-docker");
    }
    expect(local.calls.filter((c) => c.method === "createSession")).toHaveLength(3);
    expect(aci.calls.filter((c) => c.method === "createSession")).toHaveLength(0);
  });

  it("routes overflow sessions to ACI once local is at cap", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 2, aciCap: 36 });

    await hybrid.createSession({ sessionId: "s1" });
    await hybrid.createSession({ sessionId: "s2" });
    const h3 = await hybrid.createSession({ sessionId: "s3" });
    const h4 = await hybrid.createSession({ sessionId: "s4" });

    expect(h3.__kind).toBe("aci");
    expect(h4.__kind).toBe("aci");
    expect(local.calls.filter((c) => c.method === "createSession")).toHaveLength(2);
    expect(aci.calls.filter((c) => c.method === "createSession")).toHaveLength(2);
  });

  it("routes back to local when a local session is destroyed below cap", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 2, aciCap: 36 });

    const h1 = await hybrid.createSession({ sessionId: "s1" });
    await hybrid.createSession({ sessionId: "s2" });
    const h3 = await hybrid.createSession({ sessionId: "s3" });
    expect(h3.__kind).toBe("aci");

    // Free a local slot.
    await hybrid.destroy(h1);

    // Next session should land on local again.
    const h4 = await hybrid.createSession({ sessionId: "s4" });
    expect(h4.__kind).toBe("local-docker");
  });

  it("falls back to local when ACI overflow is gated off", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), {
      localCap: 1,
      aciCap: 36,
      isAciOverflowAllowed: () => false,
    });

    const h1 = await hybrid.createSession({ sessionId: "s1" });
    const h2 = await hybrid.createSession({ sessionId: "s2" });
    expect(h1.__kind).toBe("local-docker");
    // ACI gated off → 2nd session also goes to local even though local
    // is already at cap. This is the path that surfaces 503 in
    // sessionManager when `localCap === absoluteSessionCap` (i.e., when
    // ACI is disabled). With ACI on but cost-cap exceeded, this path
    // surfaces the same 503 (cap is at maxGlobal+maxOverflow, local is
    // unhappy at maxGlobal+1 — local backend's own enforcement catches
    // it. Tests above prove the routing; whether local backend rejects
    // is its own concern.).
    expect(h2.__kind).toBe("local-docker");
    expect(aci.calls.filter((c) => c.method === "createSession")).toHaveLength(0);
  });

  it("dispatches exec / writeFiles / fileExists / replaceSnapshot / removeFiles / isAlive on handle.__kind", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 1, aciCap: 36 });

    const localHandle = await hybrid.createSession({ sessionId: "s1" });
    const aciHandle = await hybrid.createSession({ sessionId: "s2" });
    expect(localHandle.__kind).toBe("local-docker");
    expect(aciHandle.__kind).toBe("aci");

    await hybrid.exec(localHandle, "echo", 1000);
    await hybrid.exec(aciHandle, "echo", 1000);
    await hybrid.writeFiles(localHandle, []);
    await hybrid.writeFiles(aciHandle, []);
    await hybrid.fileExists(localHandle, "x");
    await hybrid.fileExists(aciHandle, "x");
    await hybrid.removeFiles(localHandle, ["x"]);
    await hybrid.removeFiles(aciHandle, ["x"]);
    await hybrid.replaceSnapshot(localHandle, []);
    await hybrid.replaceSnapshot(aciHandle, []);
    await hybrid.isAlive(localHandle);
    await hybrid.isAlive(aciHandle);

    const localMethodNames = local.calls.map((c) => c.method);
    const aciMethodNames = aci.calls.map((c) => c.method);
    for (const m of [
      "exec",
      "writeFiles",
      "fileExists",
      "removeFiles",
      "replaceSnapshot",
      "isAlive",
    ]) {
      expect(localMethodNames.filter((n) => n === m)).toHaveLength(1);
      expect(aciMethodNames.filter((n) => n === m)).toHaveLength(1);
    }
  });

  it("destroy decrements the right counter so capacity is reclaimed correctly", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 1, aciCap: 36 });

    const h1 = await hybrid.createSession({ sessionId: "s1" });
    const h2 = await hybrid.createSession({ sessionId: "s2" }); // ACI
    expect(h1.__kind).toBe("local-docker");
    expect(h2.__kind).toBe("aci");

    // Destroy the ACI handle. localActive must remain 1, so the next
    // session still routes to ACI (not local). If destroy decremented
    // the wrong counter, the next session would land on local.
    await hybrid.destroy(h2);
    const h3 = await hybrid.createSession({ sessionId: "s3" });
    expect(h3.__kind).toBe("aci");
  });

  it("effectiveCap returns localCap+aciCap when ACI is healthy + allowed", () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), {
      localCap: 14,
      aciCap: 36,
    });
    expect(hybrid.effectiveCap()).toBe(50);
  });

  it("effectiveCap collapses to localCap when ACI overflow is gated off", () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), {
      localCap: 14,
      aciCap: 36,
      isAciOverflowAllowed: () => false,
    });
    // Cost-cap kill switch tripped → cap shrinks to 14, NOT 50.
    // sessionManager will 503 the 15th request instead of letting it
    // cascade into ACI spawns the kill switch already rejected.
    expect(hybrid.effectiveCap()).toBe(14);
  });

  it("effectiveCap is localCap when ACI is not configured at all", () => {
    const local = makeFakeBackend("local-docker");
    const hybrid = new HybridBackend(local, null, {
      localCap: 14,
      aciCap: 36,
    });
    expect(hybrid.effectiveCap()).toBe(14);
  });

  it("queueDepth sums across local + aci backends", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    // Replace the impls so they report non-zero queue depth
    local.queueDepth = () => ({ inFlight: 3, queued: 2 });
    aci.queueDepth = () => ({ inFlight: 5, queued: 1 });
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 14, aciCap: 36 });
    expect(hybrid.queueDepth()).toEqual({ inFlight: 8, queued: 3 });
  });

  it("getAciStatus reports 'disabled' when no ACI backend is wired", async () => {
    const local = makeFakeBackend("local-docker");
    const hybrid = new HybridBackend(local, null, { localCap: 14, aciCap: 36 });
    expect(await hybrid.getAciStatus()).toBe("disabled");
  });

  it("getAciStatus reports 'degraded' when overflow is gated off", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), {
      localCap: 14,
      aciCap: 36,
      isAciOverflowAllowed: () => false,
    });
    expect(await hybrid.getAciStatus()).toBe("degraded");
  });

  it("getAciStatus reports 'ok' when ACI is wired + allowed + ping succeeds", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 14, aciCap: 36 });
    expect(await hybrid.getAciStatus()).toBe("ok");
  });

  it("getAciStatus reports 'degraded' when ACI ping throws", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    aci.ping = () => Promise.reject(new Error("Azure unreachable"));
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 14, aciCap: 36 });
    expect(await hybrid.getAciStatus()).toBe("degraded");
  });

  it("ping checks LOCAL only (ACI being down doesn't flip /api/health/deep to 503)", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    aci.ping = () => Promise.reject(new Error("Azure unreachable"));
    const hybrid = new HybridBackend(local, asAciFake(aci), { localCap: 14, aciCap: 36 });

    // ping() must NOT throw when ACI is down — only local matters here.
    await expect(hybrid.ping()).resolves.toBeUndefined();
    expect(local.calls.filter((c) => c.method === "ping")).toHaveLength(1);
    // ACI ping is NOT called via .ping(); it's only called via getAciStatus.
    expect(aci.calls.filter((c) => c.method === "ping")).toHaveLength(0);
  });

  it("ensureReady refuses to boot if local is unhealthy but tolerates an ACI failure", async () => {
    const local = makeFakeBackend("local-docker");
    const aci = makeFakeBackend("aci");
    local.ensureReady = () => Promise.reject(new Error("docker socket missing"));
    const hybrid1 = new HybridBackend(local, asAciFake(aci), { localCap: 14, aciCap: 36 });
    await expect(hybrid1.ensureReady()).rejects.toThrow(/docker socket missing/);

    // ACI failing at boot is logged but doesn't stop us booting — local-only
    // is still fully functional.
    const local2 = makeFakeBackend("local-docker");
    const aci2 = makeFakeBackend("aci");
    aci2.ensureReady = () => Promise.reject(new Error("Azure auth failed"));
    const hybrid2 = new HybridBackend(local2, asAciFake(aci2), { localCap: 14, aciCap: 36 });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(hybrid2.ensureReady()).resolves.toBeUndefined();
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});
