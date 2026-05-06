// Bucket 6 — S-12: periodic emitter for the rolling-hour platform AI spend.
// Runs once an hour and writes a structured log line:
//
//   {"level":"info","evt":"platform_cost_hourly","sum_usd":<n>,"threshold_usd":<n>,"exceeded":<bool>}
//
// The DCR forwards container stdout into Log Analytics as `ContainerLog_CL`,
// so alerts.bicep can key a scheduled-query rule on this marker without
// Log Analytics ever needing to read from Supabase directly. The threshold
// mirrors the audit spec: alert when hourly platform sum > 2 × daily cap,
// which is roughly "burned a full day's worth of budget in one hour" —
// pathological enough to warrant a page even though L4 already hard-caps
// absolute daily spend.

import { sumPlatformCostTodayAllSources } from "../../db/usageLedger.js";
import { config } from "../../config.js";
import { getEffectiveDailyUsdCap } from "../ai/effectiveCaps.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function sampleOnce(): Promise<void> {
  const since = new Date(Date.now() - ONE_HOUR_MS);
  // Phase 27 §3d: include anon spend so the "$30 in 1 hour" page-oncall
  // alert sees the full picture; the rolling-hour sampler must agree
  // with the resolver's L4 view.
  const sum = await sumPlatformCostTodayAllSources(since);
  const dailyCap = await getEffectiveDailyUsdCap();
  const threshold = dailyCap * 2;
  const exceeded = sum > threshold;
  console.log(
    JSON.stringify({
      level: "info",
      t: new Date().toISOString(),
      evt: "platform_cost_hourly",
      sum_usd: Number(sum.toFixed(4)),
      threshold_usd: Number(threshold.toFixed(4)),
      exceeded,
    }),
  );
}

export function startPlatformCostSampler(): void {
  if (timer) return;
  // No platform spend exists when free tier is off — every resolve goes to
  // BYOK (or rejects). Skip the periodic read to avoid touching the DB for
  // a metric that's guaranteed zero.
  if (!config.freeTier.enabled) return;
  // First sample ~60s after boot so we don't block startup on a DB roundtrip.
  setTimeout(() => {
    void sampleOnce().catch((err) =>
      console.error("[platform-cost-sampler] first-sample error", err),
    );
  }, 60_000);
  timer = setInterval(() => {
    void sampleOnce().catch((err) =>
      console.error("[platform-cost-sampler] error", err),
    );
  }, ONE_HOUR_MS);
  if (timer.unref) timer.unref();
}

export function stopPlatformCostSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exported for tests.
export const _sampleOnceForTest = sampleOnce;
