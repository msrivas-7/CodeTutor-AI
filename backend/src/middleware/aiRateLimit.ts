import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";
import { getSession } from "../services/session/sessionManager.js";

// Bucket key precedence (Phase 18a):
//
//   1. Authenticated user — `user:<userId>`. Durable identity beats any
//      request-scoped signal. Two tabs / two devices logged in as the same
//      user share the bucket (intentional).
//   2. Trusted session — `sid:<id>|ip:<ip>`. Used by the legacy unauthed
//      path. We only trust the sid if it refers to a server-side session
//      that we created — otherwise an attacker could invent fake sids per
//      request. Kept for the single remaining public AI route
//      (`/api/ai/validate-key`) which has no user yet.
//   3. IP floor — `ip:<ip>`. Applies to unknown-sid / pre-auth flows.
//
// The combined sid|ip form still exists as an IP floor for (2); once
// every AI route is authenticated we can drop it entirely.
export function bucketKey(req: import("express").Request): string {
  if (req.userId) return `user:${req.userId}`;
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

// Sub-bucket for `/api/ai/validate-key`: far tighter than the general AI
// limit (5/hour/user) because the route is a binary oracle on OpenAI key
// validity. Without this a logged-in attacker could validate stolen keys
// or burn the operator's egress at 60/min (the general bucket). Stacks on
// top of `aiRateLimit` — both must pass.
export const validateKeyUserRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: bucketKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many key-validation attempts; try again later." },
});

// Global ceiling on validate-key regardless of user — if 20 users each hit
// their per-user 5/hr, that's still 100 validations/hr product-wide, which
// is the right global floor for legitimate signup traffic.
export const validateKeyGlobalRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 100,
  keyGenerator: () => "global",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many key-validation attempts globally; try again later." },
});
