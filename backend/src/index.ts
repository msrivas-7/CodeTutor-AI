import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { sessionRouter } from "./routes/session.js";
import { createProjectRouter } from "./routes/project.js";
import { createExecutionRouter } from "./routes/execution.js";
import { createExecuteTestsRouter } from "./routes/executeTests.js";
import { aiRouter } from "./routes/ai.js";
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
  app.use(express.json({ limit: "5mb" }));

  // Lightweight request log for session + AI routes so we can trace lifecycle.
  // API keys are never written to logs: `/api/ai/*` bodies are redacted.
  app.use((req, _res, next) => {
    const isSession = req.path.startsWith("/api/session");
    const isExec = req.path === "/api/execute" || req.path === "/api/execute/tests" || req.path === "/api/project/snapshot";
    const isAi = req.path.startsWith("/api/ai");
    if (!isSession && !isExec && !isAi) return next();
    let body = "";
    if (req.path === "/api/session/ping" || isAi) {
      body = "(redacted)";
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

  app.use("/api/session", sessionRouter);
  app.use("/api/project", createProjectRouter(executionBackend));
  // Order matters: /api/execute/tests must be registered before the catch-all
  // /api/execute router (which handles the base path POST /).
  app.use("/api/execute/tests", createExecuteTestsRouter(executionBackend));
  app.use("/api/execute", createExecutionRouter(executionBackend));
  app.use("/api/ai", aiRouter);

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
