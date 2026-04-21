import type { Request, Response, NextFunction } from "express";

/**
 * Phase 20-P1: per-router Content-Length cap.
 *
 * Every route group has a realistic upper bound on request body size
 * (driven by the internal zod ceilings: 64 KB for session create, 512 KB
 * for execute/exec-tests/project snapshot, 1 MB for AI context and editor
 * projects). The global `express.json({ limit: "1mb" })` catches anything
 * that slips past — this precheck just makes the rejection cheap and
 * specific, and tightens the effective DoS surface per-route.
 *
 * Trust note: we read `req.headers["content-length"]`. Callers can lie
 * (send a small value, stream more bytes), but express.json's own limit is
 * the ceiling of last resort; this middleware only exists to let us 413
 * early on honestly-declared oversize posts.
 */
export function bodyLimit(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // GET / HEAD / DELETE typically carry no body. Skip the check unless
    // the request actually advertises a length.
    const cl = req.headers["content-length"];
    if (!cl) return next();
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      return res.status(413).json({ error: "payload too large" });
    }
    return next();
  };
}
