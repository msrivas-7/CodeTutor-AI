// Phase 20-P3: /api/metrics gating. The endpoint used to be world-readable,
// leaking live session count + per-model token totals (BI + DoS-pressure
// oracle). It now requires either a Bearer token (when METRICS_TOKEN is
// set) or a loopback caller (when it isn't). These tests lock both branches
// in. The config mock is a getter so individual tests can toggle the token
// without resetting modules.

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const CONFIGURED_TOKEN = "test-metrics-secret";

const mockConfig: { metricsToken: string | undefined } = {
  metricsToken: CONFIGURED_TOKEN,
};

vi.mock("../config.js", () => ({
  get config() {
    return mockConfig;
  },
}));

vi.mock("../services/metrics.js", () => ({
  registry: {
    contentType: "text/plain; version=0.0.4",
    metrics: async () => "# HELP test_metric a fake metric\ntest_metric 1\n",
  },
}));

const { metricsRouter } = await import("./metrics.js");

let srv: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/metrics", metricsRouter);
  await new Promise<void>((resolve) => {
    // Bind to 127.0.0.1 so direct fetches hit the loopback branch when
    // METRICS_TOKEN is unset.
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
});

beforeEach(() => {
  mockConfig.metricsToken = CONFIGURED_TOKEN;
});

describe("GET /api/metrics — token branch (METRICS_TOKEN set)", () => {
  it("401s when Authorization header is missing", async () => {
    const res = await fetch(`${base}/api/metrics`);
    expect(res.status).toBe(401);
  });

  it("401s when Authorization header is the wrong token", async () => {
    const res = await fetch(`${base}/api/metrics`, {
      headers: { Authorization: "Bearer not-the-token" },
    });
    expect(res.status).toBe(401);
  });

  it("401s when Authorization header is not Bearer", async () => {
    const res = await fetch(`${base}/api/metrics`, {
      headers: { Authorization: `Basic ${CONFIGURED_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it("401s on a token with different length without throwing (timingSafeEqual length guard)", async () => {
    // timingSafeEqual throws on mismatched lengths; the handler must length-
    // check first. A short token hits that guard — if this ever becomes a
    // 500 it means the guard regressed and we're leaking via exception type.
    const res = await fetch(`${base}/api/metrics`, {
      headers: { Authorization: "Bearer x" },
    });
    expect(res.status).toBe(401);
  });

  it("200s and returns Prom text when Authorization matches METRICS_TOKEN", async () => {
    const res = await fetch(`${base}/api/metrics`, {
      headers: { Authorization: `Bearer ${CONFIGURED_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain("test_metric 1");
  });
});

describe("GET /api/metrics — loopback branch (METRICS_TOKEN unset)", () => {
  beforeEach(() => {
    mockConfig.metricsToken = undefined;
  });

  it("200s for a loopback caller with no Authorization header", async () => {
    const res = await fetch(`${base}/api/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("test_metric 1");
  });

  it("403s when a non-loopback X-Forwarded-For is presented (trust proxy 1)", async () => {
    const res = await fetch(`${base}/api/metrics`, {
      headers: { "X-Forwarded-For": "203.0.113.42" },
    });
    expect(res.status).toBe(403);
  });
});
