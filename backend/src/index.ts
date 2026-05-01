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
import { adminRouter, adminStatusRouter } from "./routes/admin.js";
import { sharesAuthedRouter, sharesPublicRouter } from "./routes/shares.js";
import { emailRouter } from "./routes/email.js";
import { adminGuard } from "./middleware/adminGuard.js";
import { feedbackRouter } from "./routes/feedback.js";
import { metricsRouter } from "./routes/metrics.js";
import { csrfGuard } from "./middleware/csrfGuard.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
import { aiRateLimit } from "./middleware/aiRateLimit.js";
import { bodyLimit } from "./middleware/bodyLimit.js";
import { requestId } from "./middleware/requestId.js";
import { responseMetrics } from "./middleware/responseMetrics.js";
import { requestLogger } from "./middleware/requestLogger.js";
import {
  adminWriteLimit,
  mutationLimit,
  sessionCreateLimit,
} from "./middleware/mutationRateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { makeExecutionBackend } from "./services/execution/backends/index.js";
import type { ExecutionBackend } from "./services/execution/backends/types.js";
import { db } from "./db/client.js";
import {
  initSessionManager,
  shutdownAllSessions,
  startSweeper,
} from "./services/session/sessionManager.js";
import { startBudgetWatcher } from "./services/budgetWatcher.js";
import { startDigestSweeper } from "./services/email/digestSweeper.js";
import { startInvariantValidator } from "./services/observability/invariantValidator.js";
import { startOrphanShareGc } from "./services/share/orphanShareGc.js";
import { reapAbandonedLessonProgress } from "./db/lessonProgress.js";
import { backendUnhandledRejections } from "./services/metrics.js";
import { startPlatformCostSampler } from "./services/observability/platformCostSampler.js";
import { startCapacityPressureSampler } from "./services/observability/capacityPressureSampler.js";
import { startAciCostSampler } from "./services/observability/aciCostSampler.js";
import { startAciHealthSampler } from "./services/observability/aciHealthSampler.js";
import {
  awaitFirstRefresh as awaitFirstAciOperationalConfigRefresh,
  getAciOperationalConfigRefreshAgeMs,
  startAciOperationalConfigRefresh,
} from "./services/observability/aciOperationalConfig.js";
import { aciCostTracker } from "./services/observability/aciCostTracker.js";
import { startAciWarmPoolService } from "./services/observability/aciWarmPoolService.js";
import type { HybridBackend } from "./services/execution/backends/hybrid.js";
import {
  abortAllInFlight,
  inFlightCount,
} from "./services/shutdown/abortRegistry.js";
import {
  clearPlatformAuthFailed,
  getPlatformAuthStatus,
} from "./services/ai/credential.js";

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
  // Phase 23 P0 #5: increment http_responses_total{status} on every
  // response. Drives the 429+503 error-rate alert. Cheap finish-hook
  // counter; doesn't intercept the response.
  app.use(responseMetrics);

  const {
    backend: executionBackend,
    absoluteSessionCap,
    aci: aciExecutionBackend,
  } = makeExecutionBackend();

  // P2-6 (audit fix): listen-first boot order. Pre-fix, app.listen()
  // ran AFTER awaiting executionBackend.ensureReady() + aciCostTracker
  // .init() + awaitFirstRefresh — a 5+ s window where the port wasn't
  // bound and Azure webtests got connection-refused, tripping the
  // sev-1 availability alert as a false alarm. Now /api/health returns
  // 503 until bootReady flips, which still surfaces as a webtest miss
  // but on a more graceful path (the alert tunes for body content,
  // not raw connectivity, so a 503 with a clear `ready: false` payload
  // is distinguishable from a real outage).
  let bootReady = false;
  app.get("/api/health", (_req, res) => {
    if (!bootReady) {
      return res.status(503).json({ ok: false, ready: false });
    }
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
      // Phase 24B: ACI overflow status. SAME pattern as platformAuth —
      // informational, NOT part of `ok`. ACI being unavailable degrades
      // overflow capacity but doesn't block the primary 14 local slots,
      // so a sev-1 page on this field would be wrong. A separate sev-3
      // log-based alert keys on `aci != "ok"` (slice 5).
      //   "ok"        → ACI is configured + reachable + cost-cap allows spawn
      //   "degraded"  → ACI is configured but currently can't spawn
      //                 (cost cap hit, kill switch on, Azure unreachable)
      //   "disabled"  → ACI is intentionally off (flag=0 or config missing)
      aci: "ok" | "degraded" | "disabled";
      // Phase 24B Slice 6.5: admin observability — current ACI session
      // count + today's spend so the admin panel can render a live
      // "we've spent $X.XX of $Y.YY today" number without a separate
      // round-trip. ALWAYS present (zero when ACI is not wired, so the
      // frontend can treat the shape as stable without conditional
      // branches).
      aciActiveSessions: number;
      aciSpentTodayUsd: number;
      // P0-4 (audit fix): age of the last successful refresh of the
      // ACI operational-config mirror. `null` = no refresh has yet
      // succeeded since boot (watchdog is forcing enabled=false). A
      // value > 150_000 (5 × refresh interval) means the watchdog is
      // active and operator should investigate DB connectivity.
      aciConfigRefreshAgeMs: number | null;
      // P0-2 (second-audit fix): cost-tracker hydration state. When
      // "degraded", init() failed at boot and the cap accumulator is
      // not durable; the kill switch refuses ALL spawns until the
      // backend restarts and re-init succeeds. Operator should fix
      // DB connectivity + restart.
      aciCostTrackerState: "hydrated" | "degraded";
      errors?: string[];
      ms?: number;
    } = {
      ok: true,
      db: "ok",
      docker: "ok",
      platformAuth: "ok",
      aci: "disabled",
      aciActiveSessions: 0,
      aciSpentTodayUsd: 0,
      aciConfigRefreshAgeMs: null,
      aciCostTrackerState: "hydrated",
    };
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
      // ACI status query — only relevant when the backend is the hybrid
      // wrapper. Other backends don't have ACI semantics, so we duck-
      // type on a `getAciStatus` method. Pure read; never throws (the
      // helper itself catches and maps to "degraded").
      (async () => {
        const probe = (
          executionBackend as { getAciStatus?: () => Promise<"ok" | "degraded" | "disabled"> }
        ).getAciStatus;
        if (typeof probe === "function") {
          try {
            result.aci = await probe.call(executionBackend);
          } catch {
            result.aci = "degraded";
          }
        }
        // No getAciStatus → leave default "disabled" (local-only backend).
      })(),
    ]);

    // Phase 24B Slice 6.5: surface live cost telemetry for the admin
    // panel. Always read from the cost tracker — when ACI isn't wired
    // it stays at zero (no recordSessionStart calls ever fire), so the
    // response shape is stable across deployment topologies and the
    // frontend can render the row unconditionally.
    const aciStatus = aciCostTracker.getStatus();
    result.aciActiveSessions = aciStatus.activeSessions;
    result.aciSpentTodayUsd = Number(aciStatus.spentTodayUsd.toFixed(4));
    result.aciConfigRefreshAgeMs = getAciOperationalConfigRefreshAgeMs();
    result.aciCostTrackerState = aciCostTracker.getHydrationState();
    const authStatus = getPlatformAuthStatus();
    if (authStatus) {
      result.platformAuth = "failed";
      result.platformAuthSinceMs = authStatus.sinceMs;
    }
    if (errors.length > 0) result.errors = errors;
    result.ms = Date.now() - start;
    res.status(result.ok ? 200 : 503).json(result);
  });

  // S-3 / QA-C4 / Phase 26 zero-trust: admin break-glass for the
  // platform-auth kill flag.
  //
  // Phase 26 audit C-1: removed the METRICS_TOKEN dual-use that conflated
  // two trust tiers (the Prometheus scraper token shouldn't gate a
  // state-mutating admin endpoint — any party with scraper access could
  // flip the flag). Production-path is the new admin-role-gated
  // POST /api/admin/platform-auth/unstick (see routes/adminPlatformAuth.ts);
  // this endpoint is now LOOPBACK-ONLY and serves the SSH-into-VM
  // break-glass case (admin locked out / JWT expired / dev iteration).
  //
  // Loopback is intrinsically privileged — only someone with shell access
  // to the VM can reach it. No CSRF concern (CSRF assumes browser
  // credential reuse; this endpoint can't be reached from a browser).
  app.post("/api/admin/unstick-platform-auth", (req, res) => {
    const ip = req.ip ?? "";
    const isLoopback =
      ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    if (!isLoopback) {
      return res.status(403).json({
        error: "forbidden",
        hint: "use POST /api/admin/platform-auth/unstick (admin-gated) for non-loopback access",
      });
    }
    const before = getPlatformAuthStatus();
    clearPlatformAuthFailed();
    console.log(
      `[admin] platform-auth kill flag cleared via loopback break-glass` +
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

  // Phase 22D: streak-nudge unsubscribe link target. No csrfGuard, no
  // authMiddleware — a one-click unsubscribe link is opened from
  // a mail client where neither applies. The router owns its own
  // per-IP rate limit and HMAC token verification (see routes/email.ts).
  app.use("/api/email", emailRouter);

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

  // Phase 20-P5: admin status — auth-only, NOT adminGuard'd. Returns
  // { isAdmin: boolean } so the frontend can gate the Admin tab without
  // the user knowing their non-admin status (we always return 200, just
  // with isAdmin=false). Mounted at /api/user so the same middleware
  // chain handles auth + CSRF + body-limit.
  app.use(
    "/api/user",
    bodyLimit(4 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    adminStatusRouter,
  );

  // Phase 20-P5: admin routes — adminGuard required, plus an extra-strict
  // write rate limit (30 writes / 5 min / admin) on top of the standard
  // mutationLimit. Reads (GET /users, /users/:id, /system-config,
  // /audit-log) skip the strict limit so the dashboard's polling doesn't
  // throttle.
  app.use(
    "/api/admin",
    bodyLimit(16 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    adminGuard,
    adminWriteLimit,
    adminRouter,
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

  // Phase 21C: cinematic share. Split-mount: GET /:token is anon-readable
  // (the share artifact is intentionally public) and skips auth + CSRF;
  // POST + DELETE are owner-only and use the standard chain. Public GET
  // is mounted FIRST so Express's path-matching reaches it before the
  // authed router (which would 401 the anon caller).
  app.use(
    "/api/shares",
    bodyLimit(4 * 1024),
    sharesPublicRouter,
  );
  app.use(
    "/api/shares",
    bodyLimit(8 * 1024),
    csrfGuard,
    authMiddleware,
    mutationLimit,
    sharesAuthedRouter,
  );

  app.use(errorHandler);

  // P2-6 (audit fix): bind the listener BEFORE the init awaits so the
  // port is up while Azure webtests probe. /api/health returns 503
  // until bootReady, but the TCP layer responds — distinguishing
  // "still starting up" from a real outage on the alert side.
  const earlyServer = app.listen(config.port, () => {
    console.log(`[startup] backend listening on :${config.port}`);
    console.log(`[startup] cors origin: ${config.corsOrigin}`);
    console.log(`[startup] workspace root (backend): ${config.workspaceRoot}`);
    console.log(`[startup] execution backend: ${executionBackend.kind}`);
  });

  // Backend-specific startup prep (local-docker: resolve host workspace root,
  // verify runner image). Fatal issues throw here; non-fatal are logged
  // and the backend continues.
  try {
    await executionBackend.ensureReady();
  } catch (err) {
    console.error(`[fatal] ${(err as Error).message}`);
    process.exit(1);
  }

  // Phase 24B P0-1: hydrate the ACI cost tracker from its persisted
  // singleton row BEFORE sessions can spawn. Without this, a restart
  // would zero today's accumulator and forget every active session's
  // billable start time — i.e. the daily cap kill-switch could be
  // laundered to $0 by triggering a restart. Only meaningful when the
  // ACI backend is wired; in local-only mode the tracker stays inert.
  if (aciExecutionBackend) {
    await aciCostTracker.init();

    // Phase 24B P0-4: block until the operational-config mirror has
    // round-tripped the system_config DB at least once. Without this
    // there is a window between boot and ~30 s where HybridBackend's
    // kill-switch reads ENV defaults — meaning an admin who set
    // `enabled=false` in DB sees overflow active on every restart.
    // 5 s budget (deliberately generous): if the DB is harder-down
    // than that, the watchdog inside getAciOperationalConfig() takes
    // over and forces `enabled=false` until DB recovers.
    startAciOperationalConfigRefresh();
    const firstRefresh = await awaitFirstAciOperationalConfigRefresh(5_000);
    if (!firstRefresh.ok) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_op_config_first_refresh_timeout",
          msg: "watchdog will force enabled=false until DB responds",
        }),
      );
    }
  }

  initSessionManager(executionBackend, { absoluteSessionCap });
  startSweeper();
  // Bucket 6 (S-12): hourly platform-spend sampler. Emits a structured log
  // line once an hour so the scheduled-query alert in alerts.bicep can
  // detect abnormal bursts (hourly > 2× daily cap) without Log Analytics
  // needing to read Supabase directly. No-ops when free tier is disabled.
  startPlatformCostSampler();
  // Phase 23 P0 #3: capacity-pressure sampler emits one structured log
  // line per minute with session_count + docker_exec depths + render
  // queue depths. The composite scheduled-query alert in alerts.bicep
  // keys off `evt:capacity_pressure`. No DB hit — in-memory reads only.
  startCapacityPressureSampler();
  // Phase 24B: ACI cost emitter. Hourly structured-log emission with
  // today's accrued spend (event-based accounting in aciCostTracker —
  // see services/observability/aciCostTracker.ts for the math). Drives
  // the alerts.bicep scheduled-query rule that pages on `exceeded:true`.
  // Skipped entirely when ACI is not wired (factory returned aci=null).
  if (aciExecutionBackend) {
    startAciCostSampler(aciExecutionBackend);
    // Phase 24B P3-3 + P3-5 (second-audit fix): periodic emitter for
    // counter-drift + watchdog-engaged signals. Both feed scheduled-
    // query alerts in alerts.bicep.
    startAciHealthSampler();
    // Phase 24B P0-4: the operational-config refresh was already started
    // earlier (before initSessionManager) so the first refresh blocks
    // boot. The call here is a no-op (idempotent) but is left documented
    // for the reader following the lifecycle from this anchor.
    // Phase 24B Slice 8: warm-pool service. Pre-spawns 1–2 ACI containers
    // when local capacity is close to its cap so the next overflow user
    // gets a sub-second handoff. Disabled by default (`enabled: false`) —
    // ship the mechanism without paying the steady-state idle cost on
    // launch day. Operator flips `enabled: true` post-launch if cold-
    // start latency surfaces as a real complaint.
    startAciWarmPoolService({
      backend: aciExecutionBackend,
      // executionBackend IS the HybridBackend in this branch (factory
      // returned aci !== null). The cast is safe because factory's
      // return-type contract guarantees: aci !== null ⇒ backend is
      // HybridBackend.
      getLocalActive: () => (executionBackend as HybridBackend).getLocalActive(),
    });
  }
  // Phase 22A: budget watcher fires email alerts at 50/80/100% of the
  // daily $ cap. Polls every 60s, in-memory dedup so each threshold
  // fires once per UTC day. EmailNotConfiguredError is treated as a
  // logged-once-per-day event (dev / first boot without ACS configured).
  startBudgetWatcher();
  // Phase 22D: daily streak-nudge sweeper. Fires at 18:00 UTC; on boot
  // past today's window, fires immediately to catch container restarts
  // (idempotency guard on user_preferences.last_streak_email_sent_at
  // prevents double-sends). No-op in dev when ACS or the unsubscribe
  // secret aren't configured — sweeper logs and returns without sending.
  startDigestSweeper();
  // Phase 23 P0 #4: daily orphan-share-image GC. Fires at 04:00 UTC.
  // Deletes OG/Story PNGs from the share-og bucket for shares older
  // than 90 days with zero views; row stays so the share URL still
  // resolves with a default OG fallback. Bounds storage growth on
  // the Supabase free tier without breaking actively-used shares.
  startOrphanShareGc();
  // Phase 26 (audit SRE F7.1): daily drift check on canonical-vs-derived
  // data sources (admin role mirror, AI cost denorm vs ledger). Every
  // violation lands as `evt:invariant_drift` in Log Analytics; alert
  // wiring TBD (low priority — daily inspection is enough until volume
  // makes a paging rule worthwhile).
  startInvariantValidator();

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

  // P2-6: listener was already bound earlier; alias for the existing
  // shutdown plumbing below. Flip bootReady so /api/health stops
  // returning 503.
  const server = earlyServer;
  bootReady = true;
  console.log(`[startup] boot complete, /api/health now reporting ok`);

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
