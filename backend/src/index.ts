import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { sessionRouter } from "./routes/session.js";
import { createProjectRouter } from "./routes/project.js";
import { createExecutionRouter } from "./routes/execution.js";
import { createExecuteTestsRouter } from "./routes/executeTests.js";
import { aiRouter } from "./routes/ai.js";
import { aiRateLimit } from "./middleware/aiRateLimit.js";
import { csrfGuard } from "./middleware/csrfGuard.js";
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
  const app = express();

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
  app.use(express.json({ limit: "5mb" }));

  // Lightweight request log for session + AI routes so we can trace lifecycle.
  // Phase 17 / M-A3: learner code (snapshot files, execute stdin, harness
  // tests) never hits the log as raw text — only shape summaries. AI bodies
  // stay fully redacted (they carry the OpenAI key header).
  app.use((req, _res, next) => {
    const isSession = req.path.startsWith("/api/session");
    const isExec = req.path === "/api/execute" || req.path === "/api/execute/tests";
    const isSnapshot = req.path === "/api/project/snapshot";
    const isAi = req.path.startsWith("/api/ai");
    if (!isSession && !isExec && !isSnapshot && !isAi) return next();
    let body = "";
    if (req.path === "/api/session/ping" || isAi) {
      body = "(redacted)";
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

  // Phase 17: CSRF + per-IP rate limits on every mutating API surface.
  // Session creation gets its own tighter bucket because spawning a runner
  // container is the expensive op. csrfGuard blocks simple cross-origin
  // POSTs from a malicious page the learner happens to visit while the
  // backend is listening on localhost. See middleware/{csrfGuard,mutationRateLimit}.ts.
  app.use("/api/session", csrfGuard, sessionCreateLimit, sessionRouter);
  app.use(
    "/api/project",
    csrfGuard,
    mutationLimit,
    createProjectRouter(executionBackend),
  );
  // Order matters: /api/execute/tests must be registered before the catch-all
  // /api/execute router (which handles the base path POST /).
  app.use(
    "/api/execute/tests",
    csrfGuard,
    mutationLimit,
    createExecuteTestsRouter(executionBackend),
  );
  app.use(
    "/api/execute",
    csrfGuard,
    mutationLimit,
    createExecutionRouter(executionBackend),
  );
  // AI routes get both the per-session throttle (AI-specific budget) AND
  // the CSRF guard. Phase 18 will swap the sid bucket for an authenticated
  // user id.
  app.use("/api/ai", csrfGuard, aiRateLimit, aiRouter);

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
