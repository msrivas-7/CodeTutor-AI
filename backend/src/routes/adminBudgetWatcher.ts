// Phase 25: budget-watcher state visibility + dedup reset.
//
// The watcher tracks at most one in-memory key like "2026-04-30:cap=15:0.5"
// (the highest threshold fired today). Admin can read the snapshot and
// clear the dedup if they want the next tick to re-fire — useful when
// ACS was misconfigured and the alert never landed for real.

import { Router } from "express";
import { z } from "zod";
import { sumPlatformCostTodayGlobal } from "../db/usageLedger.js";
import { logAdminAction } from "../db/adminAuditLog.js";
import { getEffectiveDailyUsdCap } from "../services/ai/effectiveCaps.js";
import {
  getBudgetWatcherSnapshot,
  resetBudgetWatcherDedup,
} from "../services/budgetWatcher.js";
import { config } from "../config.js";

export const adminBudgetWatcherRouter = Router();

const PHRASE_RESET_BUDGET_WATCHER =
  "I understand this may cause duplicate budget alerts";

function utcStartOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

adminBudgetWatcherRouter.get("/budget-watcher", async (_req, res, next) => {
  try {
    const snap = getBudgetWatcherSnapshot();
    let cap = config.freeTier.dailyUsdCap;
    let spend = 0;
    try {
      cap = await getEffectiveDailyUsdCap();
    } catch {
      // env fallback already in `cap`
    }
    try {
      spend = await sumPlatformCostTodayGlobal(utcStartOfToday());
    } catch {
      // soft fail; surface 0 + DB error in /dashboard.health.db
    }
    res.json({
      lastFiredKey: snap.lastFiredKey,
      dailyCapUsd: cap,
      spentTodayUsd: Number(spend.toFixed(4)),
    });
  } catch (err) {
    next(err);
  }
});

const resetBody = z
  .object({
    reason: z.string().min(4).max(500),
    confirmReset: z.string(),
  })
  .strict();

adminBudgetWatcherRouter.post("/budget-watcher/reset", async (req, res, next) => {
  const actorId = req.userId!;
  const parsed = resetBody.safeParse(req.body);
  if (!parsed.success) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: "budget_watcher",
      after: req.body,
      reason: `validation: ${parsed.error.message}`,
    });
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.confirmReset !== PHRASE_RESET_BUDGET_WATCHER) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: "budget_watcher",
      after: parsed.data,
      reason: "missing or wrong confirmReset phrase",
    });
    return res.status(400).json({
      error: "confirmReset phrase required",
      requiredPhrase: PHRASE_RESET_BUDGET_WATCHER,
    });
  }
  try {
    const before = getBudgetWatcherSnapshot();
    resetBudgetWatcherDedup();
    await logAdminAction({
      actorId,
      eventType: "budget_watcher_reset",
      targetKey: "budget_watcher",
      before,
      after: { lastFiredKey: null },
      reason: parsed.data.reason,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
