// Phase 20-P4: the single resolver every AI route asks "whose key am I
// allowed to use, and how many questions does this user have left?". The
// discriminated return type keeps the downstream switch statements total —
// 'byok' has no limits + no allowlist, 'platform' has both, 'none' carries
// a machine-readable reason for the route to turn into an HTTP error.
//
// Resolution order short-circuits at the first rule that fires. Each rule
// maps to a defense layer in /Users/mehul/.claude/plans/hazy-wishing-wren.md:
//
//   L0: user has a BYOK key                     → byok
//   L9: ENABLE_FREE_TIER !== '1'                → none / free_disabled
//   L5: ai_platform_denylist has row for user   → none / denylisted
//   L4: global daily $ >= FREE_TIER_DAILY_USD_CAP → none / usd_cap_hit
//   L3: user lifetime $ >= LIFETIME_USD_PER_USER → none / lifetime_usd_per_user_hit
//   L2: user daily $   >= DAILY_USD_PER_USER    → none / daily_usd_per_user_hit
//   L1: user daily questions >= DAILY_QUESTIONS → none / free_exhausted
//   else                                         → platform + remainingToday
//
// Aggregates (L2–L4) are non-transactional and cached 60s module-level at
// the call site — cheap at 5 DAU, and the $ caps strictly bound the blast
// radius of any stale read. L1 is a live COUNT; see plan's concurrent-tab
// race discussion for why the non-transactional count is acceptable here.

import { config } from "../../config.js";
import { getOpenAIKey } from "../../db/preferences.js";
import { isDenylisted } from "../../db/denylist.js";
import {
  countPlatformQuestionsTodayLocked,
  startOfUtcDay,
  sumPlatformCostLifetimeForUser,
  sumPlatformCostTodayForUser,
  sumPlatformCostTodayGlobal,
} from "../../db/usageLedger.js";
import { PLATFORM_ALLOWED_MODELS } from "./pricing.js";

export type CredentialNoneReason =
  | "no_key"
  | "free_disabled"
  | "free_exhausted"
  | "daily_usd_per_user_hit"
  | "lifetime_usd_per_user_hit"
  | "usd_cap_hit"
  | "denylisted"
  | "provider_auth_failed";

export type AICredential =
  | {
      source: "byok";
      key: string;
      remainingToday: null;
      capToday: null;
      allowedModels: null;
      resetAtUtc: null;
    }
  | {
      source: "platform";
      key: string;
      remainingToday: number;
      capToday: number;
      allowedModels: readonly string[];
      resetAtUtc: Date;
    }
  | {
      source: "none";
      reason: CredentialNoneReason;
      remainingToday: null;
      capToday: null;
      allowedModels: null;
      resetAtUtc: Date | null;
    };

// Small in-process cache for the global daily $ and per-user lifetime/daily
// $ reads. 60s TTL means the $ caps can overshoot by at most one stale window
// — the deeper per-user L2/L3 caps mean one user can't exploit the lag.
const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const globalCache: { today: CacheEntry<number> | null } = { today: null };
const userDailyCache = new Map<string, CacheEntry<number>>();
const userLifetimeCache = new Map<string, CacheEntry<number>>();

// Auth-failure kill flag. The route sets this when OpenAI returns 401 for
// the platform key; until the operator rotates the key (or the TTL probe
// window elapses) subsequent calls short-circuit instead of re-burning on
// every request. Tracks the moment the flag was flipped so:
//   - /api/health/deep can show "how long has platform auth been broken?"
//   - a probe path can auto-clear after AUTO_UNSTICK_MS so a transient
//     401 (provider blip, rare but observed) doesn't require human action
// The admin POST /unstick clears the flag immediately for the "we rotated
// the key, unstick now" case.
let providerAuthFailed = false;
let providerAuthFailedAt = 0;

// After 30 minutes, allow a single probe request through. If that request
// also 401s, the flag flips back on; if it succeeds, the flag stays cleared.
// The TTL must be long enough that we don't flap on a genuine bad-key
// deployment (operator needs time to notice + rotate) but short enough that
// a provider-side transient auth glitch doesn't require manual intervention.
const AUTO_UNSTICK_MS = 30 * 60 * 1000;

export function markPlatformAuthFailed(): void {
  providerAuthFailed = true;
  providerAuthFailedAt = Date.now();
}

export function clearPlatformAuthFailed(): void {
  providerAuthFailed = false;
  providerAuthFailedAt = 0;
}

/**
 * Read-only view for /api/health/deep and admin tooling. Returns `null` when
 * the platform key is healthy and a structured record when it's tripped.
 * `sinceMs` is the millisecond age of the failure, useful for alerting
 * policies that want "still broken after 5 minutes → page oncall."
 */
export function getPlatformAuthStatus(): { failedAt: number; sinceMs: number } | null {
  if (!providerAuthFailed) return null;
  return { failedAt: providerAuthFailedAt, sinceMs: Date.now() - providerAuthFailedAt };
}

async function cachedGlobalToday(since: Date): Promise<number> {
  const now = Date.now();
  if (globalCache.today && globalCache.today.expiresAt > now) {
    return globalCache.today.value;
  }
  const v = await sumPlatformCostTodayGlobal(since);
  globalCache.today = { value: v, expiresAt: now + CACHE_TTL_MS };
  return v;
}

async function cachedUserDaily(userId: string, since: Date): Promise<number> {
  const now = Date.now();
  const hit = userDailyCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.value;
  const v = await sumPlatformCostTodayForUser(userId, since);
  userDailyCache.set(userId, { value: v, expiresAt: now + CACHE_TTL_MS });
  return v;
}

async function cachedUserLifetime(userId: string): Promise<number> {
  const now = Date.now();
  const hit = userLifetimeCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.value;
  const v = await sumPlatformCostLifetimeForUser(userId);
  userLifetimeCache.set(userId, { value: v, expiresAt: now + CACHE_TTL_MS });
  return v;
}

// Invalidate after a successful ledger write so the next request in the
// same cache window re-reads the freshly incremented value. Keeps the
// visible "remainingToday" counter accurate on the immediate follow-up
// status poll, which fires right after each assistant-message completion.
export function invalidateUsageCaches(userId: string): void {
  userDailyCache.delete(userId);
  userLifetimeCache.delete(userId);
  globalCache.today = null;
}

export function __resetCredentialCachesForTests(): void {
  userDailyCache.clear();
  userLifetimeCache.clear();
  globalCache.today = null;
  providerAuthFailed = false;
  providerAuthFailedAt = 0;
}

function endOfUtcDay(since: Date): Date {
  const d = new Date(since);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function none(
  reason: CredentialNoneReason,
  resetAtUtc: Date | null = null,
): AICredential {
  return {
    source: "none",
    reason,
    remainingToday: null,
    capToday: null,
    allowedModels: null,
    resetAtUtc,
  };
}

export async function resolveAICredential(userId: string): Promise<AICredential> {
  // L0: BYOK always wins. If the user has pasted their own key, we never
  // touch the platform path — their spend is their meter.
  const byok = await getOpenAIKey(userId);
  if (byok) {
    return {
      source: "byok",
      key: byok,
      remainingToday: null,
      capToday: null,
      allowedModels: null,
      resetAtUtc: null,
    };
  }

  // L9: nuclear kill. One env-flag flip takes the feature offline for
  // everyone on the next request without a migration or a container rebuild.
  // We return `no_key` here (not `free_disabled`) because from the user's
  // perspective this is identical to "product is in BYOK-only mode": they
  // just need to paste a key. `free_disabled` is reserved for a future
  // path where we can distinguish "you WERE on platform and now you're not."
  if (!config.freeTier.enabled) return none("no_key");

  // L5: targeted kill. Operator INSERTs a row, cache expires within 60s,
  // user hits a 403 on their next request. BYOK users unaffected (we
  // already returned above).
  if (await isDenylisted(userId)) return none("denylisted");

  // Provider-auth kill: if we've already observed a 401 from OpenAI on the
  // platform key, no point re-burning requests until the operator rotates.
  // After AUTO_UNSTICK_MS we let one probe through — on success the flag
  // auto-clears via the ledger's finish-row path, on another 401 the route
  // flips it straight back on. Keeps transient provider blips self-healing
  // without leaving a genuinely dead key burning requests.
  if (providerAuthFailed) {
    if (Date.now() - providerAuthFailedAt < AUTO_UNSTICK_MS) {
      return none("provider_auth_failed");
    }
    // Silent probe window — fall through to normal resolution. If the probe
    // 401s again the route re-marks; we reset the timestamp here so probe
    // attempts are spaced AUTO_UNSTICK_MS apart rather than streaming in
    // burst from every concurrent request that hit the window boundary.
    providerAuthFailedAt = Date.now();
  }

  const dayStart = startOfUtcDay();
  const dayEnd = endOfUtcDay(dayStart);

  // L4: global circuit breaker. Applied before per-user checks so a runaway
  // DAU spike trips the global brake first.
  const globalToday = await cachedGlobalToday(dayStart);
  if (globalToday >= config.freeTier.dailyUsdCap) {
    return none("usd_cap_hit", dayEnd);
  }

  // L3: lifetime-per-user brake. Engaged real users will bump into this at
  // ~70 days of moderate use — the exhaustion card already points them to
  // BYOK or paid-access, so it's also the "graduate to paid" funnel.
  const userLifetime = await cachedUserLifetime(userId);
  if (userLifetime >= config.freeTier.lifetimeUsdPerUser) {
    return none("lifetime_usd_per_user_hit");
  }

  // L2: per-user daily dollar brake. Invisible to the user; kicks in only
  // if someone is gaming the 30/day counter (multi-tab race, bypass bug).
  const userDaily = await cachedUserDaily(userId, dayStart);
  if (userDaily >= config.freeTier.dailyUsdPerUser) {
    return none("daily_usd_per_user_hit", dayEnd);
  }

  // L1: the learner-visible 30/day counter. Only rows with
  // counts_toward_quota=true contribute, so system-initiated /summarize
  // calls don't drain the visible budget.
  //
  // H-2: the locked variant wraps the count in a per-user advisory xact
  // lock so multi-tab Ask clicks don't all observe the same pre-insert
  // count. Cross-user concurrency is unaffected.
  const questionsToday = await countPlatformQuestionsTodayLocked(userId, dayStart);
  if (questionsToday >= config.freeTier.dailyQuestions) {
    return none("free_exhausted", dayEnd);
  }

  // Platform key validation: assertConfigValid requires it when the feature
  // is enabled. This guard is defense-in-depth.
  const platformKey = config.freeTier.platformOpenaiApiKey;
  if (!platformKey) return none("free_disabled");

  return {
    source: "platform",
    key: platformKey,
    remainingToday: Math.max(0, config.freeTier.dailyQuestions - questionsToday),
    capToday: config.freeTier.dailyQuestions,
    allowedModels: PLATFORM_ALLOWED_MODELS,
    resetAtUtc: dayEnd,
  };
}
