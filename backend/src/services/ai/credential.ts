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
import { isEmailConfirmed } from "../../db/userEmailConfirm.js";
import {
  countPlatformQuestionsOnIpTodayLocked,
  countPlatformQuestionsTodayLocked,
  startOfUtcDay,
  sumPlatformCostLifetimeForUser,
  sumPlatformCostTodayAnonGlobal,
  sumPlatformCostTodayForUser,
  sumPlatformCostTodayGlobal,
} from "../../db/usageLedger.js";
import {
  getEffectiveAnonDailyUsdCap,
  getEffectiveDailyQuestionsCap,
  getEffectiveDailyUsdCap,
  getEffectiveDailyUsdCapPerUser,
  getEffectiveFreeTierEnabled,
  getEffectiveLifetimeUsdCapPerUser,
} from "./effectiveCaps.js";
import { PLATFORM_ALLOWED_MODELS } from "./pricing.js";

export type CredentialNoneReason =
  | "no_key"
  | "free_disabled"
  | "free_exhausted"
  | "daily_usd_per_user_hit"
  | "lifetime_usd_per_user_hit"
  | "usd_cap_hit"
  | "denylisted"
  | "provider_auth_failed"
  | "email_not_confirmed"
  // Phase 27 §3d — anonymous (signed-out) caller exhausted their per-IP
  // daily count. Caller surfaces a sign-up wall, not the generic 30/day
  // exhaustion card.
  | "anon_exhausted";

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

// Phase 27 §3d: anonymous-side cache invalidation hook. Currently a
// no-op: the L4 path reads the anon side fresh on every call
// (sumPlatformCostTodayAnonGlobal — small table, low query cost), so
// a freshly-written anon row is visible immediately without any
// cache to bust. The authed-side cache (globalCache.today) wraps
// only the AUTHED ledger query, so an anon write doesn't touch its
// validity.
//
// Why keep the export anyway: §3a's anon route handler should call
// this after writing a ledger row by symmetry with how the authed
// route calls invalidateUsageCaches(). If we ever introduce caching
// on the anon side (e.g., to handle a higher-volume anon faucet),
// the call sites won't have to change — flip this from a no-op to
// the matching reset and the cache stays honest.
//
// Do NOT bust globalCache.today here: that cache wraps the authed
// half only, and busting it on every anon write would penalize the
// authed L4 hot path with an extra DB hit it didn't need.
export function invalidateAnonUsageCaches(): void {
  // intentional no-op; see header comment
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

export async function resolveAICredential(
  userId: string,
  // P-M7: /ai-status fetches BYOK cipher + paid-interest flag in a single
  // PK lookup via getAIStatusPrefs, so it already has the decrypted key
  // when it calls us. Accept it here to skip the redundant getOpenAIKey
  // round-trip. `undefined` = caller didn't prefetch (AI routes); `null` =
  // prefetched and user has no BYOK key; string = prefetched key.
  prefetchedByok?: string | null,
): Promise<AICredential> {
  // L0: BYOK always wins. If the user has pasted their own key, we never
  // touch the platform path — their spend is their meter.
  const byok =
    prefetchedByok !== undefined ? prefetchedByok : await getOpenAIKey(userId);
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
  // Phase 20-P5: resolver consults system_config first; env stays as
  // disaster-recovery default if no override row exists.
  if (!(await getEffectiveFreeTierEnabled())) return none("no_key");

  // L5: targeted kill. Operator INSERTs a row, cache expires within 60s,
  // user hits a 403 on their next request. BYOK users unaffected (we
  // already returned above).
  if (await isDenylisted(userId)) return none("denylisted");

  // Phase 22A — L5b: defense-in-depth email-confirm gate. Supabase's
  // default flow refuses to issue a JWT until email_confirmed_at is
  // stamped, but that's a project-config setting; if it ever flips,
  // the JWT-only check leaves the per-user / lifetime / global $ caps
  // open to email-farming. We always check `auth.users.email_confirmed_at`
  // before letting platform-funded AI flow. Confirmed-once is cached
  // per-process forever (a confirmed email never un-confirms).
  if (!(await isEmailConfirmed(userId))) return none("email_not_confirmed");

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
  // Phase 20-P5: cap resolved via getEffectiveDailyUsdCap() which consults
  // system_config row first, falls through to env default.
  // Phase 27 §3d: must add anon spend to the comparison. Once the anon
  // route is live, anon writes to a SEPARATE ledger table; the L4
  // ceiling is one ceiling for both. If we read only the authed sum
  // here, the watcher/resolver agreement (every observer + the
  // resolver see the same "today spend") breaks: the watcher's 100%
  // alert email would fire while this branch keeps authorizing
  // authed traffic, blowing past the operator's wallet brake.
  // Authed half stays cached (60s TTL) — anon half is fresh (small
  // table, low query cost in steady state).
  const dailyUsdCap = await getEffectiveDailyUsdCap();
  const authedToday = await cachedGlobalToday(dayStart);
  const anonToday = await sumPlatformCostTodayAnonGlobal(dayStart);
  if (authedToday + anonToday >= dailyUsdCap) {
    return none("usd_cap_hit", dayEnd);
  }

  // L3: lifetime-per-user brake. Engaged real users will bump into this at
  // ~70 days of moderate use — the exhaustion card already points them to
  // BYOK or paid-access, so it's also the "graduate to paid" funnel.
  // Phase 20-P5: per-user override > project override > env default.
  const lifetimeUsdCapPerUser = await getEffectiveLifetimeUsdCapPerUser(userId);
  const userLifetime = await cachedUserLifetime(userId);
  if (userLifetime >= lifetimeUsdCapPerUser) {
    return none("lifetime_usd_per_user_hit");
  }

  // L2: per-user daily dollar brake. Invisible to the user; kicks in only
  // if someone is gaming the 30/day counter (multi-tab race, bypass bug).
  // Phase 20-P5: same precedence as L3.
  const dailyUsdCapPerUser = await getEffectiveDailyUsdCapPerUser(userId);
  const userDaily = await cachedUserDaily(userId, dayStart);
  if (userDaily >= dailyUsdCapPerUser) {
    return none("daily_usd_per_user_hit", dayEnd);
  }

  // L1: the learner-visible 30/day counter. Only rows with
  // counts_toward_quota=true contribute, so system-initiated /summarize
  // calls don't drain the visible budget.
  //
  // H-2: the locked variant wraps the count in a per-user advisory xact
  // lock so multi-tab Ask clicks don't all observe the same pre-insert
  // count. Cross-user concurrency is unaffected.
  // Phase 20-P5: cap from per-user override or project default; env is
  // the final fallback.
  const dailyQuestionsCap = await getEffectiveDailyQuestionsCap(userId);
  const questionsToday = await countPlatformQuestionsTodayLocked(userId, dayStart);
  if (questionsToday >= dailyQuestionsCap) {
    return none("free_exhausted", dayEnd);
  }

  // Platform key validation: assertConfigValid requires it when the feature
  // is enabled. This guard is defense-in-depth.
  const platformKey = config.freeTier.platformOpenaiApiKey;
  if (!platformKey) return none("free_disabled");

  return {
    source: "platform",
    key: platformKey,
    remainingToday: Math.max(0, dailyQuestionsCap - questionsToday),
    capToday: dailyQuestionsCap,
    allowedModels: PLATFORM_ALLOWED_MODELS,
    resetAtUtc: dayEnd,
  };
}

// =============================================================================
// Phase 27 §3d — anonymous (signed-out) AI credential resolver.
//
// Mirrors resolveAICredential but keyed by an IP hash instead of a userId.
// The cap chain is a strict subset:
//
//   L9     ENABLE_FREE_TIER !== '1'             → none / free_disabled
//   provider-auth kill                          → none / provider_auth_failed
//   L4     global daily $ ≥ FREE_TIER_DAILY_USD_CAP → none / usd_cap_hit
//          (sums BOTH the authed ai_usage_ledger AND the anon
//           ai_anon_usage_ledger so anon spend can't blow past the
//           ceiling by writing to a different table)
//   L_anon per-IP-hash daily count ≥ ANON_DAILY_QUESTIONS_PER_IP
//                                              → none / anon_exhausted
//   else                                       → platform + remainingToday
//
// What's intentionally MISSING vs the authed chain:
//   - L0  BYOK — anonymous can't have a personal key.
//   - L5  ai_platform_denylist — keyed by user_id; no parallel anon list yet.
//   - L5b email_confirmed gate — N/A.
//   - L3  lifetime per-user $ — IP can rotate; lifetime over an IP is
//         either toothless (rotate) or over-blocking (shared NAT). The
//         per-IP daily count + global $ cap together do the work.
//   - L2  daily per-user $ — same rationale.
//
// The bounded-cost envelope for anon is therefore:
//   per-request output cap (Phase 27 §3b: anonMaxOutputTokens=512)
//   × per-IP daily count (anonDailyQuestionsPerIp=8)
//   ≤ 4K output tokens / IP / day
//   ≤ ~$0.002 / IP / day at gpt-4.1-nano rates
// And L4 ($15/day default) is the global ceiling regardless of IP count.

export async function resolveAnonAICredential(
  ipHash: string,
): Promise<AICredential> {
  // L9: same nuclear kill as the authed path. If free tier is off,
  // anon gets nothing.
  if (!(await getEffectiveFreeTierEnabled())) return none("no_key");

  // Provider-auth kill: same probe-window semantics as authed.
  if (providerAuthFailed) {
    if (Date.now() - providerAuthFailedAt < AUTO_UNSTICK_MS) {
      return none("provider_auth_failed");
    }
    providerAuthFailedAt = Date.now();
  }

  const dayStart = startOfUtcDay();
  const dayEnd = endOfUtcDay(dayStart);

  // L4: global $ cap — sums BOTH ledger tables. Anon traffic must count
  // toward the same ceiling that protects the operator's wallet from
  // a runaway authed DAU spike. Cached read on the authed half;
  // anon half is a fresh query (anon volume is small relative to
  // authed in steady state).
  const dailyUsdCap = await getEffectiveDailyUsdCap();
  const authedToday = await cachedGlobalToday(dayStart);
  const anonToday = await sumPlatformCostTodayAnonGlobal(dayStart);
  if (authedToday + anonToday >= dailyUsdCap) {
    return none("usd_cap_hit", dayEnd);
  }

  // L4a (Phase A — A5): anon-ONLY global daily $ ceiling, tighter than
  // the combined L4. A viral anon spike shuts off anon AI at this cap
  // (until UTC midnight) while authed free-tier traffic keeps spending
  // up to L4 — anon can never starve signed-up learners' budget.
  // Reuses the usd_cap_hit reason → same PLATFORM_AI_PAUSED surface
  // the anon frontend already handles.
  const anonUsdCap = await getEffectiveAnonDailyUsdCap();
  if (anonToday >= anonUsdCap) {
    return none("usd_cap_hit", dayEnd);
  }

  // L_anon: per-IP-hash daily question count. Locked variant prevents
  // a multi-tab race from observing the same pre-insert count and
  // writing two rows past the cap.
  const anonCap = config.freeTier.anonDailyQuestionsPerIp;
  const questionsToday = await countPlatformQuestionsOnIpTodayLocked(
    ipHash,
    dayStart,
  );
  if (questionsToday >= anonCap) {
    return none("anon_exhausted", dayEnd);
  }

  // Platform key validation: same defense-in-depth as the authed path.
  const platformKey = config.freeTier.platformOpenaiApiKey;
  if (!platformKey) return none("free_disabled");

  return {
    source: "platform",
    key: platformKey,
    remainingToday: Math.max(0, anonCap - questionsToday),
    capToday: anonCap,
    allowedModels: PLATFORM_ALLOWED_MODELS,
    resetAtUtc: dayEnd,
  };
}
