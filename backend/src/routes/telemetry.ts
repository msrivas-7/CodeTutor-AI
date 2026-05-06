// Phase 27-v2.2 Fix 6 — funnel telemetry for the anon trial path.
//
// Single endpoint, unauthenticated:
//   POST /api/telemetry/event   write a row to phase27_funnel_events
//
// Why unauthenticated:
//   - The first event (anon_page_view) fires BEFORE any signup,
//     before any session, before any ledger entry. Auth-gating it
//     would defeat the funnel's first step.
//   - The wall_opened / signup_completed / lesson2_reached events
//     could in principle be auth-gated for the post-signup half,
//     but keeping the route shape uniform across all four events
//     is simpler than splitting it.
//
// Defenses:
//   - Tight per-IP rate limit (telemetryRateLimit below). Telemetry
//     is fire-and-forget from the frontend; one event per user
//     action is the expected rate. 60/min/IP is generous for a
//     legitimate Maya, hostile to a bot trying to inflate counts.
//   - Strict zod validation on event + reason — unknown event labels
//     are rejected at the schema, not at the DB CHECK constraint.
//     A flood of bogus events couldn't poison the funnel: they just
//     get 400'd before the insert.
//   - IP hash (same algorithm as the L_anon ledger) so the funnel
//     row is GDPR-tier-safe (no raw IP) and cross-correlatable with
//     ai_anon_usage_ledger for "of IPs that hit ANON_EXHAUSTED, how
//     many converted" rollups later.
//   - 42P01 fallback: if the migration hasn't been applied yet, the
//     handler logs and returns 204 — telemetry is a non-critical
//     side-channel, dropping events on a missing table is strictly
//     better than 500'ing the route.
//   - No CSRF protection by design (same call as anon endpoints) —
//     worst-case a CSRF-driven flood inflates a single IP's funnel
//     counts, which the admin dashboard can filter against the L_anon
//     ledger if it gets out of hand.

import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { db } from "../db/client.js";
import { hashClientIp } from "../services/ai/ipHash.js";

// Funnel event labels — the four canonical conversion-path beats.
// Anything else gets 400'd at the zod parse. Keep this in sync with
// the DB CHECK constraint at supabase/migrations/20260502000000.
const EVENT_LABELS = [
  "anon_page_view",
  "anon_wall_opened",
  "anon_signup_completed",
  "anon_lesson2_reached",
] as const;

// SignupWallReason values that legitimately surface alongside
// anon_wall_opened. Keeping a literal union here gives an early 400
// on a typo that would otherwise just land as a free-text reason
// that the dashboard can't aggregate.
const WALL_REASONS = [
  "save",
  "next-lesson",
  "exhausted",
  "share",
  // Phase 27-v2.2 audit fix E1: kill-switch-flipped wall reason.
  "trial-paused",
] as const;

const eventBody = z.object({
  event: z.enum(EVENT_LABELS),
  reason: z.enum(WALL_REASONS).optional(),
});

// Per-IP rate limit. One legitimate anon journey emits ≤4 events; a
// 60/min/IP ceiling is ~14 minutes of journey-density before we
// throttle, which is well above any real Maya pace. Hostile bots
// inflating funnel counts hit the wall fast.
const telemetryRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (req) => `telem:${ipKeyGenerator(req.ip ?? "")}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many telemetry events; please slow down." },
});

export function createTelemetryRouter(): Router {
  const router = Router();

  router.post(
    "/event",
    telemetryRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      const parsed = eventBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_event_body" });
        return;
      }
      const { event, reason } = parsed.data;

      // Reason is only meaningful for anon_wall_opened. Coerce others
      // to null so an over-sharing client doesn't pollute the column.
      const reasonForDb = event === "anon_wall_opened" ? reason ?? null : null;

      // Phase 27-v2.2 audit fix: skip the row if Express couldn't
      // populate req.ip — empty-string fallthrough would hash everyone
      // to one ip_hash and corrupt the funnel (one apparent visitor =
      // every unknown-IP caller). Telemetry is fire-and-forget; 204
      // back to the client is honest ("we got your event but had no
      // way to attribute it").
      if (!req.ip) {
        res.status(204).end();
        return;
      }
      const ipHash = hashClientIp(req.ip);
      try {
        const sql = db();
        await sql`
          INSERT INTO public.phase27_funnel_events (event, reason, ip_hash)
          VALUES (${event}, ${reasonForDb}, ${ipHash})
        `;
      } catch (err) {
        // 42P01 = undefined_table. If the migration hasn't been applied
        // yet, telemetry just drops (logged) — better than 500'ing the
        // funnel for the entire backend. Same defensive pattern the
        // anon usage ledger uses (safeWriteAnonUsage / sumPlatformCost
        // TodayAnonGlobal).
        const code = (err as { code?: string }).code;
        if (code === "42P01") {
          console.warn(
            "[telemetry] phase27_funnel_events table missing; skipping write. " +
              "Apply supabase/migrations/20260502000000_phase27_funnel_events.sql.",
          );
        } else {
          console.error(
            "[telemetry] insert failed",
            { event, err: (err as Error).message },
          );
        }
        // Always 204 to the client — telemetry is fire-and-forget; a
        // failed write must not break the UX.
      }
      res.status(204).end();
    },
  );

  return router;
}
