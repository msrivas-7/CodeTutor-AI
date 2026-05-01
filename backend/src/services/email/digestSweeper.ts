import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { markStreakNudgeSent } from "../../db/preferences.js";
import { createSemaphore } from "../execution/concurrency.js";
import { EmailNotConfiguredError } from "./acsClient.js";
import { sendStreakNudge } from "./streakNudge.js";
import { UnsubscribeSecretMissingError } from "./unsubscribeTokens.js";

// Phase 22D: daily streak-nudge sweeper.
//
// Cadence: fires once daily at 18:00 UTC. v1 doesn't track per-user
// timezones (the plan defers that to v2), so the global window picks a
// time that hits as a "tonight" reminder for North America (~11am-2pm
// PT/ET) and an "early evening" for Europe (~6-8pm local). Asia gets a
// next-morning reminder which still works for "yesterday slipped".
//
// Mechanism: setTimeout to the next 18:00 UTC. On fire, runs the sweep,
// then schedules the next 24h fire. Boot-time catch-up: if the backend
// container restarts after 18:00 UTC on a given day, fire immediately
// — the SELECT's idempotency filter (last_streak_email_sent_at <
// CURRENT_DATE) prevents double-sends to anyone already mailed.
//
// Why setTimeout-to-target vs setInterval(60s)-and-check: the latter
// burns 1440 polls per day for one send. setTimeout is precise and
// idle-cheap. Same energy as cron but in-process — no external job
// scheduler needed for a single-VM indie product.

// Eligibility query:
//   - JOIN user_streak (must have a streak >= 1 AND last_active_date =
//     yesterday-UTC — i.e. the user was active yesterday but not today)
//   - JOIN user_preferences (opt_in = true AND not already mailed today)
//   - JOIN auth.users (email exists AND email_confirmed_at IS NOT NULL —
//     unconfirmed accounts NEVER get retention email; industry norm +
//     CAN-SPAM hygiene + reduces signup-spam abuse)
//   - LATERAL JOIN to course_progress for the deep-link target. LEFT
//     LATERAL because users without any course_progress row should still
//     get the email (deep link falls back to /start).
interface SweepRow {
  user_id: string;
  email: string;
  first_name: string | null;
  current_streak: number;
  last_course_id: string | null;
  last_lesson_id: string | null;
}

const SELECT_ELIGIBLE_USERS_SQL = `
  SELECT
    au.id                                       AS user_id,
    au.email                                    AS email,
    (au.raw_user_meta_data->>'first_name')      AS first_name,
    s.current_streak                            AS current_streak,
    cp.course_id                                AS last_course_id,
    cp.last_lesson_id                           AS last_lesson_id
  FROM auth.users au
  JOIN public.user_streak s
    ON s.user_id = au.id
  JOIN public.user_preferences p
    ON p.user_id = au.id
  LEFT JOIN LATERAL (
    SELECT course_id, last_lesson_id, updated_at
      FROM public.course_progress
     WHERE user_id = au.id
       AND last_lesson_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1
  ) cp ON TRUE
  WHERE s.current_streak >= 1
    AND s.last_active_date = (CURRENT_DATE AT TIME ZONE 'UTC')::date - INTERVAL '1 day'
    AND p.email_opt_in = TRUE
    AND p.disable_streaks = FALSE
    AND (p.last_streak_email_sent_at IS NULL
         OR p.last_streak_email_sent_at < (CURRENT_DATE AT TIME ZONE 'UTC')::date)
    AND au.email IS NOT NULL
    AND au.email_confirmed_at IS NOT NULL
`;

const FIRE_HOUR_UTC = 18;
const FIRE_MINUTE_UTC = 0;

let nextTimeout: ReturnType<typeof setTimeout> | null = null;
let running = false; // re-entrancy guard

/**
 * Returns the next scheduled fire time. If `now` is before today's
 * fire-window, returns today; otherwise tomorrow's fire-window.
 */
function nextFireTime(now: Date): Date {
  const todayAtFire = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      FIRE_HOUR_UTC,
      FIRE_MINUTE_UTC,
      0,
      0,
    ),
  );
  if (now < todayAtFire) return todayAtFire;
  return new Date(todayAtFire.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Returns true if the current time is past today's fire-window — i.e.
 * the boot just happened "after the cron should have fired today."
 * Caller decides whether to fire immediately on boot in that case (we do).
 */
function shouldCatchUpOnBoot(now: Date): boolean {
  const todayAtFire = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      FIRE_HOUR_UTC,
      FIRE_MINUTE_UTC,
      0,
      0,
    ),
  );
  return now >= todayAtFire;
}

async function fetchEligibleUsers(): Promise<SweepRow[]> {
  const sql = db();
  // Use sql.unsafe for the static query (no parameters); keeps the SQL
  // in a single readable string above instead of a tagged template
  // littered with line breaks. Safe — no user input is concatenated.
  return (await sql.unsafe(SELECT_ELIGIBLE_USERS_SQL)) as unknown as SweepRow[];
}

/**
 * Run one sweep iteration. Idempotent — the SELECT filters out anyone
 * already mailed today, and `markStreakNudgeSent` only flips the flag
 * after the ACS send resolves successfully. A failed send leaves the
 * flag null so tomorrow's cron retries the same user.
 *
 * Exposed for tests; production code only calls `startDigestSweeper`.
 */
export async function runDigestSweepOnce(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  if (running) {
    // Two firings can't proceed in parallel — a delayed boot-time
    // catch-up plus an on-time scheduled fire could otherwise both run.
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  running = true;
  try {
    if (config.email.streakNudgeDisabled) {
      console.warn(
        "[digestSweeper] STREAK_NUDGE_DISABLED is set; skipping today's sweep",
      );
      return { attempted: 0, succeeded: 0, failed: 0 };
    }
    if (!config.email.acsConnectionString) {
      console.warn(
        "[digestSweeper] ACS_CONNECTION_STRING not configured; skipping sweep",
      );
      return { attempted: 0, succeeded: 0, failed: 0 };
    }
    if (!config.email.unsubscribeSecret) {
      // Refusing to send without the unsubscribe secret is the CAN-SPAM
      // floor — every commercial-tier email MUST have a working
      // unsubscribe link. If we sent without one, the link in the
      // footer would 401 forever.
      console.error(
        "[digestSweeper] EMAIL_UNSUBSCRIBE_SECRET not configured; refusing to send",
      );
      return { attempted: 0, succeeded: 0, failed: 0 };
    }

    let rows: SweepRow[];
    try {
      rows = await fetchEligibleUsers();
    } catch (err) {
      console.error(
        `[digestSweeper] eligibility query failed: ${(err as Error).message}`,
      );
      return { attempted: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;
    // Phase 23 P1 #1: bounded parallelism. Sequential sends took 17-50
    // min at 1k users; ACS poll-pattern is 1-3s/send. Concurrency 3 ≈
    // 60-180 sends/min steady state — well under ACS's default
    // ~100/min ceiling per resource (the pacing keeps us off the 429
    // cliff while cutting sweep latency by 3×). Reuses the
    // createSemaphore primitive from services/execution/concurrency.ts
    // (same FIFO + per-slot retry behavior the docker-exec semaphore
    // uses). Tunable via DIGEST_SWEEP_CONCURRENCY for future ACS-tier
    // upgrades or load-test calibration.
    const sem = createSemaphore(config.email.digestSweepConcurrency);
    const sendOne = async (row: SweepRow): Promise<"ok" | "fail"> => {
      try {
        await sendStreakNudge({
          email: row.email,
          userId: row.user_id,
          firstName: row.first_name,
          currentStreak: row.current_streak,
          lastCourseId: row.last_course_id,
          lastLessonId: row.last_lesson_id,
        });
        await markStreakNudgeSent(row.user_id);
        return "ok";
      } catch (err) {
        // Per-user failure: log + continue. Do NOT mark the flag — the
        // next day's cron will pick this user back up (subject to them
        // still meeting the eligibility filter).
        const reason =
          err instanceof EmailNotConfiguredError ||
          err instanceof UnsubscribeSecretMissingError
            ? err.message
            : (err as Error).message;
        console.error(
          `[digestSweeper] send failed for user ${row.user_id}: ${reason}`,
        );
        return "fail";
      }
    };
    const results = await Promise.all(
      rows.map((row) => sem.run(() => sendOne(row))),
    );
    for (const r of results) {
      if (r === "ok") succeeded += 1;
      else failed += 1;
    }

    if (rows.length > 0) {
      console.log(
        `[digestSweeper] sweep complete: attempted=${rows.length} succeeded=${succeeded} failed=${failed}`,
      );
    }
    return { attempted: rows.length, succeeded, failed };
  } finally {
    running = false;
  }
}

/**
 * Schedule the next fire and recursively re-arm. Internal helper.
 */
function scheduleNext(): void {
  const now = new Date();
  const target = nextFireTime(now);
  const delayMs = target.getTime() - now.getTime();
  // Defensive clamp — if a scheduling math error ever produced a delay
  // smaller than 60s, we'd risk a tight fire-loop. Min 60s ceiling.
  const safeDelay = Math.max(delayMs, 60_000);
  nextTimeout = setTimeout(() => {
    void runDigestSweepOnce()
      .catch((err) => {
        console.error(
          `[digestSweeper] runDigestSweepOnce threw: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        // Always re-arm, even on error. A transient DB outage shouldn't
        // permanently stop the cron.
        scheduleNext();
      });
  }, safeDelay);
  // Allow the process to exit cleanly during graceful shutdown — the
  // sweeper shouldn't hold the event loop open if everything else has
  // closed (matches the budgetWatcher pattern).
  if (typeof nextTimeout.unref === "function") {
    nextTimeout.unref();
  }
}

/**
 * Boot the daily streak-nudge cron. Idempotent — repeated calls are
 * no-ops (the budgetWatcher pattern). On boot, if the current time is
 * past today's 18:00 UTC fire window, fires immediately to catch
 * container restarts that happened after the daily window passed.
 */
export function startDigestSweeper(): void {
  if (nextTimeout !== null) return;
  const now = new Date();
  if (shouldCatchUpOnBoot(now)) {
    // Fire immediately. The eligibility filter prevents double-sending
    // to anyone already mailed today.
    void runDigestSweepOnce()
      .catch((err) => {
        console.error(
          `[digestSweeper] catch-up runDigestSweepOnce threw: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        scheduleNext();
      });
  } else {
    scheduleNext();
  }
}

export function stopDigestSweeper(): void {
  if (nextTimeout === null) return;
  clearTimeout(nextTimeout);
  nextTimeout = null;
}

// Test-only: reset the in-memory state. Production code never calls.
export function _resetDigestSweeperForTests(): void {
  if (nextTimeout) clearTimeout(nextTimeout);
  nextTimeout = null;
  running = false;
}

// Test-only: expose the scheduling-math helpers so unit tests can
// assert "next fire is exactly today/tomorrow at 18:00 UTC" without
// touching real clock time.
export const _testHelpers = {
  nextFireTime,
  shouldCatchUpOnBoot,
};
