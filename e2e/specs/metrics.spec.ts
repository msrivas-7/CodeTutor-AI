// Phase 20-P2: /api/metrics Prometheus exposition. Backend-direct checks
// against the compose stack — no browser. The unit-level tests in
// backend/src/services/metrics.test.ts prove the formatter; this spec
// locks in the cross-cutting properties a unit test can't catch:
//   - the endpoint is mounted and reachable without auth (a future refactor
//     that accidentally wraps it in authMiddleware would silently break
//     any Prom scraper);
//   - content-type is the Prom exposition format;
//   - the three expected metric names are present in the live output.

import { expect, request, test } from "@playwright/test";

const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";

test.describe("metrics endpoint", () => {
  test("/api/metrics is public and returns Prometheus text format", async () => {
    const ctx = await request.newContext();
    // No Authorization header, no CSRF — if this 401s or 403s, the mount
    // order regressed (should sit before the auth chain, like /api/health).
    const res = await ctx.get(`${BACKEND}/api/metrics`);
    expect(res.status()).toBe(200);

    const ctype = res.headers()["content-type"] ?? "";
    // prom-client sets `text/plain; version=0.0.4; charset=utf-8` — we only
    // pin the two pieces that matter: media type + Prom format version.
    expect(ctype).toContain("text/plain");
    expect(ctype).toContain("version=0.0.4");

    const body = await res.text();
    // The three metric declarations from backend/src/services/metrics.ts.
    expect(body).toMatch(/^# TYPE session_count gauge$/m);
    expect(body).toMatch(/^# TYPE ai_tokens_consumed_total counter$/m);
    expect(body).toMatch(/^# TYPE exec_duration_seconds histogram$/m);
    // Gauge is emitted on every scrape via its collect hook — its value is
    // always present (even with zero sessions), so seeing just the TYPE
    // line without a sample would mean the collect hook is broken.
    expect(body).toMatch(/^session_count \d+(\.\d+)?$/m);

    await ctx.dispose();
  });
});
