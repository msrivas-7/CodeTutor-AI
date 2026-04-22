import { Router, type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { registry } from "../services/metrics.js";
import { config } from "../config.js";

export const metricsRouter = Router();

// Phase 20-P3: `/api/metrics` is no longer world-readable. It leaked
// live session count + per-model token totals (BI + DoS-pressure oracle).
// Access model:
//   - If METRICS_TOKEN is set, require `Authorization: Bearer <token>`
//     (constant-time compare). This is the production path; a scraper
//     outside the VM can reach /metrics only with the token.
//   - If METRICS_TOKEN is unset, accept loopback requests only. Same-host
//     scrapers and `curl` from inside the VM still work; public requests
//     proxied through Caddy (which sets X-Forwarded-For, making req.ip
//     non-loopback because `trust proxy` is 1) get 403. Dev also hits
//     this branch — direct `curl localhost:4000/api/metrics` stays fine.
function gateMetrics(req: Request, res: Response, next: NextFunction) {
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
    return next();
  }
  // Loopback fallback. Express normalises IPv6-mapped IPv4 as "::ffff:127.0.0.1".
  const ip = req.ip ?? "";
  const isLoopback =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLoopback) {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}

// Prom exposition is text/plain; version=0.0.4. Using registry.contentType
// keeps the header in sync if a prom-client upgrade bumps the version.
metricsRouter.get("/", gateMetrics, async (_req, res, next) => {
  try {
    res.setHeader("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    next(err);
  }
});
