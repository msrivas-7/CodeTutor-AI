// Phase 23 P0 #4: orphan share-image GC.
//
// The `share-og` Supabase Storage bucket is bounded by the free-tier
// 1 GB ceiling. At ~200 KB/share-pair (OG + Story PNG), 5k shares fills
// it; one farmed account on the per-day cap could approach that on its
// own in a few weeks. This sweeper deletes the storage objects (NOT the
// DB rows) for shares that are:
//   - older than 90 days
//   - never viewed (view_count == 0)
//   - not already revoked
// The DB row stays — the share URL remains live, falling back to the
// default OG image if a viewer turns up after the cron has run. The
// per-user lifetime-cap math still counts the row (a learner can't
// game the cap by waiting for GC).
//
// Cadence: once daily. Same setTimeout-to-target pattern as the
// digestSweeper (no external scheduler in this single-VM stack). Boot
// catch-up: skip — orphan images are not time-sensitive.
//
// Throughput: chunk size 100 per run. With concurrency 1 (no rush),
// 100 deletions × ~500ms each = 50s wall-clock. Tunable if storage
// fill ever races ahead of the cleanup.

import { listOrphanShareTokens, clearShareImagePaths } from "../../db/sharedCompletions.js";
import { deleteShareImages } from "./storage.js";

const DAILY_HOUR_UTC = 4; // 04:00 UTC = quiet window for our user base
const DEFAULT_STALE_DAYS = 90;
const DEFAULT_BATCH_SIZE = 100;

let timer: NodeJS.Timeout | null = null;

function msUntilNextFire(now: Date = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(DAILY_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export interface OrphanShareGcResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/** Single-run sweeper. Exported for tests + manual invocation. */
export async function runOrphanShareGcOnce(opts?: {
  staleDays?: number;
  batchSize?: number;
}): Promise<OrphanShareGcResult> {
  const staleDays = opts?.staleDays ?? DEFAULT_STALE_DAYS;
  const batchSize = opts?.batchSize ?? DEFAULT_BATCH_SIZE;

  let tokens: string[];
  try {
    tokens = await listOrphanShareTokens(staleDays, batchSize);
  } catch (err) {
    console.error(
      `[orphanShareGc] candidate query failed: ${(err as Error).message}`,
    );
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  for (const token of tokens) {
    try {
      // Delete OG + Story PNGs from storage. `deleteShareImages` is
      // already best-effort (logs but doesn't throw on storage 404 /
      // network blip — we re-try on tomorrow's sweep automatically).
      await deleteShareImages(token);
      // Null out the path columns so the row reflects "image gone".
      // If `deleteShareImages` had a network failure mid-flight, the
      // path columns stay set and tomorrow's sweep retries cleanly.
      await clearShareImagePaths(token);
      succeeded += 1;
    } catch (err) {
      console.error(
        `[orphanShareGc] gc failed for token=${token}: ${(err as Error).message}`,
      );
      failed += 1;
    }
  }

  if (tokens.length > 0) {
    console.log(
      JSON.stringify({
        level: "info",
        t: new Date().toISOString(),
        evt: "orphan_share_gc_complete",
        attempted: tokens.length,
        succeeded,
        failed,
      }),
    );
  }
  return { attempted: tokens.length, succeeded, failed };
}

function scheduleNext(): void {
  const ms = msUntilNextFire();
  timer = setTimeout(async () => {
    try {
      await runOrphanShareGcOnce();
    } catch (err) {
      console.error("[orphanShareGc] uncaught error", err);
    }
    scheduleNext();
  }, ms);
  if (timer.unref) timer.unref();
}

export function startOrphanShareGc(): void {
  if (timer) return;
  scheduleNext();
}

export function stopOrphanShareGc(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
