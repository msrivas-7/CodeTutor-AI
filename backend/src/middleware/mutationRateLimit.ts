import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";

/**
 * Per-IP rate limits for mutating routes (sessions, snapshots, execution).
 *
 * Fixes H-A2: before Phase 17, only `/api/ai/*` was throttled. A learner
 * (or a rogue script on a page they visited — see H-A3 / csrfGuard) could
 * POST `/api/session` in a tight loop and spawn thousands of runner
 * containers before the socket-proxy PidsLimit / Docker daemon capped out.
 *
 * Keyed per-IP because there is no auth yet. When Phase 18 adds
 * authenticated users, swap `ipKeyGenerator(req.ip)` to the user id with
 * the IP bucket as the fallback floor.
 *
 * Two tiers:
 *   - `sessionCreateLimit`: tight — container creation is the expensive op.
 *   - `mutationLimit`: generous — covers per-keystroke snapshot syncs and
 *     per-run code executes where a user legitimately hits the endpoint
 *     often.
 */
const byIp = (req: import("express").Request) =>
  `ip:${ipKeyGenerator(req.ip ?? "")}`;

export const sessionCreateLimit = rateLimit({
  windowMs: config.mutationRateLimit.sessionCreateWindowMs,
  limit: config.mutationRateLimit.sessionCreateMax,
  keyGenerator: byIp,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many session creations; slow down." },
});

export const mutationLimit = rateLimit({
  windowMs: config.mutationRateLimit.mutationWindowMs,
  limit: config.mutationRateLimit.mutationMax,
  keyGenerator: byIp,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests; slow down." },
});
