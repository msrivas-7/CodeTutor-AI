// Phase 24B P3-3 + P3-5: periodic emitter for ACI health signals that
// don't have a dedicated event-driven log line. Writes structured log
// lines every 60 s when the corresponding signal is active:
//
//   {"level":"warn","evt":"aci_counter_drift","drift":N}
//     — fires when HybridBackend's localActive/aciActive counters have
//     drifted negative. Drift means a destroy ran more times than a
//     create on at least one backend → lifecycle-invariant break.
//
//   {"level":"warn","evt":"aci_op_config_watchdog_engaged","ageMs":N}
//     — fires when the operational-config refresh is stale (> 150 s).
//     The watchdog inside `getAciOperationalConfig` is forcing
//     enabled=false / dailyUsdCap=0 / maxOverflow=0 for safety; the
//     operator should investigate DB connectivity.
//
// Both events ride the existing ContainerLog_CL → Log Analytics path,
// so alerts.bicep keys scheduled-query rules on the `evt` marker
// without needing a Prometheus scraper.

import { backendCounterDrift } from "../session/sessionManager.js";
import { getAciOperationalConfigRefreshAgeMs } from "./aciOperationalConfig.js";

const SAMPLE_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MS = 150_000; // 5 × 30 s refresh interval

let timer: NodeJS.Timeout | null = null;

function sampleOnce(): void {
  const drift = backendCounterDrift();
  if (drift > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        t: new Date().toISOString(),
        evt: "aci_counter_drift",
        drift,
      }),
    );
  }
  const ageMs = getAciOperationalConfigRefreshAgeMs();
  if (ageMs === null || ageMs > STALE_THRESHOLD_MS) {
    console.warn(
      JSON.stringify({
        level: "warn",
        t: new Date().toISOString(),
        evt: "aci_op_config_watchdog_engaged",
        ageMs,
      }),
    );
  }
}

export function startAciHealthSampler(): void {
  if (timer) return;
  // First sample after 30 s so boot doesn't immediately fire stale
  // watchdog logs (the first refresh hasn't necessarily landed yet).
  setTimeout(() => {
    try {
      sampleOnce();
    } catch (err) {
      console.error("[aci-health-sampler] first-sample error", err);
    }
  }, 30_000);
  timer = setInterval(() => {
    try {
      sampleOnce();
    } catch (err) {
      console.error("[aci-health-sampler] error", err);
    }
  }, SAMPLE_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

export function stopAciHealthSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exported for tests.
export const _sampleOnceForTest = sampleOnce;
