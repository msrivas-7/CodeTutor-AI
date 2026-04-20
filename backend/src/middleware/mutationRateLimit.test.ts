import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Phase 17 / H-A2: the exported `mutationLimit` and `sessionCreateLimit` in
// mutationRateLimit.ts read their thresholds from `config` at module-load
// time, which means the production defaults are baked in. Unit-testing the
// real instances would need us to burn through hundreds of requests per
// test. Instead, we verify the *shape* of the guard — a freshly-constructed
// `rateLimit()` with the same options (per-IP key, 429 JSON response, short
// window) behaves the way we expect. If the real instances diverge from
// that shape (different keyGenerator, wrong status, etc.) the assertion
// needs to be re-evaluated at the call sites.

function testApp(limit: number) {
  const app = express();
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit,
      keyGenerator: (req: import("express").Request) =>
        `ip:${ipKeyGenerator(req.ip ?? "")}`,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests; slow down." },
    }),
  );
  app.post("/probe", (_req, res) => res.json({ ok: true }));
  return app;
}

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            srv.close(() => r());
          }),
      });
    });
  });
}

describe("mutation rate-limit shape", () => {
  let srv: { url: string; close: () => Promise<void> } | null = null;
  beforeEach(() => {
    srv = null;
  });
  afterEach(async () => {
    if (srv) await srv.close();
  });

  it("returns 429 once the per-IP bucket exhausts", async () => {
    srv = await listen(testApp(5));
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${srv.url}/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      statuses.push(res.status);
    }
    // First 5 are allowed, the rest 429. Allow for small fuzz in the library's
    // counting but require at least one 429 before the 7th request.
    const firstRateLimit = statuses.findIndex((s) => s === 429);
    expect(firstRateLimit).toBeGreaterThan(-1);
    expect(firstRateLimit).toBeLessThanOrEqual(6);
    // And the very last request in the burst must be 429.
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it("429 response body carries the user-visible message", async () => {
    srv = await listen(testApp(1));
    await fetch(`${srv.url}/probe`, { method: "POST" });
    const res = await fetch(`${srv.url}/probe`, { method: "POST" });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/too many/i);
  });
});
