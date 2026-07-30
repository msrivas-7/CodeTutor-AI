// Phase 25: aggregated live snapshot for the admin Overview dashboard.
//
// One endpoint that pulls everything the dashboard renders into a single
// payload — the alternative (5+ separate polled endpoints) would multiply
// the round-trip cost and make rate-limit accounting weirder. Cached for
// 1 second in-process so admin tabs polling at 5 s collectively cost
// ~1 DB call/sec total even with multiple admins watching.

import { Router } from "express";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  sumPlatformCostTodayGlobal,
  sumPlatformCostTodayAnonGlobal,
} from "../db/usageLedger.js";
import { getEffectiveDailyUsdCap } from "../services/ai/effectiveCaps.js";
import { getPlatformAuthStatus } from "../services/ai/credential.js";
import {
  getBudgetWatcherSnapshot,
} from "../services/budgetWatcher.js";
import { getMetricsSnapshot } from "../services/metrics.js";
import { aciCostTracker } from "../services/observability/aciCostTracker.js";
import {
  getAciOperationalConfig,
  getAciOperationalConfigRefreshAgeMs,
} from "../services/observability/aciOperationalConfig.js";
import {
  BACKEND_BOOT_ID,
  backendCounterDrift,
  backendQueueDepth,
  listSessions,
} from "../services/session/sessionManager.js";
import { _renderQueueDepth } from "../services/share/renderQueue.js";
import { getAnonSessionCounts } from "./anon.js";

export const adminDashboardRouter = Router();

interface DashboardSnapshot {
  generatedAt: string;
  sessions: {
    /** Total local active = authed (sessionManager) + anon (route counter). */
    local: number;
    /** Authed-only local count, sourced from sessionManager. */
    localAuthed: number;
    /** Anon ephemeral local sessions in flight on /api/anon/run. */
    localAnon: number;
    /** Total ACI active = authed + anon. */
    aci: number;
    /** Authed-only ACI count. */
    aciAuthed: number;
    /** Anon ephemeral ACI sessions in flight (when overflow routes anon). */
    aciAnon: number;
    /** local + aci. */
    total: number;
    capLocal: number;
    capAbsolute: number;
    counterDrift: number;
  };
  aci: {
    enabled: boolean;
    costTrackerState: "hydrated" | "degraded";
    spentTodayUsd: number;
    dailyUsdCap: number;
    activeSessions: number;
    configRefreshAgeMs: number | null;
  };
  freeTier: {
    enabled: boolean;
    /** Combined authed + anon spend today. Same value the resolver
     *  compares against L4 dailyUsdCap — preserves the existing tile's
     *  "% of cap" semantic. Kept for backward compat. */
    spentTodayUsd: number;
    /** Phase 27-v2.2 Fix 7a: authed-only spend today. Lets the admin
     *  SpendTile show a row split between paid-tier traffic and anon
     *  trial traffic, so an operator can see at a glance whether anon
     *  is eating the daily envelope. Sums to spentTodayUsd. */
    spentTodayUsdAuthed: number;
    /** Phase 27-v2.2 Fix 7a: anon-only spend today. Sums to
     *  spentTodayUsd alongside spentTodayUsdAuthed. */
    spentTodayUsdAnon: number;
    dailyUsdCap: number;
    lastFiredKey: string | null;
  };
  queues: {
    dockerExecInflight: number;
    dockerExecQueued: number;
    renderActive: number;
    renderWaiting: number;
  };
  /** Phase A — A5: projected monthly burn = fixed infra baseline (env
   *  constant, operator-maintained) + AI platform spend extrapolated
   *  from the trailing 7 days (authed + anon ledgers). ACI overflow
   *  spend is NOT folded in (dormant; its own tile shows today's
   *  number). Directional, not an invoice. */
  burn: {
    infraMonthlyUsd: number;
    aiSpendLast7dUsd: number;
    aiDailyAvgUsd: number;
    projectedMonthlyUsd: number;
  };
  health: {
    db: "ok" | "fail";
    platformAuth: "ok" | "failed";
    platformAuthSinceMs: number | null;
  };
  bootId: string;
  rates: {
    httpResponses: Record<string, number>;
    aciSpawnAttempts: Record<string, number>;
  };
}

let cached: { snapshot: DashboardSnapshot; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

function utcStartOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function buildSnapshot(): Promise<DashboardSnapshot> {
  const records = listSessions();
  const localAuthed = records.filter(
    (r) => (r.handle as { __kind?: string } | null)?.__kind !== "aci",
  ).length;
  const aciAuthed = records.filter(
    (r) => (r.handle as { __kind?: string } | null)?.__kind === "aci",
  ).length;
  // Phase 24B-resize: anon sessions never enter sessionManager (one-shot,
  // destroyed in the route's finally), so adding them here is the only
  // way the dashboard widget reflects real local-cap pressure. The anon
  // counters in routes/anon.ts increment after createSession resolves and
  // decrement in the same finally that destroys — drift would mean a
  // route bug, not a sessionManager bug.
  const anonCounts = getAnonSessionCounts();
  const localCount = localAuthed + anonCounts.local;
  const aciCount = aciAuthed + anonCounts.aci;

  const aciStatus = aciCostTracker.getStatus();
  let aciCfg: ReturnType<typeof getAciOperationalConfig> | null = null;
  try {
    aciCfg = getAciOperationalConfig();
  } catch {
    // pre-init: leave null and fall through to env defaults
  }
  const aciDailyCap =
    typeof aciCfg?.dailyUsdCap === "number" ? aciCfg.dailyUsdCap : config.aci.dailyUsdCap;

  // Free-tier spend — the resolver reads system_config + env. We don't
  // need the exact same fail-open behavior here (it's a dashboard read,
  // not a hot-path resolver), so let DB blips surface as a 0 with
  // health.db=fail rather than a 500.
  //
  // Phase 27-v2.2 Fix 7a: split the sum so the admin can see authed-vs-
  // anon contribution separately. We still keep `spentTodayUsd` as the
  // combined total (preserves existing % bar semantic) and add two
  // sibling fields. Computing them with three queries instead of one
  // is the cost — admin dashboard is a polled-every-5s read, not a
  // hot path; the index `idx_ai_anon_usage_ledger_today` covers the
  // anon sum query and the authed equivalent already exists.
  let freeTierSpendAuthed = 0;
  let freeTierSpendAnon = 0;
  let freeTierCap = config.freeTier.dailyUsdCap;
  // Phase A — A5: trailing-7-day AI spend for the burn projection.
  // Same two ledger sums with a 7-day `since`; the created_at indexes
  // that cover the today queries cover these too.
  let aiSpend7dAuthed = 0;
  let aiSpend7dAnon = 0;
  let dbOk: "ok" | "fail" = "ok";
  try {
    const since = utcStartOfToday();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    [
      freeTierSpendAuthed,
      freeTierSpendAnon,
      freeTierCap,
      aiSpend7dAuthed,
      aiSpend7dAnon,
    ] = await Promise.all([
      sumPlatformCostTodayGlobal(since),
      sumPlatformCostTodayAnonGlobal(since),
      getEffectiveDailyUsdCap().catch(() => config.freeTier.dailyUsdCap),
      sumPlatformCostTodayGlobal(since7d),
      sumPlatformCostTodayAnonGlobal(since7d),
    ]);
  } catch {
    dbOk = "fail";
  }
  const aiSpend7d = aiSpend7dAuthed + aiSpend7dAnon;
  const aiDailyAvg = aiSpend7d / 7;
  // 30.44 = average Gregorian month length in days.
  const projectedMonthly = config.infraMonthlyBaselineUsd + aiDailyAvg * 30.44;
  const freeTierSpend = freeTierSpendAuthed + freeTierSpendAnon;
  // Independent DB ping — the spend query above might short-circuit on
  // an empty ledger before hitting the DB at all (postgres-js lazy).
  try {
    await db()`SELECT 1`;
  } catch {
    dbOk = "fail";
  }

  const queues = backendQueueDepth();
  const renderQ = _renderQueueDepth();
  const platformAuth = getPlatformAuthStatus();
  const metrics = await getMetricsSnapshot();
  const watcher = getBudgetWatcherSnapshot();

  return {
    generatedAt: new Date().toISOString(),
    sessions: {
      local: localCount,
      localAuthed,
      localAnon: anonCounts.local,
      aci: aciCount,
      aciAuthed,
      aciAnon: anonCounts.aci,
      total: localCount + aciCount,
      capLocal: config.session.maxGlobal,
      capAbsolute: config.session.maxGlobal + (aciCfg?.maxOverflow ?? config.aci.maxOverflow),
      counterDrift: backendCounterDrift(),
    },
    aci: {
      enabled: aciCfg?.enabled ?? config.aci.enabled,
      costTrackerState: aciCostTracker.getHydrationState(),
      spentTodayUsd: Number(aciStatus.spentTodayUsd.toFixed(4)),
      dailyUsdCap: aciDailyCap,
      activeSessions: aciStatus.activeSessions,
      configRefreshAgeMs: getAciOperationalConfigRefreshAgeMs(),
    },
    freeTier: {
      enabled: config.freeTier.enabled,
      spentTodayUsd: Number(freeTierSpend.toFixed(4)),
      spentTodayUsdAuthed: Number(freeTierSpendAuthed.toFixed(4)),
      spentTodayUsdAnon: Number(freeTierSpendAnon.toFixed(4)),
      dailyUsdCap: freeTierCap,
      lastFiredKey: watcher.lastFiredKey,
    },
    queues: {
      dockerExecInflight: queues.inFlight,
      dockerExecQueued: queues.queued,
      renderActive: renderQ.active,
      renderWaiting: renderQ.waiting,
    },
    burn: {
      infraMonthlyUsd: config.infraMonthlyBaselineUsd,
      aiSpendLast7dUsd: Number(aiSpend7d.toFixed(4)),
      aiDailyAvgUsd: Number(aiDailyAvg.toFixed(4)),
      projectedMonthlyUsd: Number(projectedMonthly.toFixed(2)),
    },
    health: {
      db: dbOk,
      platformAuth: platformAuth ? "failed" : "ok",
      platformAuthSinceMs: platformAuth ? platformAuth.sinceMs : null,
    },
    bootId: BACKEND_BOOT_ID,
    rates: {
      httpResponses: metrics.httpResponses,
      aciSpawnAttempts: metrics.aciSpawnAttempts,
    },
  };
}

adminDashboardRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return res.json(cached.snapshot);
    }
    const snapshot = await buildSnapshot();
    cached = { snapshot, expiresAt: now + CACHE_TTL_MS };
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});
