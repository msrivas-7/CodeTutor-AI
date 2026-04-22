// Security-posture regressions (Phases 15 + 17). Exercises the guarantees
// that are invisible from the learner UI but easy to silently regress:
//   - AI route rate-limit kicks in once the per-session bucket exhausts.
//   - helmet security headers (CSP, X-Content-Type-Options, Referrer-Policy,
//     X-Frame-Options) are present on backend responses.
//   - The docker-socket-proxy denies every endpoint outside the tight
//     allowlist (CONTAINERS, EXEC, POST). Relies on docker compose being up.
//   - Phase 17: mutating routes require `X-Requested-With: codetutor` and
//     reject cross-origin POSTs missing it. Same routes also have per-IP
//     rate-limits (session create + general mutation buckets).
//
// These tests are intentionally low-level — they use Playwright's
// APIRequestContext / child_process and never drive the browser. Keeping them
// in the E2E suite means they run against the same compose stack that ships
// to production.

import { execFileSync } from "node:child_process";
import { expect, request, test } from "@playwright/test";

const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";

// Phase 17: every mutating request from this file must carry the CSRF token
// header. Pre-Phase-17 tests that POSTed without this header will now 403 —
// the test itself becomes the regression check for the guard.
const CSRF: Record<string, string> = { "X-Requested-With": "codetutor" };

test.describe("security posture", () => {
  // Note: the rate-limit 429 behavior (AI, mutation, session-create) is
  // proven in backend unit tests (middleware/{ai,mutation}RateLimit.test.ts)
  // where we mount fresh middleware against an ephemeral express app and
  // assert behavior with tight limits. Doing the same from E2E poisons the
  // shared 127.0.0.1 bucket for every parallel spec in the run, and the
  // docker-compose config already bumps the bucket sizes (see comments on
  // SESSION_CREATE_RATE_LIMIT_MAX etc.) to never trip under normal learner
  // flow. E2E's security job here is CSRF + headers + proxy allowlist.

  test("helmet security headers are present on backend responses", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BACKEND}/api/health`);
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    // helmet defaults: SAMEORIGIN for X-Frame-Options, no-referrer for Referrer-Policy.
    expect(headers["x-frame-options"]?.toUpperCase()).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBeTruthy();
    // Strict CSP: self default, connect-src locked to self. The backend
    // proxies every OpenAI call so the browser never needs to talk to
    // api.openai.com directly. If this ever loosens, the snapshot fails and
    // the author has to justify the widening.
    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("api.openai.com");
    expect(csp).toContain("frame-ancestors 'none'");

    await ctx.dispose();
  });

  test("CSRF guard rejects mutating requests missing X-Requested-With", async () => {
    // Phase 17 / H-A3. A cross-origin POST from a malicious page the learner
    // happens to visit (backend listens on localhost) would be a simple
    // request the browser sends without preflight — unless the caller sets
    // a non-safe header. We require `X-Requested-With: codetutor`, which
    // forces preflight and lets CORS reject the origin.
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/session`, {
      data: {},
      failOnStatusCode: false,
    });
    await ctx.dispose();
    expect(res.status(), "POST /api/session without CSRF header must 403").toBe(403);
  });

  test("CSRF guard rejects mutating requests with a foreign Origin", async () => {
    // Belt + suspenders: even if an attacker somehow sends the custom header
    // (e.g. via an extension), the Origin must match `config.corsOrigin`.
    // Missing Origin is OK (same-origin fetch from the app), but an explicit
    // foreign origin is rejected.
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/session`, {
      data: {},
      headers: { ...CSRF, Origin: "http://evil.example.com" },
      failOnStatusCode: false,
    });
    await ctx.dispose();
    expect(res.status(), "POST /api/session from foreign Origin must 403").toBe(403);
  });

  // Note: the mutating per-IP rate-limits (session create + snapshot/execute)
  // are *not* exercised from E2E. E2E runs share a single 127.0.0.1 bucket,
  // so burning it down from one spec would 429-poison every other test in
  // the run. The same assertion lives in backend unit tests where the
  // middleware runs in-process against supertest.

  test("docker-socket-proxy denies endpoints outside the allowlist", async () => {
    // This test proves Phase 14b's allowlist. We exec inside the backend
    // container (the only thing on the internal compose network that can
    // reach socket-proxy:2375) and probe both an allowed and a denied
    // endpoint. Denied endpoints must 403; the allowed one must succeed.
    // If docker compose isn't up (dev running backend bare-metal), skip.
    let allowedStatus: number | null = null;
    let deniedNetworksStatus: number | null = null;
    let deniedVolumesStatus: number | null = null;
    try {
      allowedStatus = probeSocketProxyStatus("/containers/json");
      // /networks and /volumes are outside the allowlist (no NETWORKS=1 /
      // VOLUMES=1 in compose) so the proxy must 403 both.
      deniedNetworksStatus = probeSocketProxyStatus("/networks");
      deniedVolumesStatus = probeSocketProxyStatus("/volumes");
    } catch (err) {
      test.skip(
        true,
        `docker compose exec unavailable — skipping socket-proxy assertions: ${String(err)}`,
      );
      return;
    }

    expect(allowedStatus, "/containers/json should be allowlisted").toBe(200);
    expect(deniedNetworksStatus, "/networks should be denied by allowlist").toBe(403);
    expect(deniedVolumesStatus, "/volumes should be denied by allowlist").toBe(403);
  });
});

// Runs a short node one-liner inside the backend container that issues an
// HTTP GET to socket-proxy:2375 and prints the status code. We use node
// because the backend image is slim node:20-alpine-sans-curl.
function probeSocketProxyStatus(path: string): number {
  const script =
    `const http=require("node:http");` +
    `http.get({host:"socket-proxy",port:2375,path:${JSON.stringify(path)}},` +
    `r=>{console.log(r.statusCode);r.resume();})` +
    `.on("error",e=>{console.log("err:"+e.message);process.exit(2);});`;
  const out = execFileSync(
    "docker",
    ["compose", "exec", "-T", "backend", "node", "-e", script],
    { encoding: "utf8", timeout: 15_000 },
  ).trim();
  const code = Number(out);
  if (!Number.isFinite(code)) {
    throw new Error(`unexpected socket-proxy probe output: ${out}`);
  }
  return code;
}
