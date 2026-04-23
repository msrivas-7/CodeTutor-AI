import type { NextFunction, Request, Response } from "express";
import { hashUserId } from "../services/crypto/logHash.js";

// Phase 20-P1: single JSON-lines logger for every API request. Runs AFTER
// requestId + authMiddleware so the log line carries both `id` and
// `userId`. Logs on response finish so we have the final status + duration.
//
// Payloads are deliberately NOT logged here — body shape was already
// summarized by the legacy [req] preflight. Once everything migrates to
// this logger, the preflight is gone and bodies stay out of stdout entirely
// (correct posture for learner code + AI prompts + the OpenAI key header).

// A handful of paths are hit on every tick — ping, health — and would
// drown out the signal if logged. Silent for these.
const SILENT_PATHS = new Set<string>([
  "/api/session/ping",
  "/api/health",
  "/api/health/deep",
]);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (SILENT_PATHS.has(req.path)) {
    next();
    return;
  }
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const entry = {
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      t: new Date().toISOString(),
      id: req.id,
      // P-12: hashed so a log-stream leak doesn't expose a join key back to
      // the user row. Keep the field name for grep compatibility with
      // existing dashboards; values are HMAC-derived per-deploy.
      userId: hashUserId(req.userId),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
    };
    try {
      process.stdout.write(JSON.stringify(entry) + "\n");
    } catch {
      // stdout.write can throw when the stream is full; swallow so logging
      // never crashes a request. A dropped log line beats a dropped response.
    }
  });
  next();
}
