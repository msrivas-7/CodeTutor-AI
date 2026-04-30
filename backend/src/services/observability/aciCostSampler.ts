// Phase 24B: ACI cost emitter.
//
// The cost tracker is now event-based (records on createSession + destroy
// in AciExecutionBackend), so no periodic sampling is needed for accuracy.
// This module just emits one structured log line per hour for alerting:
//
//   {"level":"info","evt":"aci_cost_hourly","active_sessions":<n>,
//    "spent_today_usd":<n>,"cap_today_usd":<n>,"exceeded":<bool>,
//    "hourly_burn_usd":<n>}
//
// The DCR forwards container stdout into Log Analytics as `ContainerLog_CL`,
// so the alerts.bicep scheduled-query rule keys on this marker without
// scraping a separate metrics endpoint. Hourly cadence keeps Log Analytics
// ingest tiny (24 lines/day) — the alert evaluates over a 1-hour window so
// emitting more often would just create noise.

import { config } from "../../config.js";
import { aciCostTracker } from "./aciCostTracker.js";
import type { AciExecutionBackend } from "../execution/backends/aci.js";

const EMIT_INTERVAL_MS = 60 * 60 * 1000; // 60min

let emitTimer: NodeJS.Timeout | null = null;
let registeredBackend: AciExecutionBackend | null = null;

/**
 * Start the periodic emission. Idempotent. Skips entirely when ACI overflow
 * is disabled (factory passes null in that case).
 */
export function startAciCostSampler(backend: AciExecutionBackend): void {
  if (emitTimer) return; // already running
  registeredBackend = backend;

  emitTimer = setInterval(emitHourly, EMIT_INTERVAL_MS);
  if (emitTimer.unref) emitTimer.unref();

  console.log(
    JSON.stringify({
      level: "info",
      evt: "aci_cost_sampler_started",
      emitIntervalMs: EMIT_INTERVAL_MS,
      dailyCapUsd: config.aci.dailyUsdCap,
    }),
  );
}

export function stopAciCostSampler(): void {
  if (emitTimer) {
    clearInterval(emitTimer);
    emitTimer = null;
  }
  registeredBackend = null;
}

function emitHourly(): void {
  // Pull the latest snapshot from the tracker. This includes in-flight
  // sessions billed up to NOW — same precision Azure uses on the invoice.
  const status = aciCostTracker.getStatus();
  const cap = config.aci.dailyUsdCap;
  const exceeded = status.spentTodayUsd >= cap;
  console.log(
    JSON.stringify({
      level: "info",
      t: new Date().toISOString(),
      evt: "aci_cost_hourly",
      active_sessions: status.activeSessions,
      spent_today_usd: round4(status.spentTodayUsd),
      cap_today_usd: cap,
      exceeded,
      hourly_burn_usd: round4(status.hourlyBurnRateUsd),
    }),
  );
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

// Currently the registered backend is unused (we read everything from the
// tracker singleton). Kept as a parameter so a future extension — e.g.,
// "pull queueDepth for cross-checks against the tracker's active count" —
// has a documented hook without needing a new wiring change.
void registeredBackend;
