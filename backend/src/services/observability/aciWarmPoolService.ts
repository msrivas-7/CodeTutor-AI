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

let timer: NodeJS.Timeout | null = null;
let backend: AciExecutionBackend | null = null;
let getLocalActive: (() => number) | null = null;

export interface AciWarmPoolOptions {
  /** Local-active count at/above which we keep the pool primed. */
  highWatermark: number;
  /** Local-active count at/below which we drain the pool. */
  lowWatermark: number;
  /** Hard cap — never more warm containers than this regardless of pressure. */
  maxPoolSize: number;
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

let options: AciWarmPoolOptions = {
  highWatermark: 12,
  lowWatermark: 10,
  maxPoolSize: 2,
};

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

  let localActive: number;
  try {
    localActive = getLocalActive();
  } catch {
    return; // refuse to act on bad signal
  }

  const currentWarm = backend.getWarmCount();

  // Decide target. Hysteresis prevents flapping: between the two
  // watermarks, we KEEP the current target — we don't recompute toward
  // either bound.
  let target = currentWarm;
  if (localActive >= options.highWatermark) {
    target = options.maxPoolSize;
  } else if (localActive <= options.lowWatermark) {
    target = 0;
  }

  if (target > currentWarm) {
    // Spawn one container per tick — gentle ramp avoids thundering-herd
    // on Azure ARM (10s+ per spawn means simultaneous spawns risk
    // throttle). The next tick will spawn the next one.
    await backend.spawnWarm();
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
  return {
    enabled:
      typeof options.enabled === "boolean"
        ? options.enabled
        : getAciOperationalConfig().warmPoolEnabled,
    warmCount: backend ? backend.getWarmCount() : 0,
    highWatermark: options.highWatermark,
    lowWatermark: options.lowWatermark,
    maxPoolSize: options.maxPoolSize,
  };
}

// Mark `config` as used to satisfy TS in the unlikely case downstream
// readers want config-driven defaults later. Keeping the import wired
// here preserves a single import point for future operational knobs
// without re-shuffling imports across files.
void config;
