// Phase 23 P0 #3: periodic emitter for capacity-pressure signals. Writes
// a structured log line every 60s:
//
//   {"level":"info","evt":"capacity_pressure",
//    "sessions":N,"exec_inflight":N,"exec_queued":N,
//    "render_active":N,"render_waiting":N}
//
// The DCR forwards container stdout into Log Analytics as `ContainerLog_CL`,
// so alerts.bicep can key a scheduled-query rule on `evt:capacity_pressure`
// without needing a separate Prometheus scraper. Same pattern as the
// platform-cost-hourly sampler.
//
// Why log + alert instead of Prom-scrape: we don't run Prometheus today,
// and the audit prioritized "wake me up when capacity is hot" over
// "perfect histograms". A 60s-resolution log line is plenty for a 10-min
// sustained-breach alert. When/if we wire Prometheus, the same gauges in
// metrics.ts already exist — this sampler stays as a redundant signal or
// gets removed.

import { listSessions, backendQueueDepth } from "../session/sessionManager.js";
import { _renderQueueDepth } from "../share/renderQueue.js";

const SAMPLE_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

function sampleOnce(): void {
  const queue = backendQueueDepth();
  const renderQ = _renderQueueDepth();
  console.log(
    JSON.stringify({
      level: "info",
      t: new Date().toISOString(),
      evt: "capacity_pressure",
      sessions: listSessions().length,
      exec_inflight: queue.inFlight,
      exec_queued: queue.queued,
      render_active: renderQ.active,
      render_waiting: renderQ.waiting,
    }),
  );
}

export function startCapacityPressureSampler(): void {
  if (timer) return;
  // First sample after a short delay so boot logs aren't crowded with
  // a synthetic value before the backend has handled any traffic.
  setTimeout(() => {
    try {
      sampleOnce();
    } catch (err) {
      console.error("[capacity-pressure-sampler] first-sample error", err);
    }
  }, 30_000);
  timer = setInterval(() => {
    try {
      sampleOnce();
    } catch (err) {
      console.error("[capacity-pressure-sampler] error", err);
    }
  }, SAMPLE_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

export function stopCapacityPressureSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exported for tests.
export const _sampleOnceForTest = sampleOnce;
