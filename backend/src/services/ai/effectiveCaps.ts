// Phase 20-P5: cap resolver. The single answer-of-record for "what is
// the effective free-tier cap right now" — both per-user and project-
// wide. Replaces direct reads of `config.freeTier.*` in credential.ts.
//
// Three-layer precedence:
//   1. Per-user override (ai_free_tier_overrides row, non-NULL field)
//   2. Project-wide override (system_config row)
//   3. Env-var default (config.freeTier.*)
//
// Caps that are not per-user (free_tier_enabled, free_tier_daily_usd_cap)
// only apply layers 2 + 3.

import { config } from "../../config.js";
import { getOverride } from "../../db/aiFreeTierOverrides.js";
import { getSystemConfig, type SystemConfigKey } from "../../db/systemConfig.js";

// Reads the project-wide override for a key. Returns null if no row, or
// if the row's value is null. Caller falls back to env default.
async function readProjectOverrideNumber(
  key: SystemConfigKey,
): Promise<number | null> {
  const row = await getSystemConfig(key);
  if (!row) return null;
  if (typeof row.value !== "number" || !Number.isFinite(row.value)) return null;
  return row.value;
}

async function readProjectOverrideBoolean(
  key: SystemConfigKey,
): Promise<boolean | null> {
  const row = await getSystemConfig(key);
  if (!row) return null;
  if (typeof row.value !== "boolean") return null;
  return row.value;
}

// ---------------------------------------------------------------------------
// L1 — daily question count per user
// ---------------------------------------------------------------------------
export async function getEffectiveDailyQuestionsCap(
  userId: string,
): Promise<number> {
  const override = await getOverride(userId);
  if (override?.dailyQuestionsCap != null) return override.dailyQuestionsCap;
  const project = await readProjectOverrideNumber("free_tier_daily_questions");
  if (project != null) return project;
  return config.freeTier.dailyQuestions;
}

// ---------------------------------------------------------------------------
// L2 — daily $ cap per user
// ---------------------------------------------------------------------------
export async function getEffectiveDailyUsdCapPerUser(
  userId: string,
): Promise<number> {
  const override = await getOverride(userId);
  if (override?.dailyUsdCap != null) return override.dailyUsdCap;
  const project = await readProjectOverrideNumber("free_tier_daily_usd_per_user");
  if (project != null) return project;
  return config.freeTier.dailyUsdPerUser;
}

// ---------------------------------------------------------------------------
// L3 — lifetime $ cap per user
// ---------------------------------------------------------------------------
export async function getEffectiveLifetimeUsdCapPerUser(
  userId: string,
): Promise<number> {
  const override = await getOverride(userId);
  if (override?.lifetimeUsdCap != null) return override.lifetimeUsdCap;
  const project = await readProjectOverrideNumber("free_tier_lifetime_usd_per_user");
  if (project != null) return project;
  return config.freeTier.lifetimeUsdPerUser;
}

// ---------------------------------------------------------------------------
// L4 — global daily $ cap (no per-user layer)
// ---------------------------------------------------------------------------
export async function getEffectiveDailyUsdCap(): Promise<number> {
  const project = await readProjectOverrideNumber("free_tier_daily_usd_cap");
  if (project != null) return project;
  return config.freeTier.dailyUsdCap;
}

// ---------------------------------------------------------------------------
// L9 — free tier enabled gate (no per-user layer)
// ---------------------------------------------------------------------------
export async function getEffectiveFreeTierEnabled(): Promise<boolean> {
  const project = await readProjectOverrideBoolean("free_tier_enabled");
  if (project != null) return project;
  return config.freeTier.enabled;
}

// ---------------------------------------------------------------------------
// Phase A — A5: anon-only operational-floor caps (no per-user layer —
// anon has no user). Same two-layer precedence as L4/L9.
// ---------------------------------------------------------------------------
export async function getEffectiveAnonDailyUsdCap(): Promise<number> {
  const project = await readProjectOverrideNumber("anon_daily_usd_cap");
  if (project != null) return project;
  return config.freeTier.anonDailyUsdCap;
}

export async function getEffectiveAnonDailyRunsPerIp(): Promise<number> {
  const project = await readProjectOverrideNumber("anon_daily_runs_per_ip");
  if (project != null) return project;
  return config.freeTier.anonDailyRunsPerIp;
}
