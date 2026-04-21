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
import { csrfGuard } from "./middleware/csrfGuard.js";
import { authMiddleware } from "./middleware/authMiddleware.js";
import { bodyLimit } from "./middleware/bodyLimit.js";
import {
  mutationLimit,
  sessionCreateLimit,
} from "./middleware/mutationRateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { makeExecutionBackend } from "./services/execution/backends/index.js";
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

  // Lightweight request log for session + AI routes so we can trace lifecycle.
  // Phase 17 / M-A3: learner code (snapshot files, execute stdin, harness
  // tests) never hits the log as raw text — only shape summaries. AI bodies
  // stay fully redacted (they carry the OpenAI key header).
  app.use((req, _res, next) => {
    const isSession = req.path.startsWith("/api/session");
    const isExec = req.path === "/api/execute" || req.path === "/api/execute/tests";
    const isSnapshot = req.path === "/api/project/snapshot";
    const isAi = req.path.startsWith("/api/ai");
    const isUser = req.path.startsWith("/api/user");
    if (!isSession && !isExec && !isSnapshot && !isAi && !isUser) return next();
    let body = "";
    if (req.path === "/api/session/ping" || isAi) {
      body = "(redacted)";
    } else if (isUser) {
      // Shape-only: never log learner code or openai keys stored in prefs.
      body = req.method === "GET" ? "(get)" : `(${req.method.toLowerCase()})`;
    } else if (isSnapshot) {
      const files = (req.body?.files as unknown[] | undefined) ?? [];
      body = JSON.stringify({
        sessionId: req.body?.sessionId,
        files: files.length,
      });
    } else if (req.path === "/api/execute") {
      const stdin = (req.body?.stdin as string | null | undefined) ?? null;
      body = JSON.stringify({
        sessionId: req.body?.sessionId,
        language: req.body?.language,
        stdin: stdin === null ? null : `<${stdin.length} chars>`,
      });
    } else if (req.path === "/api/execute/tests") {
      const tests = (req.body?.tests as unknown[] | undefined) ?? [];
      body = JSON.stringify({
        sessionId: req.body?.sessionId,
        language: req.body?.language,
        tests: tests.length,
      });
    } else {
      body = JSON.stringify(req.body ?? {});
    }
    console.log(`[req] ${req.method} ${req.path} ${body}`);
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  const executionBackend = makeExecutionBackend();

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

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}`);
    server.close();
    await shutdownAllSessions();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
