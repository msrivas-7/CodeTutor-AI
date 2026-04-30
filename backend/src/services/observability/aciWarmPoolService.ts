// Phase 24B Slice 8: ACI warm pool service.
//
// Drives the warm-pool size on the AciExecutionBackend based on local
// pressure. Hysteresis: ramp up when local capacity is close to the cap
// (so the next overflow user gets a sub-second handoff instead of a
// 5–15 s cold start), drain when local has headroom (so we're not
// paying for idle ACI capacity nobody needs).
//
// Lives separate from AciExecutionBackend so the backend has no
// reference to HybridBackend (which knows the localActive count); the
// service holds both refs and bridges them. Same pattern as
// aciOperationalConfig + aciCostSampler.
//
// Defaults are conservative: high watermark = 12, low = 10, max pool
// size = 2. Idle cost cap: 2 × $0.053/hr × 24h = $2.54/day even if
// hysteresis somehow stuck above the high mark all day. The cost-cap
// kill switch (slice 5) is the absolute backstop above this.

import { config } from "../../config.js";
import { getAciOperationalConfig } from "./aciOperationalConfig.js";
import type { AciExecutionBackend } from "../execution/backends/aci.js";

const TICK_INTERVAL_MS = 30 * 1000;

// P2-5 (audit fix): backoff state for ARM-throttle protection. When
// spawnWarm fails consecutively (Azure ARM 429 on a hot region),
// continuing to hammer at 30 s cadence makes the throttle worse.
// `nextEligibleTickAt` is set into the future after each failure;
// tick() returns early until that time. Backoff doubles on each
// consecutive failure, capped at BACKOFF_CEILING_MS. Reset on success.
const BACKOFF_INITIAL_MS = 60 * 1000; // 1 min after first failure
const BACKOFF_CEILING_MS = 5 * 60 * 1000; // 5 min max

let timer: NodeJS.Timeout | null = null;
let backend: AciExecutionBackend | null = null;
let getLocalActive: (() => number) | null = null;
let consecutiveSpawnFailures = 0;
let nextEligibleTickAt = 0;

export interface AciWarmPoolOptions {
  /**
   * P2-2 (audit fix): all three watermark fields are now OPTIONAL test
   * overrides. Production reads from the operational-config mirror
   * (system_config keys aci_warm_high_watermark/etc) so an operator
   * can tune without a redeploy. Tests pass these to pin behavior in
   * unit tests independent of the DB / mirror state.
   */
  highWatermark?: number;
  lowWatermark?: number;
  maxPoolSize?: number;
  /**
   * Master enable. False keeps the timer alive but every tick is a
   * no-op (pool stays empty). Slice 8.5: this is admin-editable via
   * the system_config table and read fresh from `aciOperationalConfig`
   * on every tick — `options.enabled` is just the in-process
   * test-override hatch (see `__setAciWarmPoolOptionsForTests`).
   * Production should leave this undefined and let the live admin
   * toggle drive behavior.
   */
  enabled?: boolean;
}

let options: AciWarmPoolOptions = {};

/**
 * Boot the periodic tick. Idempotent; calling twice is a no-op. Safe to
 * call when overflow is wired but the runtime knob is off — every tick
 * just early-returns and the pool stays empty.
 */
export function startAciWarmPoolService(deps: {
  backend: AciExecutionBackend;
  getLocalActive: () => number;
  options?: Partial<AciWarmPoolOptions>;
}): void {
  if (timer) return;
  backend = deps.backend;
  getLocalActive = deps.getLocalActive;
  options = { ...options, ...(deps.options ?? {}) };

  // Kick the first tick on a delay so backend.ensureReady has time to
  // settle (factory wires both at boot in quick succession).
  setTimeout(() => {
    void tick();
    timer = setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
    if (timer.unref) timer.unref();
  }, 5_000).unref();

  console.log(
    JSON.stringify({
      level: "info",
      evt: "aci_warm_pool_service_started",
      tickIntervalMs: TICK_INTERVAL_MS,
      ...options,
    }),
  );
}

export function stopAciWarmPoolService(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  backend = null;
  getLocalActive = null;
  // P2-5: reset the ARM-throttle backoff so a fresh start() doesn't
  // carry over a backoff window from the prior service lifetime.
  consecutiveSpawnFailures = 0;
  nextEligibleTickAt = 0;
}

/** Test-only: override the synchronous options (e.g. enable for soak test). */
export function __setAciWarmPoolOptionsForTests(
  next: Partial<AciWarmPoolOptions>,
): void {
  options = { ...options, ...next };
}

/** Run one tick. Exported for tests + the boot warm-up call. */
export async function tick(): Promise<void> {
  if (!backend || !getLocalActive) return;
  // The enabled flag is admin-editable via the system_config table.
  // The synchronous mirror reflects the latest DB value (refreshed
  // every 30s + immediately on admin write). Tests can override via
  // `options.enabled` to force-enable without round-tripping the DB
  // mock — the test override wins when defined.
  const enabled =
    typeof options.enabled === "boolean"
      ? options.enabled
      : getAciOperationalConfig().warmPoolEnabled;
  if (!enabled) return;

  // P3-5 (audit fix): also gate on overflow being enabled. Pre-fix, an
  // operator who flipped `aci_warm_pool_enabled=true` while
  // `aci_overflow_enabled=false` would burn ~$2/day idle spend on warm
  // containers nothing was going to claim — overflow is off, so no
  // session ever spills to ACI in the first place. The two flags are
  // independent in the admin panel for flexibility, but this gate
  // prevents the dead-pay-load combination from accumulating cost.
  //
  // Tests use `options.enabled` to bypass DB-dependent state; when that
  // override is in play, the test is asserting warm-pool hysteresis in
  // isolation and the overflow gate is irrelevant.
  if (
    typeof options.enabled !== "boolean" &&
    !getAciOperationalConfig().enabled
  ) {
    return;
  }

  let localActive: number;
  try {
    localActive = getLocalActive();
  } catch {
    return; // refuse to act on bad signal
  }

  const currentWarm = backend.getWarmCount();

  // P2-2: read hysteresis values from the operational-config mirror so
  // an admin's tuning takes effect within the refresh interval. Static
  // `options` is reserved for the test-only override path.
  const op = getAciOperationalConfig();
  const highWatermark = options.highWatermark ?? op.warmHighWatermark;
  const lowWatermark = options.lowWatermark ?? op.warmLowWatermark;
  const maxPoolSize = options.maxPoolSize ?? op.warmMaxPoolSize;

  // Decide target. Hysteresis prevents flapping: between the two
  // watermarks, we KEEP the current target — we don't recompute toward
  // either bound.
  let target = currentWarm;
  if (localActive >= highWatermark) {
    target = maxPoolSize;
  } else if (localActive <= lowWatermark) {
    target = 0;
  }

  // P2-5: respect the ARM-throttle backoff window. spawnWarm is the
  // path that hits ARM hardest; drainOldestWarm goes through tryDelete
  // which is also ARM but a different rate-limit bucket. We back off
  // both sides to be conservative.
  if (Date.now() < nextEligibleTickAt) return;

  if (target > currentWarm) {
    // Spawn one container per tick — gentle ramp avoids thundering-herd
    // on Azure ARM (10s+ per spawn means simultaneous spawns risk
    // throttle). The next tick will spawn the next one.
    const ok = await backend.spawnWarm();
    if (ok) {
      // P2-5: success resets the backoff window so the next tick fires
      // on the normal cadence.
      consecutiveSpawnFailures = 0;
      nextEligibleTickAt = 0;
    } else {
      consecutiveSpawnFailures += 1;
      const backoffMs = Math.min(
        BACKOFF_INITIAL_MS * 2 ** (consecutiveSpawnFailures - 1),
        BACKOFF_CEILING_MS,
      );
      nextEligibleTickAt = Date.now() + backoffMs;
      console.warn(
        JSON.stringify({
          level: "warn",
          evt: "aci_arm_backoff_engaged",
          consecutiveFailures: consecutiveSpawnFailures,
          backoffMs,
        }),
      );
    }
  } else if (target < currentWarm) {
    // Drain one per tick. Same gentle pace; idle-cost reclaim is not
    // urgent.
    await backend.drainOldestWarm();
  }
}

/** Read snapshot for /api/health/deep + admin observability. */
export function getAciWarmPoolStatus(): {
  enabled: boolean;
  warmCount: number;
  highWatermark: number;
  lowWatermark: number;
  maxPoolSize: number;
} {
  const op = getAciOperationalConfig();
  return {
    enabled:
      typeof options.enabled === "boolean"
        ? options.enabled
        : op.warmPoolEnabled,
    warmCount: backend ? backend.getWarmCount() : 0,
    highWatermark: options.highWatermark ?? op.warmHighWatermark,
    lowWatermark: options.lowWatermark ?? op.warmLowWatermark,
    maxPoolSize: options.maxPoolSize ?? op.warmMaxPoolSize,
  };
}

// Mark `config` as used to satisfy TS in the unlikely case downstream
// readers want config-driven defaults later. Keeping the import wired
// here preserves a single import point for future operational knobs
// without re-shuffling imports across files.
void config;
