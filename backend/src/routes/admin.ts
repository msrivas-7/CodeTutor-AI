// Phase 20-P5: admin routes for free-tier control + monitoring.
//
// Mount at /api/admin with the standard chain (csrfGuard + authMiddleware
// + mutationLimit) PLUS adminGuard. Plus an extra-strict admin-write
// rate limit at the route layer (Phase 4.5 server safety guard #3).
//
// The 9 endpoints (one is unguarded — /api/user/admin-status):
//
//   GET    /api/user/admin-status              — { isAdmin } for tab gating
//                                                (auth-only, no adminGuard)
//   GET    /api/admin/users                    — paginated list with usage stats
//   GET    /api/admin/users/:userId            — single user detail
//   PUT    /api/admin/users/:userId/override   — set per-user cap override
//   DELETE /api/admin/users/:userId/override   — clear all caps for user
//   GET    /api/admin/system-config            — current values + env defaults
//   PUT    /api/admin/system-config/:key       — set project override
//   DELETE /api/admin/system-config/:key       — revert to env default
//   GET    /api/admin/audit-log                — recent actions, paginated
//
// Safety guards (Phase 4.5):
//   - Bounds validation per cap (zod) — 4.5 server #1
//   - Required reason ≥ 4 chars — 4.5 server #2
//   - Stricter rate limit — 4.5 server #3 (applied at index.ts mount)
//   - confirmDisable / confirmReduction phrase guards — 4.5 server #4 + #5
//   - Audit log every write AND every rejected attempt — 4.5 server #6
//   - RLS service-role-only on all tables — 4.5 server #7 (schema)

import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import {
  clearOverride as clearUserOverride,
  getOverride as getUserOverride,
  setOverride as setUserOverride,
} from "../db/aiFreeTierOverrides.js";
import {
  KNOWN_KEYS,
  clearSystemConfig,
  getAllSystemConfig,
  getSystemConfig,
  setSystemConfig,
  type SystemConfigKey,
} from "../db/systemConfig.js";
import { invalidateAciOperationalConfig } from "../services/observability/aciOperationalConfig.js";
import { listAdminAuditLog, logAdminAction } from "../db/adminAuditLog.js";
import {
  getAuthUser,
  listAuthUsersPaginated,
} from "../db/supabaseAdmin.js";
import {
  countPlatformQuestionsTodayLocked,
  startOfUtcDay,
  sumPlatformCostLifetimeForUser,
  sumPlatformCostTodayForUser,
} from "../db/usageLedger.js";
import { isDenylisted } from "../db/denylist.js";
import { isAdmin } from "../db/userRoles.js";

// Phrase-confirm strings. Server-validated; the UI sends them verbatim
// when the dangerous action is requested.
const PHRASE_DISABLE_FREE_TIER =
  "I understand this stops free AI for everyone";
const PHRASE_REDUCE_GLOBAL_CAP =
  "I understand this may exhaust free tier today";

// Bounds per cap key. Out-of-range values rejected with 400.
const KEY_BOUNDS: Record<
  SystemConfigKey,
  { type: "number"; min: number; max: number } | { type: "boolean" }
> = {
  free_tier_enabled: { type: "boolean" },
  free_tier_daily_questions: { type: "number", min: 0, max: 10000 },
  free_tier_daily_usd_per_user: { type: "number", min: 0, max: 10 },
  free_tier_lifetime_usd_per_user: { type: "number", min: 0, max: 100 },
  free_tier_daily_usd_cap: { type: "number", min: 0, max: 50 },
  share_public_disabled: { type: "boolean" },
  share_create_disabled: { type: "boolean" },
  share_render_disabled: { type: "boolean" },
  // Phase 24B ACI operational knobs.
  // - aci_overflow_enabled: runtime kill switch. False stops new ACI
  //   spawns (existing sessions ride out their lifetimes) and shrinks
  //   the absolute cap back to local-only.
  // - aci_daily_usd_cap: $/day before the cost-cap kill switch fires.
  //   Bound 0–100 so a typo can't let a runaway spike burn $1000.
  //   Practical operator range is 0–50; 100 is the hard ceiling.
  // - aci_max_overflow: how many concurrent ACI sessions allowed past
  //   the local cap of 14. Bound 0–50 (P0-2 audit fix; was 100). 0 =
  //   "off without disabling" (overflow returns 503 immediately).
  //   The 50 ceiling reflects realistic burst sizing — past that the
  //   cost cap fires anyway, AND a 50-spawn fan-out costs ~$2.65/hr
  //   which already brushes the daily envelope. A higher value would
  //   only mask a misconfigured cost cap.
  aci_overflow_enabled: { type: "boolean" },
  aci_daily_usd_cap: { type: "number", min: 0, max: 100 },
  aci_max_overflow: { type: "number", min: 0, max: 50 },
  // Slice 8: warm-pool toggle. Boolean; the high/low watermarks +
  // pool size live in env (config.aci.*) since they're operational-
  // tuning values that don't need 2am admin access.
  aci_warm_pool_enabled: { type: "boolean" },
  // P2-2: warm-pool hysteresis knobs. Bounds keep operator typos from
  // (a) accidentally setting the pool higher than `aci_max_overflow`
  // (would never spawn that many), or (b) inverting low/high (caught
  // at read time below by HybridBackend's effectiveCap math). Hard
  // upper-bound 14 on watermarks because that's the local-cap default;
  // anything higher means the pool tries to ramp but local never gets
  // there.
  aci_warm_high_watermark: { type: "number", min: 0, max: 14 },
  aci_warm_low_watermark: { type: "number", min: 0, max: 14 },
  aci_warm_max_pool_size: { type: "number", min: 0, max: 10 },
};

// Env defaults exposed in GET /api/admin/system-config so the UI can
// render the "revert to env" button with the correct fallback value.
function envDefaultFor(key: SystemConfigKey): boolean | number {
  switch (key) {
    case "free_tier_enabled":
      return config.freeTier.enabled;
    case "free_tier_daily_questions":
      return config.freeTier.dailyQuestions;
    case "free_tier_daily_usd_per_user":
      return config.freeTier.dailyUsdPerUser;
    case "free_tier_lifetime_usd_per_user":
      return config.freeTier.lifetimeUsdPerUser;
    case "free_tier_daily_usd_cap":
      return config.freeTier.dailyUsdCap;
    case "share_public_disabled":
      return config.share.publicDisabled;
    case "share_create_disabled":
      return config.share.createDisabled;
    case "share_render_disabled":
      return config.share.renderDisabled;
    case "aci_overflow_enabled":
      return config.aci.enabled;
    case "aci_daily_usd_cap":
      return config.aci.dailyUsdCap;
    case "aci_max_overflow":
      return config.aci.maxOverflow;
    case "aci_warm_pool_enabled":
      return config.aci.warmPoolEnabled;
    case "aci_warm_high_watermark":
      return config.aci.warmHighWatermark ?? 12;
    case "aci_warm_low_watermark":
      return config.aci.warmLowWatermark ?? 10;
    case "aci_warm_max_pool_size":
      return config.aci.warmMaxPoolSize ?? 2;
  }
}

// ---------------------------------------------------------------------------
// /api/user/admin-status — UNGUARDED (only auth-required)
// ---------------------------------------------------------------------------
//
// Read by the frontend's Settings tab visibility gate. Returns the same
// answer that the JWT carries in app_metadata.role + the DB row, but
// surfaced as a simple boolean so the client doesn't have to decode the
// JWT itself. This is the single non-adminGuard'd endpoint in the file
// because the answer for non-admins is "false," not 403.

export const adminStatusRouter = Router();
adminStatusRouter.get("/admin-status", async (req, res, next) => {
  try {
    const userId = req.userId!;
    // Trust the JWT claim if present, AND verify against user_roles
    // (matches adminGuard's defense-in-depth). If either says no, no.
    if (req.userRole !== "admin") return res.json({ isAdmin: false });
    const stillAdmin = await isAdmin(userId);
    return res.json({ isAdmin: stillAdmin });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// /api/admin/* — adminGuard'd
// ---------------------------------------------------------------------------

export const adminRouter = Router();

// --- GET /api/admin/users -------------------------------------------------
//
// Paginated list with usage stats joined client-side. Page comes from
// Supabase Admin API (page+per_page); we annotate each row with today's
// questions, today's $, lifetime $, override (if any), and denylist flag.
// Search: free-text substring on email, applied INSIDE the auth-API page
// so a query that doesn't match anything on page 1 returns empty rather
// than searching the whole table.

const usersListQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().max(200).optional(),
});

adminRouter.get("/users", async (req, res, next) => {
  try {
    const parsed = usersListQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const { page, perPage, search } = parsed.data;
    const list = await listAuthUsersPaginated({ page, perPage, search });
    const dayStart = startOfUtcDay();
    const enriched = await Promise.all(
      list.users.map(async (u) => {
        const [questionsToday, usdToday, usdLifetime, override, denied] =
          await Promise.all([
            countPlatformQuestionsTodayLocked(u.id, dayStart),
            sumPlatformCostTodayForUser(u.id, dayStart),
            sumPlatformCostLifetimeForUser(u.id),
            getUserOverride(u.id),
            isDenylisted(u.id),
          ]);
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          createdAt: u.createdAt,
          lastSignInAt: u.lastSignInAt,
          questionsToday,
          usdToday,
          usdLifetime,
          override,
          denylisted: denied,
        };
      }),
    );
    res.json({
      users: enriched,
      page: list.page,
      perPage: list.perPage,
      hasMore: list.hasMore,
    });
  } catch (err) {
    next(err);
  }
});

// --- GET /api/admin/users/:userId -----------------------------------------

adminRouter.get("/users/:userId", async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const user = await getAuthUser(userId);
    if (!user) return res.status(404).json({ error: "user not found" });
    const dayStart = startOfUtcDay();
    const [questionsToday, usdToday, usdLifetime, override, denied] =
      await Promise.all([
        countPlatformQuestionsTodayLocked(userId, dayStart),
        sumPlatformCostTodayForUser(userId, dayStart),
        sumPlatformCostLifetimeForUser(userId),
        getUserOverride(userId),
        isDenylisted(userId),
      ]);
    res.json({
      user,
      questionsToday,
      usdToday,
      usdLifetime,
      override,
      denylisted: denied,
    });
  } catch (err) {
    next(err);
  }
});

// --- PUT /api/admin/users/:userId/override --------------------------------
//
// Set per-user override. NULL fields mean "use project default for this
// cap" — the row stays in place but that column doesn't take effect.
// Bounds enforced server-side (Phase 4.5 server #1).

const overrideBody = z
  .object({
    dailyQuestionsCap: z.number().int().min(0).max(10000).nullable(),
    dailyUsdCap: z.number().min(0).max(100).nullable(),
    lifetimeUsdCap: z.number().min(0).max(1000).nullable(),
    reason: z.string().min(4).max(500),
  })
  .strict();

adminRouter.put("/users/:userId/override", async (req, res, next) => {
  const userId = req.params.userId;
  const actorId = req.userId!;
  const parsed = overrideBody.safeParse(req.body);
  if (!parsed.success) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetUserId: userId,
      after: req.body,
      reason: `validation: ${parsed.error.message}`,
    });
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    // Verify the target user exists.
    const target = await getAuthUser(userId);
    if (!target) return res.status(404).json({ error: "user not found" });
    const before = await getUserOverride(userId);
    await setUserOverride({
      userId,
      dailyQuestionsCap: parsed.data.dailyQuestionsCap,
      dailyUsdCap: parsed.data.dailyUsdCap,
      lifetimeUsdCap: parsed.data.lifetimeUsdCap,
      setBy: actorId,
      reason: parsed.data.reason,
    });
    const after = await getUserOverride(userId, { bypassCache: true });
    await logAdminAction({
      actorId,
      eventType: "user_override_set",
      targetUserId: userId,
      before,
      after,
      reason: parsed.data.reason,
    });
    res.json({ override: after });
  } catch (err) {
    next(err);
  }
});

// --- DELETE /api/admin/users/:userId/override -----------------------------

adminRouter.delete("/users/:userId/override", async (req, res, next) => {
  const userId = req.params.userId;
  const actorId = req.userId!;
  try {
    const before = await getUserOverride(userId);
    await clearUserOverride(userId);
    await logAdminAction({
      actorId,
      eventType: "user_override_cleared",
      targetUserId: userId,
      before,
      after: null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- GET /api/admin/system-config -----------------------------------------
//
// Returns current value + source + env default for each well-known key.

adminRouter.get("/system-config", async (_req, res, next) => {
  try {
    const all = await getAllSystemConfig();
    const config_ = Object.fromEntries(
      KNOWN_KEYS.map((k) => {
        const row = all[k];
        return [
          k,
          {
            value: row?.value ?? envDefaultFor(k),
            source: row ? "override" : "env",
            envDefault: envDefaultFor(k),
            setBy: row?.setBy ?? null,
            setAt: row?.setAt ?? null,
            reason: row?.reason ?? null,
          },
        ];
      }),
    );
    res.json({ config: config_ });
  } catch (err) {
    next(err);
  }
});

// --- PUT /api/admin/system-config/:key ------------------------------------
//
// Set a project-wide override. The bounds + phrase-confirm guards live
// here (Phase 4.5 server #4 + #5). Audit log records both successful
// writes and rejected attempts.

const systemConfigBody = z
  .object({
    value: z.union([z.boolean(), z.number()]),
    reason: z.string().min(4).max(500),
    confirmDisable: z.string().optional(),
    confirmReduction: z.string().optional(),
  })
  .strict();

adminRouter.put("/system-config/:key", async (req, res, next) => {
  const actorId = req.userId!;
  const key = req.params.key;
  if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: key,
      after: req.body,
      reason: "unknown key",
    });
    return res.status(400).json({ error: "unknown system_config key" });
  }
  const typedKey = key as SystemConfigKey;
  const parsed = systemConfigBody.safeParse(req.body);
  if (!parsed.success) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: typedKey,
      after: req.body,
      reason: `validation: ${parsed.error.message}`,
    });
    return res.status(400).json({ error: parsed.error.message });
  }

  // Type/bounds validation per key.
  const bounds = KEY_BOUNDS[typedKey];
  const value = parsed.data.value;
  if (bounds.type === "boolean") {
    if (typeof value !== "boolean") {
      await logAdminAction({
        actorId,
        eventType: "rejected_attempt",
        targetKey: typedKey,
        after: parsed.data,
        reason: `expected boolean, got ${typeof value}`,
      });
      return res.status(400).json({ error: "value must be boolean" });
    }
  } else {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      await logAdminAction({
        actorId,
        eventType: "rejected_attempt",
        targetKey: typedKey,
        after: parsed.data,
        reason: `expected number, got ${typeof value}`,
      });
      return res.status(400).json({ error: "value must be a number" });
    }
    if (value < bounds.min || value > bounds.max) {
      await logAdminAction({
        actorId,
        eventType: "rejected_attempt",
        targetKey: typedKey,
        after: parsed.data,
        reason: `out of bounds [${bounds.min}, ${bounds.max}]`,
      });
      return res.status(400).json({
        error: `value out of bounds [${bounds.min}, ${bounds.max}]`,
      });
    }
  }

  // Phase 4.5 server #4: confirmDisable for free_tier_enabled = false.
  if (typedKey === "free_tier_enabled" && value === false) {
    if (parsed.data.confirmDisable !== PHRASE_DISABLE_FREE_TIER) {
      await logAdminAction({
        actorId,
        eventType: "rejected_attempt",
        targetKey: typedKey,
        after: parsed.data,
        reason: "missing or wrong confirmDisable phrase",
      });
      return res.status(400).json({
        error: "confirmDisable phrase required to disable free tier",
        requiredPhrase: PHRASE_DISABLE_FREE_TIER,
      });
    }
  }

  // Phase 4.5 server #5: confirmReduction for global $ cap > 75% drop.
  if (typedKey === "free_tier_daily_usd_cap" && typeof value === "number") {
    const current = (await getSystemConfig(typedKey))?.value;
    const currentEffective =
      typeof current === "number" ? current : envDefaultFor(typedKey);
    const currentNumber =
      typeof currentEffective === "number" ? currentEffective : 0;
    if (currentNumber > 0 && value < currentNumber * 0.25) {
      if (parsed.data.confirmReduction !== PHRASE_REDUCE_GLOBAL_CAP) {
        await logAdminAction({
          actorId,
          eventType: "rejected_attempt",
          targetKey: typedKey,
          before: { value: currentNumber },
          after: parsed.data,
          reason: "missing or wrong confirmReduction phrase",
        });
        return res.status(400).json({
          error:
            "confirmReduction phrase required for >75% drop in global $ cap",
          requiredPhrase: PHRASE_REDUCE_GLOBAL_CAP,
        });
      }
    }
  }

  try {
    const before = await getSystemConfig(typedKey);
    await setSystemConfig({
      key: typedKey,
      value: value as boolean | number,
      setBy: actorId,
      reason: parsed.data.reason,
    });
    const after = await getSystemConfig(typedKey, { bypassCache: true });
    // Phase 24B: ACI operational knobs need their synchronous mirror
    // refreshed immediately so the admin's change takes effect within
    // ms instead of waiting for the periodic 30s refresh (e.g., emergency
    // kill during a runaway spike). Other keys don't have this mirror.
    if (
      typedKey === "aci_overflow_enabled" ||
      typedKey === "aci_daily_usd_cap" ||
      typedKey === "aci_max_overflow" ||
      typedKey === "aci_warm_pool_enabled" ||
      typedKey === "aci_warm_high_watermark" ||
      typedKey === "aci_warm_low_watermark" ||
      typedKey === "aci_warm_max_pool_size"
    ) {
      await invalidateAciOperationalConfig();
    }
    await logAdminAction({
      actorId,
      eventType: "system_config_set",
      targetKey: typedKey,
      before: before ?? { value: null, source: "env", envDefault: envDefaultFor(typedKey) },
      after,
      reason: parsed.data.reason,
    });
    res.json({
      key: typedKey,
      value: after?.value,
      source: "override",
      envDefault: envDefaultFor(typedKey),
      setBy: after?.setBy ?? null,
      setAt: after?.setAt ?? null,
      reason: after?.reason ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// --- DELETE /api/admin/system-config/:key ---------------------------------
//
// Reverts to env default. Same phrase-confirm ladder as PUT (Phase 4.5
// server #4 + #5) so the operator can't sneak around the guards by
// using DELETE instead of PUT — e.g. env default `enabled = false` plus
// an override of `true` would silently disable free tier on revert.

const deleteSystemConfigBody = z
  .object({
    confirmDisable: z.string().optional(),
    confirmReduction: z.string().optional(),
  })
  .strict()
  .optional();

adminRouter.delete("/system-config/:key", async (req, res, next) => {
  const actorId = req.userId!;
  const key = req.params.key;
  if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
    return res.status(400).json({ error: "unknown system_config key" });
  }
  const typedKey = key as SystemConfigKey;
  const parsed = deleteSystemConfigBody.safeParse(req.body ?? {});
  const body = parsed.success ? parsed.data ?? {} : {};
  const envValue = envDefaultFor(typedKey);

  // Guard: env default re-enables the kill switch as `false`.
  if (typedKey === "free_tier_enabled" && envValue === false) {
    if (body.confirmDisable !== PHRASE_DISABLE_FREE_TIER) {
      await logAdminAction({
        actorId,
        eventType: "rejected_attempt",
        targetKey: typedKey,
        after: { op: "delete" },
        reason: "missing or wrong confirmDisable phrase on revert",
      });
      return res.status(400).json({
        error:
          "confirmDisable phrase required — env default disables free tier",
        requiredPhrase: PHRASE_DISABLE_FREE_TIER,
      });
    }
  }

  // Guard: revert would cause >75% drop in global $ cap.
  if (typedKey === "free_tier_daily_usd_cap" && typeof envValue === "number") {
    const current = (await getSystemConfig(typedKey))?.value;
    const currentNumber = typeof current === "number" ? current : envValue;
    if (currentNumber > 0 && envValue < currentNumber * 0.25) {
      if (body.confirmReduction !== PHRASE_REDUCE_GLOBAL_CAP) {
        await logAdminAction({
          actorId,
          eventType: "rejected_attempt",
          targetKey: typedKey,
          before: { value: currentNumber },
          after: { op: "delete", revertsTo: envValue },
          reason: "missing or wrong confirmReduction phrase on revert",
        });
        return res.status(400).json({
          error:
            "confirmReduction phrase required — revert is a >75% drop in global $ cap",
          requiredPhrase: PHRASE_REDUCE_GLOBAL_CAP,
        });
      }
    }
  }

  try {
    const before = await getSystemConfig(typedKey);
    await clearSystemConfig(typedKey);
    if (
      typedKey === "aci_overflow_enabled" ||
      typedKey === "aci_daily_usd_cap" ||
      typedKey === "aci_max_overflow" ||
      typedKey === "aci_warm_pool_enabled"
    ) {
      // Revert-to-env path. Refresh the sync mirror so the env default
      // takes effect immediately rather than the previous DB-held value
      // sticking around for 30s.
      await invalidateAciOperationalConfig();
    }
    await logAdminAction({
      actorId,
      eventType: "system_config_cleared",
      targetKey: typedKey,
      before,
      after: { value: envValue, source: "env" },
    });
    res.json({ ok: true, value: envValue, source: "env" });
  } catch (err) {
    next(err);
  }
});

// --- GET /api/admin/audit-log ---------------------------------------------

const auditLogQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminRouter.get("/audit-log", async (req, res, next) => {
  try {
    const parsed = auditLogQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const { cursor, limit } = parsed.data;
    const result = await listAdminAuditLog({ cursor: cursor ?? null, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
