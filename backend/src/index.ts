import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { sessionRouter } from "./routes/session.js";
import { projectRouter } from "./routes/project.js";
import { executionRouter } from "./routes/execution.js";
import { executeTestsRouter } from "./routes/executeTests.js";
import { aiRouter } from "./routes/ai.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { ensureRunnerImage, resolveHostWorkspaceRoot } from "./services/docker/dockerService.js";
import { startSweeper, shutdownAllSessions } from "./services/session/sessionManager.js";

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

  app.use("/api/session", sessionRouter);
  app.use("/api/project", projectRouter);
  // Order matters: /api/execute/tests must be registered before the catch-all
  // /api/execute router (which handles the base path POST /).
  app.use("/api/execute/tests", executeTestsRouter);
  app.use("/api/execute", executionRouter);
  app.use("/api/ai", aiRouter);

  app.use(errorHandler);

  // Discover the host-side path that backs our /workspace-root mount before
  // anything that could spawn a sibling container runs. This is required for
  // cross-platform support (macOS/Linux/Windows): the host path format
  // differs by OS, but Docker itself tells us what to use.
  let hostWorkspaceRoot: string;
  try {
    hostWorkspaceRoot = await resolveHostWorkspaceRoot();
    console.log(`[startup] host workspace root: ${hostWorkspaceRoot}`);
  } catch (err) {
    console.error(`[fatal] ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    await ensureRunnerImage();
    console.log(`[startup] runner image ready: ${config.runnerImage}`);
  } catch (err) {
    console.warn(`[startup] ${(err as Error).message}`);
    console.warn("[startup] backend will continue; session creation will fail until the image exists.");
  }

  startSweeper();

  const server = app.listen(config.port, () => {
    console.log(`[startup] backend listening on :${config.port}`);
    console.log(`[startup] cors origin: ${config.corsOrigin}`);
    console.log(`[startup] workspace root (backend): ${config.workspaceRoot}`);
    console.log(`[startup] workspace root (host):    ${hostWorkspaceRoot}`);
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
