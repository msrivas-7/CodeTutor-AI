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
}

let cached: AciOperationalConfig = {
  enabled: config.aci.enabled,
  dailyUsdCap: config.aci.dailyUsdCap,
  maxOverflow: config.aci.maxOverflow,
  warmPoolEnabled: config.aci.warmPoolEnabled,
};

let refreshTimer: NodeJS.Timeout | null = null;
let inFlightRefresh: Promise<void> | null = null;

async function refreshOnce(): Promise<void> {
  // Concurrent refresh requests share one DB roundtrip — no thundering
  // herd if both the periodic timer and an admin invalidate fire at the
  // same moment.
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const [enabledRow, capRow, overflowRow, warmPoolRow] = await Promise.all([
        getSystemConfig("aci_overflow_enabled", { bypassCache: true }),
        getSystemConfig("aci_daily_usd_cap", { bypassCache: true }),
        getSystemConfig("aci_max_overflow", { bypassCache: true }),
        getSystemConfig("aci_warm_pool_enabled", { bypassCache: true }),
      ]);
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
      };
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
 */
export function getAciOperationalConfig(): AciOperationalConfig {
  return cached;
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
  state: Partial<AciOperationalConfig>,
): void {
  cached = { ...cached, ...state };
}
