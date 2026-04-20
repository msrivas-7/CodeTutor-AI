import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";
import { getSession } from "../services/session/sessionManager.js";

// Bucket key: we key on a combined `sid|ip` so an attacker who rotates the
// sessionId to escape a bucket *still* hits the IP floor. We also only
// trust the sid if it refers to an extant server-side session — otherwise
// a rogue client could invent an sid per request, which (with the
// pre-Phase-17 resolver) gave each one a fresh bucket with zero history.
//
// Fixes M-A2 (sid-rotation bypass). Phase 18 will swap the sid component
// for an authenticated user id.
export function bucketKey(req: import("express").Request): string {
  const sid = (req.body?.sessionId as string | undefined) ?? null;
  const ip = ipKeyGenerator(req.ip ?? "");
  const trusted = sid && sid.length > 0 && getSession(sid) !== undefined;
  if (trusted) return `sid:${sid}|ip:${ip}`;
  return `ip:${ip}`;
}

export const aiRateLimit = rateLimit({
  windowMs: config.aiRateLimit.windowMs,
  limit: config.aiRateLimit.max,
  keyGenerator: bucketKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many AI requests; please slow down." },
});
