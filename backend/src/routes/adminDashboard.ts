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
import { sumPlatformCostTodayGlobal } from "../db/usageLedger.js";
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

export const adminDashboardRouter = Router();

interface DashboardSnapshot {
  generatedAt: string;
  sessions: {
    local: number;
    aci: number;
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
    spentTodayUsd: number;
    dailyUsdCap: number;
    lastFiredKey: string | null;
  };
  queues: {
    dockerExecInflight: number;
    dockerExecQueued: number;
    renderActive: number;
    renderWaiting: number;
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
  const localCount = records.filter(
    (r) => (r.handle as { __kind?: string } | null)?.__kind !== "aci",
  ).length;
  const aciCount = records.filter(
    (r) => (r.handle as { __kind?: string } | null)?.__kind === "aci",
  ).length;

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
  let freeTierSpend = 0;
  let freeTierCap = config.freeTier.dailyUsdCap;
  let dbOk: "ok" | "fail" = "ok";
  try {
    [freeTierSpend, freeTierCap] = await Promise.all([
      sumPlatformCostTodayGlobal(utcStartOfToday()),
      getEffectiveDailyUsdCap().catch(() => config.freeTier.dailyUsdCap),
    ]);
  } catch {
    dbOk = "fail";
  }
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
      aci: aciCount,
      total: records.length,
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
      dailyUsdCap: freeTierCap,
      lastFiredKey: watcher.lastFiredKey,
    },
    queues: {
      dockerExecInflight: queues.inFlight,
      dockerExecQueued: queues.queued,
      renderActive: renderQ.active,
      renderWaiting: renderQ.waiting,
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
