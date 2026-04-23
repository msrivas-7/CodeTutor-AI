import express from "express";
import cors from "cors";
import helmet from "helmet";
import { assertConfigValid, config } from "./config.js";
import { sessionRouter } from "./routes/session.js";
import { createProjectRouter } from "./routes/project.js";
import { createExecutionRouter } from "./routes/execution.js";
import { createExecuteTestsRouter } from "./routes/executeTests.js";
import { aiRouter } from "./routes/ai.js";
import { userDataRouter } from "./routes/userData.js";
import { aiStatusRouter } from "./routes/aiStatus.js";
import { feedbackRouter } from "./routes/feedback.js";
import { metricsRouter } from "./routes/metrics.js";
import { csrfGuard } from "./middleware/csrfGuard.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
import { aiRateLimit } from "./middleware/aiRateLimit.js";
import { bodyLimit } from "./middleware/bodyLimit.js";
import { requestId } from "./middleware/requestId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import {
  mutationLimit,
  sessionCreateLimit,
} from "./middleware/mutationRateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { makeExecutionBackend } from "./services/execution/backends/index.js";
import type { ExecutionBackend } from "./services/execution/backends/types.js";
import { db } from "./db/client.js";
import {
  initSessionManager,
  startSweeper,
  shutdownAllSessions,
} from "./services/session/sessionManager.js";
import { reapAbandonedLessonProgress } from "./db/lessonProgress.js";
import { backendUnhandledRejections } from "./services/metrics.js";
import { startPlatformCostSampler } from "./services/observability/platformCostSampler.js";
import {
  abortAllInFlight,
  inFlightCount,
} from "./services/shutdown/abortRegistry.js";
import {
  clearPlatformAuthFailed,
  getPlatformAuthStatus,
} from "./services/ai/credential.js";
import { timingSafeEqual } from "node:crypto";

async function main() {
  // Validate env-sourced config before any wiring. Prefer a loud, fast failure
  // at boot over silent fallbacks that show up as 401/500 on the first request.
  assertConfigValid();

  const app = express();

  // Phase 20-P1: trust the single Caddy hop in front of us. Without this,
  // req.ip is always 127.0.0.1 (the proxy) so every IP-keyed rate limit —
  // aiRateLimit, mutationRateLimit — collapses into one global bucket and
  // stops defending against DoS. `1` means "trust exactly one hop" (Caddy);
  // we don't want "true" because that would let any client spoof
  // X-Forwarded-For. In dev (no proxy), req.ip correctly falls through to
  // the socket source.
  app.set("trust proxy", 1);

  app.use(cors({ origin: config.corsOrigin }));
  // Defense-in-depth security headers: X-Content-Type-Options, Referrer-Policy,
  // X-Frame-Options, no-store on sensitive responses, etc. CSP is a strict
  // default-src 'self'; the backend proxies every OpenAI call, so the browser
  // never needs to connect to api.openai.com directly — it used to be in
  // connect-src by accident. Inline styles are permitted because Monaco's
  // themed color tokens are injected via <style> tags at runtime.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  // Phase 20-P1: drop the global json cap from 5 MB to 1 MB (the largest any
  // route legitimately needs — editor-project has a 500 KB internal cap;
  // AI requests carry history + context). Per-router we enforce a tighter
  // Content-Length precheck so a caller can't, e.g., POST 900 KB to
  // /api/session. The precheck fires before json parses bytes, so the
  // rejection is cheap even under abuse.
  app.use(express.json({ limit: "1mb" }));

  // Phase 20-P1: correlation id + structured completion log. Order matters —
  // requestId sets req.id before anything else (including errorHandler)
  // might want to reference it; requestLogger's finish hook runs after the
  // response body is sent so it captures the final status + duration.
  app.use(requestId);
  app.use(requestLogger);

  const executionBackend = makeExecutionBackend();

  app.get("/api/health", (_req, res) => {
    // Trimmed to `{ ok: true }` — no process.uptime leak (Phase 20-P2 nit).
    res.json({ ok: true });
  });

  // Phase 20-P1: deep probe for alerting. Touches both downstream dependencies
  // the backend cannot function without — Postgres (user state, BYOK
  // ciphertext) and the docker socket-proxy (every session spawn). Any
  // failure returns 503 so the VM-level alert fires before learners see the
  // backend try-and-fail to create a session. `/api/health` remains the
  // cheap "process is alive" probe; this one is deliberately heavier and
  // should be polled less often.
  app.get("/api/health/deep", async (_req, res) => {
    const start = Date.now();
    const result: {
      ok: boolean;
      db: "ok" | "fail";
      docker: "ok" | "fail";
      // S-3: carry the platform-auth kill-flag state. Separate field from
      // `ok` so a dead platform key doesn't flip the probe to 503 — that
      // would page oncall for what is actually "free tier is paused." A
      // dedicated scheduled-query alert (bucket 6) watches this field.
      platformAuth: "ok" | "failed";
      platformAuthSinceMs?: number;
      errors?: string[];
      ms?: number;
    } = { ok: true, db: "ok", docker: "ok", platformAuth: "ok" };
    const errors: string[] = [];
    await Promise.all([
      (async () => {
        try {
          await db()`SELECT 1`;
        } catch (err) {
          result.db = "fail";
          result.ok = false;
          errors.push(`db: ${(err as Error).message}`);
        }
      })(),
      (async () => {
        try {
          await executionBackend.ping();
        } catch (err) {
          result.docker = "fail";
          result.ok = false;
          errors.push(`docker: ${(err as Error).message}`);
        }
      })(),
    ]);
    const authStatus = getPlatformAuthStatus();
    if (authStatus) {
      result.platformAuth = "failed";
      result.platformAuthSinceMs = authStatus.sinceMs;
    }
    if (errors.length > 0) result.errors = errors;
    result.ms = Date.now() - start;
    res.status(result.ok ? 200 : 503).json(result);
  });

  // S-3 / QA-C4: admin break-glass. When operator rotates the platform key
  // after a 401, the kill flag stays on until the 30-min probe window
  // elapses — this endpoint lets them clear it immediately. Gated on
  // METRICS_TOKEN (same posture as /api/metrics); no token → loopback only.
  // On success the next /api/ai/ask will attempt upstream normally.
  app.post("/api/admin/unstick-platform-auth", (req, res) => {
    const expected = config.metricsToken;
    if (expected && expected.length > 0) {
      const header = req.headers.authorization ?? "";
      const prefix = "Bearer ";
      if (!header.startsWith(prefix)) {
        return res.status(401).json({ error: "unauthorized" });
      }
      const provided = header.slice(prefix.length);
      const providedBuf = Buffer.from(provided);
      const expectedBuf = Buffer.from(expected);
      if (
        providedBuf.length !== expectedBuf.length ||
        !timingSafeEqual(providedBuf, expectedBuf)
      ) {
        return res.status(401).json({ error: "unauthorized" });
      }
    } else {
      const ip = req.ip ?? "";
      const isLoopback =
        ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
      if (!isLoopback) return res.status(403).json({ error: "forbidden" });
    }
    const before = getPlatformAuthStatus();
    clearPlatformAuthFailed();
    console.log(
      `[admin] platform-auth kill flag cleared` +
        (before ? ` (was failing for ${before.sinceMs}ms)` : " (was already ok)"),
    );
    res.json({ ok: true, wasFailed: !!before });
  });

  // Phase 20-P2: Prometheus exposition. Phase 20-P3 gate: router enforces
  // either `Authorization: Bearer ${METRICS_TOKEN}` (when that env is set)
  // or loopback-only (when it isn't). Mounted before the auth/csrf chain
  // because Prom scrapers can't carry a Supabase JWT — the router owns its
  // own auth story. See routes/metrics.ts for the rationale.
  app.use("/api/metrics", metricsRouter);

  // Middleware chain per route group (Phase 18a):
  //
  //   csrfGuard       — cheap header check; rejects cross-origin POSTs
  //                     missing X-Requested-With (Phase 17).
  //   authMiddleware  — verifies the Supabase JWT, attaches req.userId.
  //                     Runs BEFORE any rate limit so (a) unauthenticated
  //                     garbage can't eat the IP bucket for real users and
  //                     (b) user-keyed buckets downstream see req.userId.
  //   sessionCreateLimit — floor on /api/session container spawns. Keyed
  //                     off userId when present (set by authMiddleware);
  //                     falls back to IP for the unauthenticated edge case
  //                     that shouldn't actually reach here.
  //   mutationLimit   — user-keyed throttle on non-session-create writes.
  //
  // `/api/health` stays public (no csrf/auth). `/api/ai/validate-key` is
  // a special public carve-out handled inside aiRouter — a learner can
  // test their OpenAI key before finishing signup; see routes/ai.ts.
  app.use(
    "/api/session",
    bodyLimit(64 * 1024),
    csrfGuard,
    authMiddleware,
    sessionCreateLimit,
    sessionRouter,
  );
  app.use(
    "/api/project",
    bodyLimit(512 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    createProjectRouter(executionBackend),
  );
  // Order matters: /api/execute/tests must be registered before the catch-all
  // /api/execute router (which handles the base path POST /).
  app.use(
    "/api/execute/tests",
    bodyLimit(512 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    createExecuteTestsRouter(executionBackend),
  );
  app.use(
    "/api/execute",
    bodyLimit(512 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    createExecutionRouter(executionBackend),
  );
  // All AI routes are authenticated (validate-key included, per routes/ai.ts
  // comment on the `authed` guard). Lift authMiddleware + aiRateLimit to the
  // router mount so that unknown subpaths (`/api/ai/foo`) still pay the same
  // rate-limit price and can't be used to probe auth state for free.
  // /validate-key gets an extra sub-bucket inside aiRouter.
  app.use(
    "/api/ai",
    bodyLimit(1024 * 1024),
    csrfGuard,
    authMiddleware,
    aiRateLimit,
    aiRouter,
  );

  // Phase 18b: per-user state in Supabase Postgres (preferences, progress,
  // editor project). Auth + rate-limit gated; all DB writes scope by
  // req.userId, RLS enforces the same as defense-in-depth.
  app.use(
    "/api/user",
    bodyLimit(1024 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    userDataRouter,
  );

  // Phase 20-P4: /ai-status, /ai-exhaustion-click, /paid-access-interest.
  // Small surface; reuses the same middleware chain as /api/user.
  app.use(
    "/api/user",
    bodyLimit(4 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    aiStatusRouter,
  );

  // Phase 20-P1: user-reported feedback (bug / idea / other + opt-in
  // diagnostics). Same middleware stack as /api/user — authed, mutation-
  // limited, 16 KB body (4 KB text + 8 KB diag + slack).
  app.use(
    "/api/feedback",
    bodyLimit(16 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    feedbackRouter,
  );

  app.use(errorHandler);

  // Backend-specific startup prep (local-docker: resolve host workspace root,
  // verify runner image). Fatal issues throw here; non-fatal are logged
  // and the backend continues.
  try {
    await executionBackend.ensureReady();
  } catch (err) {
    console.error(`[fatal] ${(err as Error).message}`);
    process.exit(1);
  }

  initSessionManager(executionBackend);
  startSweeper();
  // Bucket 6 (S-12): hourly platform-spend sampler. Emits a structured log
  // line once an hour so the scheduled-query alert in alerts.bicep can
  // detect abnormal bursts (hourly > 2× daily cap) without Log Analytics
  // needing to read Supabase directly. No-ops when free tier is disabled.
  startPlatformCostSampler();

  // QA-M4: hourly reap of abandoned lesson_progress rows. A drive-by URL
  // visit calls startLesson, which writes an in_progress row even when the
  // learner never engages. Left unreaped these ghosts silently self-unlock
  // prereq-locked lessons on the learner's next visit (the guard reads
  // existingStatus='in_progress' and skips the bounce). One-shot now so a
  // backend restart purges promptly, then every hour. All zero-engagement
  // rows older than 24h get deleted — see reapAbandonedLessonProgress
  // for the conservative WHERE clause.
  const LESSON_REAP_MS = 60 * 60 * 1000;
  void reapAbandonedLessonProgress()
    .then((n) => {
      if (n) console.log(`[lesson-reaper] purged ${n} abandoned in_progress row(s) on startup`);
    })
    .catch((err) => console.error("[lesson-reaper] startup sweep failed:", err));
  const lessonReaper = setInterval(() => {
    void reapAbandonedLessonProgress()
      .then((n) => {
        if (n) console.log(`[lesson-reaper] purged ${n} abandoned in_progress row(s)`);
      })
      .catch((err) => console.error("[lesson-reaper] sweep failed:", err));
  }, LESSON_REAP_MS);
  lessonReaper.unref?.();

  const server = app.listen(config.port, () => {
    console.log(`[startup] backend listening on :${config.port}`);
    console.log(`[startup] cors origin: ${config.corsOrigin}`);
    console.log(`[startup] workspace root (backend): ${config.workspaceRoot}`);
    console.log(`[startup] execution backend: ${executionBackend.kind}`);
  });

  // S-13 (bucket 7): bounded shutdown grace so in-flight SSE handlers get a
  // chance to flush their ledger row before we tear runners down. Flow:
  //   1. server.close() stops accepting new connections.
  //   2. abortAllInFlight() fires AbortError on every registered controller
  //      — the openai stream rejects, ai.ts's `safeWriteUsage` writes a
  //      `status: "aborted"` row, then `cleanup()` unregisters.
  //   3. Poll inFlightCount() every 100 ms up to SHUTDOWN_GRACE_MS. This is
  //      short enough to beat systemd's default TimeoutStopSec (90 s) and
  //      long enough for a typical ledger round-trip (~1 s Supabase + HTTP).
  //   4. Tear sessions + exit.
  const SHUTDOWN_GRACE_MS = 30_000;
  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}`);
    server.close();
    const aborted = abortAllInFlight(`shutdown:${signal}`);
    if (aborted > 0) {
      console.log(`[shutdown] aborting ${aborted} in-flight stream(s); grace ${SHUTDOWN_GRACE_MS} ms`);
      const deadline = Date.now() + SHUTDOWN_GRACE_MS;
      while (inFlightCount() > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const remaining = inFlightCount();
      if (remaining > 0) {
        console.warn(`[shutdown] grace expired; ${remaining} stream(s) did not flush`);
      } else {
        console.log(`[shutdown] all streams flushed in ${SHUTDOWN_GRACE_MS - (deadline - Date.now())} ms`);
      }
    }
    await shutdownAllSessions().catch((e) =>
      console.error("[shutdown] session teardown failed:", e),
    );
    process.exit(exitCode);
  };
  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));

  // Phase 20-P3: unhandledRejection is log-and-continue, not fatal. Prior
  // behavior (process.exit(1)) was net-negative: one stray unawaited promise
  // — even in a non-load-bearing path — took the backend down, and
  // `restart: unless-stopped` brought it back only to catch the same
  // rejection seconds later, yielding a crashloop that cost learners their
  // in-flight sessions. A rejection represents an async error we failed to
  // attach a `.catch` to; it does NOT necessarily mean heap corruption or
  // an invariant break. Log it structured (so the restart-count alert can
  // pick it up if it IS looping) and keep serving.
  //
  // uncaughtException stays fatal. A synchronous throw that propagated all
  // the way to the event-loop top is a much stronger signal that an
  // invariant is broken — continuing risks serving torn state.
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    backendUnhandledRejections.inc();
    console.error(
      JSON.stringify({ level: "error", t: new Date().toISOString(), err: "unhandledRejection", message }),
    );
  });
  process.on("uncaughtException", (err) => {
    console.error(
      JSON.stringify({ level: "error", t: new Date().toISOString(), err: "uncaughtException", message: err.stack ?? err.message }),
    );
    void shutdown("uncaughtException", 1);
  });
}

// Module re-exports for tests that need to build a deep-health probe
// against a mock backend without pulling all of main().
export type { ExecutionBackend };

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
