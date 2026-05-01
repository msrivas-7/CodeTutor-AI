// Phase 24B Slice 6.5: synchronous mirror of the admin-editable ACI knobs.
//
// HybridBackend's kill-switch + dynamic-cap reads are on the hot path of
// every session-create call, so they need to be SYNC. The system_config
// table read is async (DB roundtrip with 60s in-module cache). To bridge
// these, we maintain a synchronous in-memory mirror here:
//
//   - Initialized at boot from system_config (with env defaults as
//     fallback when the DB is empty / unreachable).
//   - Refreshed on a 30s timer so admin-panel changes propagate within
//     half a minute even if the admin route doesn't invalidate explicitly.
//   - Invalidated immediately by the admin route after a successful PUT
//     so an operator's emergency kill takes effect within seconds.
//
// Keys mirrored:
//   - aci_overflow_enabled  (boolean) → runtime kill switch
//   - aci_daily_usd_cap     (number)  → $/day before cost-cap kill switch
//   - aci_max_overflow      (number)  → concurrent ACI sessions past local
//
// Static infra (AZURE_*, ACI_SUBNET_ID, ACI_RUNNER_IMAGE, sidecarPort,
// coldStartTimeoutMs) deliberately stays env-only — those want version
// control via the Key Vault → refresh-env runbook, not an admin UI.

import { config } from "../../config.js";
import { getSystemConfig } from "../../db/systemConfig.js";

const REFRESH_INTERVAL_MS = 30_000;
// P0-4 (audit fix): if no successful refresh has landed in this many
// intervals, the watchdog forces `enabled = false` regardless of cached
// values. Defends against silent DB failure (`getSystemConfig` throws
// repeatedly): without this, the cache would freeze with whatever was
// last seen, which on first-boot is ENV defaults (potentially
// `enabled: true`) — meaning a DB outage at boot would let overflow
// stay live even though the operator's runtime DB toggle is unreachable.
const REFRESH_WATCHDOG_INTERVALS = 5;
// P1-4 (second-audit fix): hard timeout for a single refreshOnce call.
// The Supabase transaction pooler + lack of statement_timeout means
// a stuck `getSystemConfig` could keep `inFlightRefresh` non-null
// indefinitely. Subsequent `invalidateAciOperationalConfig()` calls
// (admin-route emergency kill switch) would then short-circuit on
// the wedged in-flight promise and never resolve. 8 s is generous
// for a 4-key SELECT batch; anything beyond means DB is on fire and
// we should null out the in-flight slot so the next caller can retry.
const REFRESH_HARD_TIMEOUT_MS = 8_000;

// Shape of the synchronous mirror. Initialized from env at module load
// so reads BEFORE the first refresh still return sensible defaults
// (matches Phase 23 behavior pre-admin-toggle).
interface AciOperationalConfig {
  /** Master runtime gate. False = no new ACI spawns + cap shrinks to local. */
  enabled: boolean;
  /** $/day before cost-cap kill switch fires. */
  dailyUsdCap: number;
  /** Max concurrent ACI sessions past local cap. 0 = effectively off. */
  maxOverflow: number;
  /**
   * Slice 8 warm-pool master toggle. True = service may pre-spawn
   * 1–2 ACI containers when local capacity is close to its cap.
   * False = pool stays at zero regardless of pressure (zero idle
   * cost). Admin-editable so the operator can flip on if cold-start
   * latency surfaces post-launch, without a redeploy.
   */
  warmPoolEnabled: boolean;
  /** P2-2: warm-pool hysteresis knobs, admin-editable. Defaults match
   * the original constants (12/10/2). */
  warmHighWatermark: number;
  warmLowWatermark: number;
  warmMaxPoolSize: number;
}

let cached: AciOperationalConfig = {
  enabled: config.aci.enabled,
  dailyUsdCap: config.aci.dailyUsdCap,
  maxOverflow: config.aci.maxOverflow,
  warmPoolEnabled: config.aci.warmPoolEnabled,
  // Defaults match the original constants in aciWarmPoolService.ts.
  // config.aci.warmPool* will overlay if env-set; system_config takes
  // precedence after the first DB refresh.
  warmHighWatermark: config.aci.warmHighWatermark ?? 12,
  warmLowWatermark: config.aci.warmLowWatermark ?? 10,
  warmMaxPoolSize: config.aci.warmMaxPoolSize ?? 2,
};

let refreshTimer: NodeJS.Timeout | null = null;
let inFlightRefresh: Promise<void> | null = null;
// P0-4: track when the last refresh round-tripped the DB successfully.
// `null` until the first success; consumed by the watchdog in
// `getAciOperationalConfig()` and the deep-health probe.
let lastSuccessfulRefreshAt: number | null = null;

async function refreshOnce(): Promise<void> {
  // Concurrent refresh requests share one DB roundtrip — no thundering
  // herd if both the periodic timer and an admin invalidate fire at the
  // same moment.
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    // P1-4 (second-audit fix): hard-cap the refresh body. Without this,
    // a stuck `getSystemConfig` keeps `inFlightRefresh` non-null forever
    // and any subsequent `invalidateAciOperationalConfig()` call (admin
    // emergency kill switch) blocks on the same wedged promise. The
    // race wraps the DB-batch fetch against a deadline; on miss, we
    // log the timeout, leave `cached` untouched (last-good values stay
    // for the watchdog window), and clear `inFlightRefresh` in the
    // finally so the next caller can retry.
    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      deadlineTimer = setTimeout(() => resolve("timeout"), REFRESH_HARD_TIMEOUT_MS);
    });
    try {
      const fetchAll = Promise.all([
        getSystemConfig("aci_overflow_enabled", { bypassCache: true }),
        getSystemConfig("aci_daily_usd_cap", { bypassCache: true }),
        getSystemConfig("aci_max_overflow", { bypassCache: true }),
        getSystemConfig("aci_warm_pool_enabled", { bypassCache: true }),
        getSystemConfig("aci_warm_high_watermark", { bypassCache: true }),
        getSystemConfig("aci_warm_low_watermark", { bypassCache: true }),
        getSystemConfig("aci_warm_max_pool_size", { bypassCache: true }),
      ]);
      const winner = await Promise.race([fetchAll, deadline]);
      if (winner === "timeout") {
        console.error(
          JSON.stringify({
            level: "error",
            evt: "aci_operational_config_refresh_timeout",
            budgetMs: REFRESH_HARD_TIMEOUT_MS,
          }),
        );
        return; // skip the cache-update path; finally will clear in-flight
      }
      const [
        enabledRow,
        capRow,
        overflowRow,
        warmPoolRow,
        highRow,
        lowRow,
        maxRow,
      ] = winner;
      cached = {
        enabled:
          typeof enabledRow?.value === "boolean"
            ? enabledRow.value
            : config.aci.enabled,
        dailyUsdCap:
          typeof capRow?.value === "number"
            ? capRow.value
            : config.aci.dailyUsdCap,
        maxOverflow:
          typeof overflowRow?.value === "number"
            ? overflowRow.value
            : config.aci.maxOverflow,
        warmPoolEnabled:
          typeof warmPoolRow?.value === "boolean"
            ? warmPoolRow.value
            : config.aci.warmPoolEnabled,
        warmHighWatermark:
          typeof highRow?.value === "number"
            ? highRow.value
            : config.aci.warmHighWatermark ?? 12,
        warmLowWatermark:
          typeof lowRow?.value === "number"
            ? lowRow.value
            : config.aci.warmLowWatermark ?? 10,
        warmMaxPoolSize:
          typeof maxRow?.value === "number"
            ? maxRow.value
            : config.aci.warmMaxPoolSize ?? 2,
      };
      // P2-3 (audit fix): startup log every key + its source ON THE FIRST
      // refresh only. Source = "db" when system_config has a row, "env"
      // otherwise. A surprising "db" entry on a fresh deploy = stale row
      // from a prior dev/test deploy → operator can spot it at a glance
      // and DELETE via admin UI if not intended.
      const isFirstRefresh = lastSuccessfulRefreshAt === null;
      lastSuccessfulRefreshAt = Date.now();
      if (isFirstRefresh) {
        const src = (row: { value: unknown } | null): "db" | "env" =>
          row && row.value !== undefined ? "db" : "env";
        console.log(
          JSON.stringify({
            level: "info",
            evt: "aci_op_config_loaded",
            enabled: { value: cached.enabled, source: src(enabledRow) },
            dailyUsdCap: { value: cached.dailyUsdCap, source: src(capRow) },
            maxOverflow: { value: cached.maxOverflow, source: src(overflowRow) },
            warmPoolEnabled: {
              value: cached.warmPoolEnabled,
              source: src(warmPoolRow),
            },
            warmHighWatermark: {
              value: cached.warmHighWatermark,
              source: src(highRow),
            },
            warmLowWatermark: {
              value: cached.warmLowWatermark,
              source: src(lowRow),
            },
            warmMaxPoolSize: {
              value: cached.warmMaxPoolSize,
              source: src(maxRow),
            },
          }),
        );
      }
    } catch (err) {
      // DB unreachable or query error — keep the previous cached values.
      // Env defaults are the safety floor; the previous successful
      // refresh's values are the next-best safety net. NEVER null out
      // the cache, that would surface as "everything off" to readers.
      console.error(
        JSON.stringify({
          level: "error",
          evt: "aci_operational_config_refresh_failed",
          err: (err as Error).message,
        }),
      );
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

/**
 * Boot the periodic refresh. Idempotent — calling twice is a no-op. The
 * factory calls this when ACI overflow is wired (regardless of admin-set
 * runtime values; even an "enabled: false" override needs the periodic
 * refresh to detect a re-enable). Skipped entirely when ACI is not wired
 * at boot (factory passed aci=null).
 */
export function startAciOperationalConfigRefresh(): void {
  if (refreshTimer) return;
  // Kick off the first refresh immediately so the first read post-boot
  // sees DB values, not just env defaults. Don't await — boot continues
  // with env defaults until the DB roundtrip resolves; the next read
  // (typically seconds later) sees fresh state.
  void refreshOnce();
  refreshTimer = setInterval(() => {
    void refreshOnce();
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref();
}

/**
 * P0-4 (audit fix): block boot until the first refresh has either
 * succeeded OR a hard timeout has elapsed. Without this, there is a
 * window between "factory wired ACI" and "first refresh lands" where
 * HybridBackend reads env defaults — meaning an admin who set
 * `enabled=false` in DB sees overflow active for those first ~30-1000ms
 * after every backend restart. The hard timeout (boot-budget) keeps a
 * truly-down DB from blocking the entire boot sequence; if the timeout
 * fires, the watchdog in `getAciOperationalConfig()` will force
 * `enabled: false` until the DB recovers, which is the safer posture.
 *
 * Returns `{ ok: true }` if the refresh landed within budget, `{ ok:
 * false }` if it timed out (and the watchdog will take over safety).
 */
export async function awaitFirstRefresh(
  timeoutMs = 5_000,
): Promise<{ ok: boolean }> {
  if (lastSuccessfulRefreshAt !== null) return { ok: true };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const result = await Promise.race([
      refreshOnce().then(() =>
        lastSuccessfulRefreshAt !== null ? "ok" : "fail",
      ),
      deadline,
    ]);
    return { ok: result === "ok" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function stopAciOperationalConfigRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Synchronous read for the hot path. Returns the most recent cached
 * snapshot; if the DB is unreachable or hasn't been read yet, returns
 * env defaults (set at module load). Never throws.
 *
 * P0-4 watchdog: when the last successful refresh is older than
 * 5 × interval (≈150 s), force `enabled: false` regardless of cached
 * values. A silent DB failure must NOT let the cache freeze on
 * `enabled: true` — the safer posture under DB-unreachable is "no new
 * ACI spawns until DB recovers." The watchdog is stateless: it queries
 * the timestamp every read, so a recovered DB unfreezes it on the
 * next successful refresh automatically.
 *
 * P1-3 (second-audit fix): the watchdog also zeros `dailyUsdCap` and
 * `maxOverflow` when stale. Pre-fix, only `enabled` was forced —
 * meaning the cost sampler emitted a stale cap value, the kill-switch
 * math read a stale cap, and the factory's effectiveCap reported a
 * stale max. Different consumers saw different "truth" for the same
 * stale-watchdog window. Forcing all three knobs to safe defaults
 * keeps every consumer aligned: cap=0 means anything > 0 trips the
 * kill switch, max=0 means HybridBackend.effectiveCap collapses to
 * localCap. Warm-pool watermarks aren't touched because the warm-
 * pool tick already gates on op.enabled (see P3-5 fix), so making
 * watermarks safe-default would be redundant.
 */
export function getAciOperationalConfig(): AciOperationalConfig {
  if (isRefreshStale()) {
    return {
      ...cached,
      enabled: false,
      dailyUsdCap: 0,
      maxOverflow: 0,
    };
  }
  return cached;
}

function isRefreshStale(): boolean {
  if (lastSuccessfulRefreshAt === null) {
    // No successful refresh has ever landed. Boot watchdog: env defaults
    // are still in `cached`, but the operator's DB toggle has not been
    // observed. Force OFF to keep us in the safer posture until the DB
    // talks back.
    return true;
  }
  const ageMs = Date.now() - lastSuccessfulRefreshAt;
  return ageMs > REFRESH_INTERVAL_MS * REFRESH_WATCHDOG_INTERVALS;
}

/**
 * P0-4: surface refresh staleness for /api/health/deep. Returns
 * milliseconds since the last successful refresh, or `null` if the
 * first refresh has not yet succeeded since boot. Operators query
 * this to confirm the cache is live; alerting can fire on `> 150_000`.
 */
export function getAciOperationalConfigRefreshAgeMs(): number | null {
  if (lastSuccessfulRefreshAt === null) return null;
  return Date.now() - lastSuccessfulRefreshAt;
}

/**
 * Force an immediate refresh. Called by the admin route after a
 * successful PUT to one of the ACI keys, so the change takes effect
 * within ms instead of waiting for the periodic timer.
 */
export async function invalidateAciOperationalConfig(): Promise<void> {
  await refreshOnce();
}

/** Test-only: force the cached state. Never call in prod code. */
export function __forceAciOperationalConfigForTests(
  state: Partial<AciOperationalConfig> & {
    lastSuccessfulRefreshAt?: number | null;
  },
): void {
  cached = {
    ...cached,
    ...(state.enabled !== undefined && { enabled: state.enabled }),
    ...(state.dailyUsdCap !== undefined && { dailyUsdCap: state.dailyUsdCap }),
    ...(state.maxOverflow !== undefined && { maxOverflow: state.maxOverflow }),
    ...(state.warmPoolEnabled !== undefined && {
      warmPoolEnabled: state.warmPoolEnabled,
    }),
    ...(state.warmHighWatermark !== undefined && {
      warmHighWatermark: state.warmHighWatermark,
    }),
    ...(state.warmLowWatermark !== undefined && {
      warmLowWatermark: state.warmLowWatermark,
    }),
    ...(state.warmMaxPoolSize !== undefined && {
      warmMaxPoolSize: state.warmMaxPoolSize,
    }),
  };
  if (state.lastSuccessfulRefreshAt !== undefined) {
    lastSuccessfulRefreshAt = state.lastSuccessfulRefreshAt;
  } else {
    // Default to "fresh enough" so the watchdog doesn't disturb tests
    // that don't care about staleness.
    lastSuccessfulRefreshAt = Date.now();
  }
}
