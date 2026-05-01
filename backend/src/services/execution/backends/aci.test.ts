// Phase 24B: AciExecutionBackend basic guards.
//
// Full Azure-driving tests live in slice 7 (failure isolation), where we
// mock @azure/arm-containerinstance + the in-runner agent HTTP server.
// This file covers the no-Azure-needed surface: config validation, handle
// type discrimination, and queueDepth shape.

import { describe, expect, it } from "vitest";
import { AciExecutionBackend } from "./aci.js";

const baseOpts = {
  subscriptionId: "00000000-0000-0000-0000-000000000000",
  resourceGroup: "rg-test",
  location: "eastus2",
  subnetId:
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet/subnets/aci",
  runnerImage: "ghcr.io/example/runner:latest",
  sidecarPort: 5757,
  coldStartTimeoutMs: 30_000,
};

describe("AciExecutionBackend — no-Azure guards", () => {
  it("ensureReady throws with a clear list of missing config fields", async () => {
    const backend = new AciExecutionBackend({
      ...baseOpts,
      subscriptionId: "",
      resourceGroup: "",
      subnetId: "",
      runnerImage: "",
    });
    await expect(backend.ensureReady()).rejects.toThrow(
      /missing required config: subscriptionId, resourceGroup, subnetId, runnerImage/,
    );
  });

  it("ensureReady throws when only some fields are missing", async () => {
    const backend = new AciExecutionBackend({
      ...baseOpts,
      runnerImage: "",
    });
    await expect(backend.ensureReady()).rejects.toThrow(
      /missing required config: runnerImage/,
    );
  });

  it("queueDepth before any session reports zero", () => {
    const backend = new AciExecutionBackend(baseOpts);
    expect(backend.queueDepth()).toEqual({ inFlight: 0, queued: 0 });
  });

  it("activeSessionCount before any session reports zero", () => {
    const backend = new AciExecutionBackend(baseOpts);
    expect(backend.activeSessionCount()).toBe(0);
  });

  it("ping throws when ensureReady has not been called", async () => {
    const backend = new AciExecutionBackend(baseOpts);
    await expect(backend.ping()).rejects.toThrow(/not ready/);
  });

  it("rejects a non-aci handle on exec / writeFiles / destroy", async () => {
    const backend = new AciExecutionBackend(baseOpts);
    const wrongHandle = {
      sessionId: "s1",
      __kind: "local-docker",
    } as never;
    await expect(backend.exec(wrongHandle, "echo", 1000)).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.writeFiles(wrongHandle, [])).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.destroy(wrongHandle)).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.fileExists(wrongHandle, "x")).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.replaceSnapshot(wrongHandle, [])).rejects.toThrow(
      /expected aci handle/,
    );
    await expect(backend.removeFiles(wrongHandle, ["x"])).rejects.toThrow(
      /expected aci handle/,
    );
  });

  it("createSession refuses when ensureReady has not been called", async () => {
    const backend = new AciExecutionBackend(baseOpts);
    await expect(
      backend.createSession({ sessionId: "abc" }),
    ).rejects.toThrow(/backend not ready/);
  });
});
