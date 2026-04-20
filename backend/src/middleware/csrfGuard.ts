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
 *   2. `Origin` header match against `config.corsOrigin`. The browser always
 *      sets Origin on cross-origin POSTs; checking it catches same-browser
 *      attacks where a script somehow sends the custom header (it can't,
 *      but belt-and-suspenders costs nothing).
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

  const origin = req.get("origin");
  // A missing Origin happens for same-origin same-tab navigations; browsers
  // always set it for cross-origin requests (including cross-origin POSTs).
  // If Origin is present, it must match. If it's absent and the custom
  // header is present, we trust the custom-header layer.
  if (origin !== undefined && origin !== config.corsOrigin) {
    return res.status(403).json({ error: "origin not allowed" });
  }

  next();
}
