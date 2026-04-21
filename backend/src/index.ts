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
import { feedbackRouter } from "./routes/feedback.js";
import { csrfGuard } from "./middleware/csrfGuard.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
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
  // default-src 'self' + an explicit allowance for the OpenAI endpoint that
  // the backend proxies to (helmet applies CSP only to HTML responses, but
  // if any accidental HTML ever leaks, the browser will refuse third-party
  // script/style/frame loads). Inline styles are permitted because Monaco's
  // themed color tokens are injected via <style> tags at runtime.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", "https://api.openai.com"],
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
      errors?: string[];
      ms?: number;
    } = { ok: true, db: "ok", docker: "ok" };
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
    if (errors.length > 0) result.errors = errors;
    result.ms = Date.now() - start;
    res.status(result.ok ? 200 : 503).json(result);
  });

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
  // AI routes mount their own auth + rate-limit per-route because
  // `/api/ai/validate-key` is public while `/ask`, `/models`, `/summarize`
  // are authenticated. See routes/ai.ts.
  app.use("/api/ai", bodyLimit(1024 * 1024), csrfGuard, aiRouter);

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

  const server = app.listen(config.port, () => {
    console.log(`[startup] backend listening on :${config.port}`);
    console.log(`[startup] cors origin: ${config.corsOrigin}`);
    console.log(`[startup] workspace root (backend): ${config.workspaceRoot}`);
    console.log(`[startup] execution backend: ${executionBackend.kind}`);
  });

  const shutdown = async (signal: string, exitCode: number) => {
    console.log(`[shutdown] received ${signal}`);
    server.close();
    await shutdownAllSessions().catch((e) =>
      console.error("[shutdown] session teardown failed:", e),
    );
    process.exit(exitCode);
  };
  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));

  // Phase 20-P1: catch-all for async errors nothing above caught. Without
  // these, an unhandled dockerode or postgres rejection crashes the VM
  // immediately and orphans running sessions. Log structured, then exit
  // via the shutdown path so `docker compose restart-policy` picks us back
  // up and the next Caddy request just sees a brief 502.
  //
  // These never throw a second time on their own — the handler must be
  // defensive; a panic inside the panic handler would loop.
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    console.error(
      JSON.stringify({ level: "error", t: new Date().toISOString(), err: "unhandledRejection", message }),
    );
    void shutdown("unhandledRejection", 1);
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
