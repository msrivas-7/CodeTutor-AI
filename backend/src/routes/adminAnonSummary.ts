// Phase 27-v2.2 Fix 7b — admin anon-trial-path summary.
//
// Read-only endpoint feeding the admin "Trial path" tab. The data here
// is derived rather than authoritative: every number can be reconstructed
// by querying the underlying tables directly (ai_anon_usage_ledger,
// phase27_funnel_events, system_config) and the in-process Prometheus
// counters. Keeping the aggregation here means the admin tab stays at
// one round-trip per refresh and the SQL stays in one place.
//
// Polled at 5 s by the frontend, mirroring the Overview dashboard cadence.
// Not cached server-side: the queries are all indexed-bounded scans on
// today's data and the table is small (per-IP rows). If anon traffic
// scales past a few thousand IPs/day we'll add a 1 s in-process cache
// like adminDashboardRouter — but until then the freshness wins.
//
// Mounted under /api/admin (no extra middleware) — the chain
// csrfGuard + authMiddleware + adminGuard + adminWriteLimit is applied
// once at the parent mount, same as the other admin sub-routers.

import { Router } from "express";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { getSystemConfig } from "../db/systemConfig.js";
import { aiPlatformAbuseSignals } from "../services/metrics.js";

export const adminAnonSummaryRouter = Router();

interface AbuseSnapshot {
  anon_lesson_not_allowed: number;
  model_rejection: number;
  // Phase A — A4: fabricated-API tripwire count (all tutor routes, not
  // just anon — the counter is process-wide). Non-zero ⇒ read the
  // tutor_suspect_api log lines for the flagged symbols.
  tutor_suspect_api: number;
}

async function snapshotAbuseSignals(): Promise<AbuseSnapshot> {
  // Phase 27-v2.2 audit fix (bug-hunter P2): degrade to zeros on any
  // prom-client throw rather than letting Promise.all short-circuit
  // the whole admin endpoint. The other three promises in the parent
  // Promise.all already have .catch fallbacks; this matches.
  try {
    const json = (await aiPlatformAbuseSignals.get()) as {
      values?: Array<{ labels?: Record<string, string>; value: number }>;
    };
    let anonNotAllowed = 0;
    let modelRejection = 0;
    let suspectApi = 0;
    for (const v of json.values ?? []) {
      if (v.labels?.signal === "anon_lesson_not_allowed") {
        anonNotAllowed += v.value;
      } else if (v.labels?.signal === "model_rejection") {
        modelRejection += v.value;
      } else if (v.labels?.signal === "tutor_suspect_api") {
        suspectApi += v.value;
      }
    }
    return {
      anon_lesson_not_allowed: anonNotAllowed,
      model_rejection: modelRejection,
      tutor_suspect_api: suspectApi,
    };
  } catch {
    return {
      anon_lesson_not_allowed: 0,
      model_rejection: 0,
      tutor_suspect_api: 0,
    };
  }
}

function utcStartOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

interface AnonSummary {
  generatedAt: string;
  questionsToday: number;
  distinctIpsToday: number;
  exhaustedIpsToday: number;
  perIpDailyCap: number;
  abuseSignals: AbuseSnapshot;
  funnelEvents: {
    anon_page_view: number;
    anon_first_run: number;
    anon_lesson_completed: number;
    anon_wall_opened: number;
    anon_signup_completed: number;
    anon_lesson2_reached: number;
  };
  distributionChannels: Array<{
    source: "direct" | "organic" | "share";
    anon_page_view: number;
    anon_first_run: number;
    anon_lesson_completed: number;
    anon_signup_completed: number;
    anon_lesson2_reached: number;
  }>;
  killSwitch: {
    enabled: boolean;
    source: "override" | "env";
    setBy: string | null;
    setAt: string | null;
    reason: string | null;
  };
}

adminAnonSummaryRouter.get("/anon-summary", async (_req, res, next) => {
  try {
    const since = utcStartOfToday();
    const sql = db();
    const perIpCap = config.freeTier.anonDailyQuestionsPerIp;

    // Three queries parallelized:
    //   1. anon ledger aggregates (count, distinct IPs, exhausted IPs)
    //   2. funnel-event counts since Fix 6 migration started recording
    //   3. system_config kill-switch read
    // Each catches 42P01 and falls back to zeros / env so an admin can
    // still load the panel before migrations land in this env.

    const ledgerPromise = sql<
      Array<{
        question_count: number;
        distinct_ips: number;
        exhausted_ips: number;
      }>
    >`
      WITH per_ip AS (
        SELECT ip_hash, COUNT(*)::int AS n
          FROM public.ai_anon_usage_ledger
         WHERE counts_toward_quota = true
           AND created_at >= ${since}
         GROUP BY ip_hash
      )
      SELECT
        COALESCE(SUM(n), 0)::int                              AS question_count,
        COUNT(*)::int                                         AS distinct_ips,
        COALESCE(SUM(CASE WHEN n >= ${perIpCap} THEN 1 ELSE 0 END), 0)::int
                                                              AS exhausted_ips
      FROM per_ip
    `.then((rows) => rows[0] ?? { question_count: 0, distinct_ips: 0, exhausted_ips: 0 })
      .catch((err: { code?: string }) => {
        if (err.code === "42P01") {
          return { question_count: 0, distinct_ips: 0, exhausted_ips: 0 };
        }
        throw err;
      });

    // Phase 27-v2.2 audit fix A1: scope to today (UTC). Pre-fix, this
    // returned cumulative-since-table-creation counts side-by-side with
    // today's ledger numbers — the admin tab labels both as "today" so
    // the operator's wall→signup ratio drifts upward as funnel data
    // accumulates. The (event, occurred_at) index now matches.
    const funnelPromise = sql<
      Array<{ event: string; n: number }>
    >`
      SELECT event, COUNT(*)::int AS n
        FROM public.phase27_funnel_events
       WHERE occurred_at >= ${since}
       GROUP BY event
    `.then((rows) => {
      const out: AnonSummary["funnelEvents"] = {
        anon_page_view: 0,
        anon_first_run: 0,
        anon_lesson_completed: 0,
        anon_wall_opened: 0,
        anon_signup_completed: 0,
        anon_lesson2_reached: 0,
      };
      for (const r of rows) {
        if (r.event in out) {
          (out as Record<string, number>)[r.event] = Number(r.n);
        }
      }
      return out;
    }).catch((err: { code?: string }) => {
      if (err.code === "42P01") {
        return {
          anon_page_view: 0,
          anon_first_run: 0,
          anon_lesson_completed: 0,
          anon_wall_opened: 0,
          anon_signup_completed: 0,
          anon_lesson2_reached: 0,
        };
      }
      throw err;
    });

    const channelPromise = sql<
      Array<{
        source: "direct" | "organic" | "share";
        event: string;
        n: number;
      }>
    >`
      SELECT acquisition_source AS source, event, COUNT(*)::int AS n
        FROM public.phase27_funnel_events
       WHERE occurred_at >= ${since}
       GROUP BY acquisition_source, event
    `.then((rows) => {
      const bySource = new Map<
        AnonSummary["distributionChannels"][number]["source"],
        AnonSummary["distributionChannels"][number]
      >();
      for (const source of ["direct", "organic", "share"] as const) {
        bySource.set(source, {
          source,
          anon_page_view: 0,
          anon_first_run: 0,
          anon_lesson_completed: 0,
          anon_signup_completed: 0,
          anon_lesson2_reached: 0,
        });
      }
      for (const row of rows) {
        const channel = bySource.get(row.source);
        if (!channel || !(row.event in channel)) continue;
        (channel as unknown as Record<string, string | number>)[row.event] = Number(row.n);
      }
      return [...bySource.values()];
    }).catch((err: { code?: string }) => {
      if (err.code === "42P01" || err.code === "42703") {
        return (["direct", "organic", "share"] as const).map((source) => ({
          source,
          anon_page_view: 0,
          anon_first_run: 0,
          anon_lesson_completed: 0,
          anon_signup_completed: 0,
          anon_lesson2_reached: 0,
        }));
      }
      throw err;
    });

    const killSwitchPromise = getSystemConfig("anon_lesson_enabled").then(
      (row) => {
        if (row && typeof row.value === "boolean") {
          return {
            enabled: row.value,
            source: "override" as const,
            setBy: row.setBy,
            setAt: row.setAt,
            reason: row.reason,
          };
        }
        return {
          enabled: config.anonLessonEnabled,
          source: "env" as const,
          setBy: null,
          setAt: null,
          reason: null,
        };
      },
    ).catch(() => ({
      enabled: config.anonLessonEnabled,
      source: "env" as const,
      setBy: null,
      setAt: null,
      reason: null,
    }));

    const [ledger, funnelEvents, distributionChannels, killSwitch, abuseSignals] = await Promise.all([
      ledgerPromise,
      funnelPromise,
      channelPromise,
      killSwitchPromise,
      snapshotAbuseSignals(),
    ]);

    const summary: AnonSummary = {
      generatedAt: new Date().toISOString(),
      questionsToday: ledger.question_count,
      distinctIpsToday: ledger.distinct_ips,
      exhaustedIpsToday: ledger.exhausted_ips,
      perIpDailyCap: perIpCap,
      abuseSignals,
      funnelEvents,
      distributionChannels,
      killSwitch,
    };
    res.json(summary);
  } catch (err) {
    next(err);
  }
});
