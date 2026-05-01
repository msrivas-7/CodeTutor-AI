import { z } from "zod";
import { db, withRlsContext } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

// Phase 21B: per-user learning streak.
//
// Rules:
//   - "Streak day" = at least one qualifying action that UTC day:
//       * lesson completed (status flipped to 'completed')
//       * code ran successfully (run_count incremented; backend hook)
//       * substantive tutor question (POST body content ≥4 chars trimmed)
//   - Auto-freeze: 1 missed UTC day per rolling 7-day window is forgiven.
//     The chip shows a persistent frosted second arc for the rolling
//     window so grace is VISIBLE — not silent.
//   - Two missed days = streak breaks regardless of freeze state.

export interface UserStreakRow {
  current: number;
  longest: number;
  lastActiveDate: string | null;        // 'YYYY-MM-DD' (UTC)
  lastFreezeUsed: string | null;        // 'YYYY-MM-DD' (UTC)
  isActiveToday: boolean;
  isAtRisk: boolean;
  resetAtUtc: string;                   // ISO of next 00:00 UTC
  freezeActive: boolean;                // freeze used within rolling 7d → frosted arc on
  // True only on the first qualifying action of THIS UTC day; false on
  // plain GET reads or subsequent same-day actions. Frontend uses this
  // to gate the in-place chip animation.
  wasFirstToday: boolean;
  // True only on the first action of a day that came AFTER a missed
  // day, where the freeze was just consumed (transition moment for
  // the welcome-back overlay).
  freezeUsedToday: boolean;
}

const StreakRowSchema = z.object({
  user_id: z.string().uuid(),
  current_streak: z.union([z.number(), z.string()]),
  longest_streak: z.union([z.number(), z.string()]),
  last_active_date: z.date().nullable(),
  last_freeze_used: z.date().nullable(),
});

interface ParsedRow {
  userId: string;
  current: number;
  longest: number;
  lastActiveDate: Date | null;
  lastFreezeUsed: Date | null;
}

function parseRow(raw: unknown): ParsedRow {
  const parsed = StreakRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt user_streak row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    userId: r.user_id,
    current: Number(r.current_streak),
    longest: Number(r.longest_streak),
    lastActiveDate: r.last_active_date,
    lastFreezeUsed: r.last_freeze_used,
  };
}

// ---------------------------------------------------------------------------
// Date helpers — all UTC, all expressed as 'YYYY-MM-DD' strings or Date(UTC midnight).
// ---------------------------------------------------------------------------

/** UTC date of `now` as a JS Date set to midnight UTC of that day. */
export function todayUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Format a Date as a 'YYYY-MM-DD' UTC date string (matches Postgres `date`). */
function fmtDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `days` to a Date and return a new Date (UTC-midnight). */
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/**
 * Number of whole UTC-day differences between two Dates (a - b).
 *
 * Robust to inputs that aren't exactly midnight: each timestamp is
 * floored to its UTC-day number (days-since-epoch), then subtracted.
 * Earlier impl used `Math.round(ms / 86400000)` which is correct ONLY
 * if both inputs are pre-aligned to midnight UTC; if a future caller
 * ever passed a non-midnight Date (e.g., a `timestamptz` from
 * `lesson_progress.completed_at`), the round path would silently
 * lose a day at the half-day boundary.
 */
function dayDiff(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const aDays = Math.floor(a.getTime() / MS_PER_DAY);
  const bDays = Math.floor(b.getTime() / MS_PER_DAY);
  return aDays - bDays;
}

/** Next 00:00 UTC after `now` as ISO string. */
function nextUtcReset(now: Date = new Date()): string {
  const d = todayUtc(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Hours remaining until next UTC midnight. */
function hoursUntilUtcReset(now: Date = new Date()): number {
  const reset = new Date(nextUtcReset(now));
  return (reset.getTime() - now.getTime()) / (60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Decay / read shape
// ---------------------------------------------------------------------------

interface DecayResult {
  current: number;
  longest: number;
  lastActiveDate: Date | null;
  lastFreezeUsed: Date | null;
  /** true if the in-memory row needed adjustment (caller writes back). */
  decayed: boolean;
}

/**
 * Apply lazy decay logic to a row IN MEMORY (no DB write). Used by both
 * the read path (so /streak reflects expired streaks) and the update
 * path (compute the post-decay baseline before deciding the new state).
 */
export function applyDecay(parsed: ParsedRow, now: Date = new Date()): DecayResult {
  const today = todayUtc(now);
  if (!parsed.lastActiveDate || parsed.current === 0) {
    return { current: 0, longest: parsed.longest, lastActiveDate: parsed.lastActiveDate, lastFreezeUsed: parsed.lastFreezeUsed, decayed: false };
  }
  const gap = dayDiff(today, parsed.lastActiveDate);
  // gap === 0 → active today; gap === 1 → active yesterday (still alive,
  // not yet extended). Either case the streak is intact as-is.
  if (gap <= 1) {
    return { current: parsed.current, longest: parsed.longest, lastActiveDate: parsed.lastActiveDate, lastFreezeUsed: parsed.lastFreezeUsed, decayed: false };
  }
  // gap >= 2 — at least one missed day. Eligible for grace ONLY IF gap === 2
  // and freeze cooldown allows. A 3+ day gap kills it regardless.
  // (Decay alone never CONSUMES a freeze — that happens inside update()
  // on the next qualifying action. Decay just decides whether to zero it.)
  if (gap === 2) {
    const freezeEligible =
      !parsed.lastFreezeUsed ||
      dayDiff(today, parsed.lastFreezeUsed) > 7;
    if (freezeEligible) {
      // Streak still alive in principle — grace will be applied on the
      // next qualifying action that fires update(). For read purposes
      // we keep the value but signal "at risk" via the route layer.
      return { current: parsed.current, longest: parsed.longest, lastActiveDate: parsed.lastActiveDate, lastFreezeUsed: parsed.lastFreezeUsed, decayed: false };
    }
  }
  // 3+ day gap, OR 2-day gap with no eligible freeze → break.
  return { current: 0, longest: parsed.longest, lastActiveDate: parsed.lastActiveDate, lastFreezeUsed: parsed.lastFreezeUsed, decayed: true };
}

function freezeActiveAtToday(parsed: ParsedRow, now: Date = new Date()): boolean {
  if (!parsed.lastFreezeUsed) return false;
  return dayDiff(todayUtc(now), parsed.lastFreezeUsed) <= 7;
}

function shapeFor(
  parsed: ParsedRow,
  decay: DecayResult,
  wasFirstToday: boolean,
  freezeUsedToday: boolean,
  now: Date = new Date(),
): UserStreakRow {
  const today = todayUtc(now);
  const isActiveToday =
    !!decay.lastActiveDate && dayDiff(today, decay.lastActiveDate) === 0;
  const hours = hoursUntilUtcReset(now);
  const isAtRisk = decay.current > 0 && !isActiveToday && hours < 4;
  return {
    current: decay.current,
    longest: decay.longest,
    lastActiveDate: decay.lastActiveDate ? fmtDate(decay.lastActiveDate) : null,
    lastFreezeUsed: decay.lastFreezeUsed ? fmtDate(decay.lastFreezeUsed) : null,
    isActiveToday,
    isAtRisk,
    resetAtUtc: nextUtcReset(now),
    freezeActive: freezeActiveAtToday({ ...parsed, lastFreezeUsed: decay.lastFreezeUsed }, now),
    wasFirstToday,
    freezeUsedToday,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * GET /streak read path. Fetches the row (ensuring it exists), applies
 * lazy decay, optionally writes back if decay reduced the value, and
 * returns the public shape with wasFirstToday=false, freezeUsedToday=false.
 */
export async function getUserStreak(userId: string, now: Date = new Date()): Promise<UserStreakRow> {
  // Phase 26: ensure-row UPSERT + optional decay UPDATE under one RLS
  // context. The two queries land in the same transaction so the row
  // lock implied by ON CONFLICT is held across the read.
  return await withRlsContext(userId, async (tx) => {
    const rows = await tx`
      INSERT INTO public.user_streak (user_id)
      VALUES (${userId})
      ON CONFLICT (user_id) DO UPDATE SET updated_at = public.user_streak.updated_at
      RETURNING user_id, current_streak, longest_streak, last_active_date, last_freeze_used
    `;
    const parsed = parseRow(rows[0]);
    const decay = applyDecay(parsed, now);
    if (decay.decayed) {
      await tx`
        UPDATE public.user_streak
           SET current_streak = ${decay.current},
               updated_at     = now()
         WHERE user_id = ${userId}
      `;
    }
    return shapeFor(parsed, decay, false, false, now);
  });
}

// ---------------------------------------------------------------------------
// Update (write path called inline from qualifying-action handlers)
// ---------------------------------------------------------------------------

/**
 * Idempotent write. Called inline from any qualifying-action handler
 * (lesson completion PATCH, code-run, substantive tutor ask). Applies
 * the day-by-day rules:
 *
 *   gap == 0  → no-op (already active today). Returns wasFirstToday=false.
 *   gap == 1  → extend: current+=1, longest = max(longest, current). first.
 *   gap == 2 + freeze eligible → extend AND set last_freeze_used = today-1.
 *   gap == 2 + cooldown OR gap > 2 → reset: current=1.
 *   no prior row OR current=0 → set current=1.
 *
 * Returns the shaped row including wasFirstToday/freezeUsedToday so the
 * caller can include it in the API response without a follow-up read.
 */
export async function updateUserStreak(userId: string, now: Date = new Date()): Promise<UserStreakRow> {
  const today = todayUtc(now);
  const todayStr = fmtDate(today);
  const yesterday = addDays(today, -1);
  const yesterdayStr = fmtDate(yesterday);

  // Serialized via postgres row-level lock. Audit walked the race and
  // confirmed it's safe under default READ COMMITTED:
  //
  //   Call A: BEGIN → INSERT (acquires row lock on user_id via
  //           ON CONFLICT path) → SELECT FOR UPDATE (already has lock)
  //           → UPDATE → COMMIT (releases lock).
  //   Call B: BEGIN → INSERT (BLOCKS on A's lock) → A commits, B
  //           unblocks, INSERT triggers ON CONFLICT → SELECT FOR
  //           UPDATE → reads A's post-commit state (lastActiveDate=
  //           today) → falls into same-day no-op branch below →
  //           returns wasFirstToday=false.
  //
  // The "same-day no-op" check on line 285 is reached with the row
  // locked AND the most recent committed state visible (READ COMMITTED
  // semantics give per-statement snapshots after a lock acquisition).
  // No race on wasFirstToday.
  //
  // Phase 26: withRlsContext wraps the whole sequence in a transaction
  // with SET LOCAL ROLE authenticated; the existing FOR UPDATE row lock
  // semantics are unchanged.
  let result: UserStreakRow | null = null;
  await withRlsContext(userId, async (tx) => {
    // Ensure row exists, then lock it.
    await tx`
      INSERT INTO public.user_streak (user_id)
      VALUES (${userId})
      ON CONFLICT (user_id) DO UPDATE SET updated_at = public.user_streak.updated_at
    `;
    const rows = await tx`
      SELECT user_id, current_streak, longest_streak, last_active_date, last_freeze_used
        FROM public.user_streak
       WHERE user_id = ${userId}
       FOR UPDATE
    `;
    const parsed = parseRow(rows[0]);

    // Same-day no-op.
    if (parsed.lastActiveDate && dayDiff(today, parsed.lastActiveDate) === 0) {
      result = shapeFor(parsed, { current: parsed.current, longest: parsed.longest, lastActiveDate: parsed.lastActiveDate, lastFreezeUsed: parsed.lastFreezeUsed, decayed: false }, false, false, now);
      return;
    }

    let nextCurrent: number;
    let nextFreeze: Date | null = parsed.lastFreezeUsed;
    let freezeUsedNow = false;
    const gap = parsed.lastActiveDate ? dayDiff(today, parsed.lastActiveDate) : Infinity;

    if (parsed.current === 0 || !parsed.lastActiveDate || gap === Infinity) {
      // First-ever or post-decay zero → start fresh at Day 1.
      nextCurrent = 1;
    } else if (gap === 1) {
      nextCurrent = parsed.current + 1;
    } else if (gap === 2) {
      const freezeEligible =
        !parsed.lastFreezeUsed || dayDiff(today, parsed.lastFreezeUsed) > 7;
      if (freezeEligible) {
        nextCurrent = parsed.current + 1;
        nextFreeze = yesterday;
        freezeUsedNow = true;
      } else {
        nextCurrent = 1;
      }
    } else {
      // gap > 2 → break, restart at 1.
      nextCurrent = 1;
    }

    const nextLongest = Math.max(parsed.longest, nextCurrent);
    await tx`
      UPDATE public.user_streak
         SET current_streak   = ${nextCurrent},
             longest_streak   = ${nextLongest},
             last_active_date = ${todayStr}::date,
             last_freeze_used = ${nextFreeze ? fmtDate(nextFreeze) : null}::date,
             updated_at       = now()
       WHERE user_id = ${userId}
    `;
    void yesterdayStr; // referenced for readability; nextFreeze carries the value
    result = shapeFor(
      parsed,
      {
        current: nextCurrent,
        longest: nextLongest,
        lastActiveDate: today,
        lastFreezeUsed: nextFreeze,
        decayed: false,
      },
      true,
      freezeUsedNow,
      now,
    );
  });
  if (!result) throw new Error("updateUserStreak: transaction returned no result");
  return result;
}

// ---------------------------------------------------------------------------
// History — for the dynamic-island widget. Returns distinct UTC dates from
// the past `days` days where lesson_progress was touched (a proxy for any
// activity), plus the freeze-used date if it falls in the window.
// ---------------------------------------------------------------------------

export interface StreakHistory {
  /** UTC dates 'YYYY-MM-DD' inclusive, oldest → newest, length = days. */
  windowDates: string[];
  /** Subset of windowDates where qualifying activity was recorded. */
  activeDates: string[];
  /** Subset of windowDates where the freeze covered a missed day. */
  freezeUsedDates: string[];
  /** Today's UTC date (last entry in windowDates). */
  todayUtc: string;
}

export async function getStreakHistory(
  userId: string,
  days: number = 14,
  now: Date = new Date(),
): Promise<StreakHistory> {
  const today = todayUtc(now);
  const start = addDays(today, -(days - 1));
  // Build the contiguous date window from `start` to `today` inclusive.
  const windowDates: string[] = [];
  for (let i = 0; i < days; i++) {
    windowDates.push(fmtDate(addDays(start, i)));
  }
  // Phase 26: both queries land in one RLS-scoped transaction. lesson_progress
  // and user_streak both have RLS policies on auth.uid() = user_id; the
  // explicit WHERE user_id = ${userId} clauses are defense-in-depth.
  const { activityRows, streakRow } = await withRlsContext(userId, async (tx) => {
    // Distinct activity dates from lesson_progress in the window. updated_at
    // is the broadest proxy: any progressStore action that PATCHes the row
    // (start, run, hint, complete, code-save) bumps it. Cheap because the
    // (user_id, updated_at DESC) index from migration 20260420130000 covers
    // exactly this query shape.
    const activityRows = await tx<Array<{ d: string }>>`
      SELECT DISTINCT to_char((updated_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d
        FROM public.lesson_progress
       WHERE user_id = ${userId}
         AND updated_at >= ${fmtDate(start)}::date
         AND updated_at <  ${fmtDate(addDays(today, 1))}::date
    `;
    // Read both user_streak fields in a single query — earlier impl ran
    // two separate SELECTs, opening a (microscopic) race window where
    // an updateUserStreak between the queries could yield an
    // inconsistent freeze + active-date pair. Single SELECT = atomic.
    const streakRow = await tx<
      Array<{ last_freeze_used: Date | null; last_active_date: Date | null }>
    >`
      SELECT last_freeze_used, last_active_date
        FROM public.user_streak
       WHERE user_id = ${userId}
    `;
    return { activityRows, streakRow };
  });
  const active = new Set(activityRows.map((r) => r.d));
  const lf = streakRow[0]?.last_freeze_used;
  const la = streakRow[0]?.last_active_date;
  const freezeUsedDates: string[] = [];
  if (lf) {
    const lfStr = fmtDate(lf);
    if (windowDates.includes(lfStr)) freezeUsedDates.push(lfStr);
  }
  if (la) {
    const laStr = fmtDate(la);
    if (windowDates.includes(laStr)) active.add(laStr);
  }
  return {
    windowDates,
    activeDates: windowDates.filter((d) => active.has(d)),
    freezeUsedDates,
    todayUtc: fmtDate(today),
  };
}

// Test-only: reset for fixtures.
export async function __deleteUserStreakForTests(userId: string): Promise<void> {
  const sql = db();
  await sql`DELETE FROM public.user_streak WHERE user_id = ${userId}`;
}
