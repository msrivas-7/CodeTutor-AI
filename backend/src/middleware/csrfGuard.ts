import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * CSRF guard for state-changing routes.
 *
 * Fixes H-A3 (cross-origin POST can create sessions / run code) and M-A5
 * (rebind amplifies H-A3 by letting the attacker pick the sid).
 *
 * Threat model: a learner visits a malicious site while codetutor-ai is
 * running on their localhost. CORS prevents the attacker from *reading*
 * responses, but it does not prevent them from *sending* a request. A
 * `fetch("http://localhost:4000/api/session", { method: "POST", mode: "no-cors" })`
 * succeeds at the network layer — the backend spawns a runner container
 * before CORS even kicks in.
 *
 * Two guards, either of which is sufficient:
 *
 *   1. Custom header (`X-Requested-With: codetutor`). Simple cross-origin
 *      POSTs can only set a small set of CORS-safe headers; anything
 *      non-standard forces a preflight, which CORS rejects without
 *      `Access-Control-Allow-Origin` for the offending origin. Our own
 *      frontend attaches this header on every mutating fetch.
 *
 *   2. `Origin` header match against `config.corsOrigin`. Browsers always
 *      set Origin on cross-origin POSTs and — as of Phase 20-P1 — we require
 *      it on same-origin mutations too (Fetch spec ships Origin on every
 *      non-GET/HEAD in modern browsers). Rejecting missing Origin closes the
 *      narrow window where a crafted same-host tool could spoof the custom
 *      header without setting Origin.
 *
 * Applied only to mutating methods (POST/PUT/PATCH/DELETE). GETs are safe
 * by convention — the backend never mutates state on GET.
 *
 * Frontend integration: every fetch in `frontend/src/lib/backend.ts` and
 * every ai-streaming call must send `X-Requested-With: codetutor`.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();

  const xrw = req.get("x-requested-with");
  if (xrw !== "codetutor") {
    return res.status(403).json({ error: "missing CSRF header" });
  }

  // Phase 20-P1: Origin must be present AND allowlisted. Previously we
  // only enforced the match when Origin was set, which left a same-host
  // loophole — any non-browser caller could omit Origin and still mutate.
  const origin = req.get("origin");
  if (!origin || origin !== config.corsOrigin) {
    return res.status(403).json({ error: "origin not allowed" });
  }

  next();
}
