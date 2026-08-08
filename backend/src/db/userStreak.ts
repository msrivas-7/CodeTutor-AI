import { z } from "zod";
import { db } from "./client.js";
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

function fmtDateOrNull(d: Date | null): string | null {
  return d ? fmtDate(d) : null;
}

/** Add `days` to a Date and return a new Date (UTC-midnight). */
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export type StreakDayKind = "active" | "grace";

export interface StreakDay {
  date: Date;
  kind: StreakDayKind;
}

const StreakDaySchema = z.object({
  streak_date: z.date(),
  day_kind: z.enum(["active", "grace"]),
});

function parseStreakDays(rows: unknown[]): StreakDay[] {
  return rows.map((row) => {
    const parsed = StreakDaySchema.safeParse(row);
    if (!parsed.success) {
      throw new HttpError(
        500,
        `corrupt user_streak_days row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    return { date: parsed.data.streak_date, kind: parsed.data.day_kind };
  });
}

function latestDay(days: StreakDay[], kind: StreakDayKind): Date | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index]?.kind === kind) return days[index]!.date;
  }
  return null;
}

/**
 * Derive the live streak from the authoritative UTC-day ledger. Grace rows
 * bridge a calendar gap but do not add a learned day to the displayed count.
 * A latest active day two days ago remains provisionally alive when the next
 * grace is eligible, matching the existing lazy-freeze contract; the grace
 * row is written only when the learner returns and qualifies again.
 */
export function deriveCurrentStreak(
  days: StreakDay[],
  lastFreezeUsed: Date | null,
  now: Date = new Date(),
): number {
  const normalized = [...days].sort((a, b) => a.date.getTime() - b.date.getTime());
  let latestActiveIndex = -1;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index]?.kind === "active") {
      latestActiveIndex = index;
      break;
    }
  }
  if (latestActiveIndex < 0) return 0;

  const today = todayUtc(now);
  const latestActive = normalized[latestActiveIndex]!.date;
  const latestGap = dayDiff(today, latestActive);
  if (latestGap > 2) return 0;
  if (
    latestGap === 2 &&
    lastFreezeUsed &&
    dayDiff(today, lastFreezeUsed) <= 7
  ) {
    return 0;
  }

  let current = 0;
  let expected = latestActive;
  for (let index = latestActiveIndex; index >= 0; index -= 1) {
    const day = normalized[index]!;
    if (dayDiff(expected, day.date) !== 0) break;
    if (day.kind === "active") current += 1;
    expected = addDays(day.date, -1);
  }
  return current;
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
  // Streak classification is backend-owned. Use the privileged application
  // transaction with explicit user predicates; browser roles have read-only
  // grants on both tables. Lock the summary while reconciling it to the
  // authoritative day ledger so a concurrent qualifying action cannot race
  // this read-side repair.
  const sql = db();
  return await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO public.user_streak (user_id)
      VALUES (${userId})
      ON CONFLICT (user_id) DO UPDATE SET updated_at = public.user_streak.updated_at
      RETURNING user_id, current_streak, longest_streak, last_active_date, last_freeze_used
    `;
    const parsed = parseRow(rows[0]);
    const dayRows = await tx`
      SELECT streak_date, day_kind
        FROM public.user_streak_days
       WHERE user_id = ${userId}
       ORDER BY streak_date ASC
    `;
    const days = parseStreakDays(dayRows);
    const lastActiveDate = latestDay(days, "active");
    const lastFreezeUsed = latestDay(days, "grace");
    const current = deriveCurrentStreak(days, lastFreezeUsed, now);
    const longest = Math.max(parsed.longest, current);
    if (
      current !== parsed.current ||
      longest !== parsed.longest ||
      fmtDateOrNull(lastActiveDate) !== fmtDateOrNull(parsed.lastActiveDate) ||
      fmtDateOrNull(lastFreezeUsed) !== fmtDateOrNull(parsed.lastFreezeUsed)
    ) {
      await tx`
        UPDATE public.user_streak
           SET current_streak   = ${current},
               longest_streak   = ${longest},
               last_active_date = ${fmtDateOrNull(lastActiveDate)}::date,
               last_freeze_used = ${fmtDateOrNull(lastFreezeUsed)}::date,
               updated_at       = now()
         WHERE user_id = ${userId}
      `;
    }
    return shapeFor(
      parsed,
      {
        current,
        longest,
        lastActiveDate,
        lastFreezeUsed,
        decayed: current !== parsed.current,
      },
      false,
      false,
      now,
    );
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

  // The summary row is the serialization point for both the ledger insert
  // and cached-summary update. A concurrent same-day request blocks on this
  // row, then observes today's committed ledger entry and becomes a no-op.
  const sql = db();
  return await sql.begin(async (tx) => {
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
    const initialRows = await tx`
      SELECT streak_date, day_kind
        FROM public.user_streak_days
       WHERE user_id = ${userId}
       ORDER BY streak_date ASC
    `;
    const initialDays = parseStreakDays(initialRows);
    const priorActive = latestDay(initialDays, "active");
    const priorFreeze = latestDay(initialDays, "grace");

    if (priorActive && dayDiff(today, priorActive) === 0) {
      const current = deriveCurrentStreak(initialDays, priorFreeze, now);
      const longest = Math.max(parsed.longest, current);
      if (current !== parsed.current || longest !== parsed.longest) {
        await tx`
          UPDATE public.user_streak
             SET current_streak = ${current},
                 longest_streak = ${longest},
                 updated_at     = now()
           WHERE user_id = ${userId}
        `;
      }
      return shapeFor(
        parsed,
        {
          current,
          longest,
          lastActiveDate: priorActive,
          lastFreezeUsed: priorFreeze,
          decayed: current !== parsed.current,
        },
        false,
        false,
        now,
      );
    }

    let freezeUsedNow = false;
    const gap = priorActive ? dayDiff(today, priorActive) : Infinity;
    if (gap === 2) {
      const freezeEligible =
        !priorFreeze || dayDiff(today, priorFreeze) > 7;
      if (freezeEligible) {
        await tx`
          INSERT INTO public.user_streak_days (user_id, streak_date, day_kind)
          VALUES (${userId}, ${yesterdayStr}::date, 'grace')
          ON CONFLICT (user_id, streak_date) DO NOTHING
        `;
        freezeUsedNow = true;
      }
    }

    await tx`
      INSERT INTO public.user_streak_days (user_id, streak_date, day_kind)
      VALUES (${userId}, ${todayStr}::date, 'active')
      ON CONFLICT (user_id, streak_date) DO UPDATE
      SET day_kind = 'active'
    `;

    const finalRows = await tx`
      SELECT streak_date, day_kind
        FROM public.user_streak_days
       WHERE user_id = ${userId}
       ORDER BY streak_date ASC
    `;
    const finalDays = parseStreakDays(finalRows);
    const nextFreeze = latestDay(finalDays, "grace");
    const nextCurrent = deriveCurrentStreak(finalDays, nextFreeze, now);
    const nextLongest = Math.max(parsed.longest, nextCurrent);
    await tx`
      UPDATE public.user_streak
         SET current_streak   = ${nextCurrent},
             longest_streak   = ${nextLongest},
             last_active_date = ${todayStr}::date,
             last_freeze_used = ${fmtDateOrNull(nextFreeze)}::date,
             updated_at       = now()
       WHERE user_id = ${userId}
    `;
    return shapeFor(
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
}

// ---------------------------------------------------------------------------
// History — for the dynamic-island widget. Reads the same authoritative UTC
// day ledger used to derive the summary chip.
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
  const sql = db();
  const dayRows = await sql<Array<{ streak_date: Date; day_kind: StreakDayKind }>>`
      SELECT streak_date, day_kind
        FROM public.user_streak_days
       WHERE user_id = ${userId}
         AND streak_date >= ${fmtDate(start)}::date
         AND streak_date <= ${fmtDate(today)}::date
       ORDER BY streak_date ASC
  `;
  const daysInWindow = parseStreakDays(dayRows);
  const active = new Set(
    daysInWindow.filter((day) => day.kind === "active").map((day) => fmtDate(day.date)),
  );
  const grace = new Set(
    daysInWindow.filter((day) => day.kind === "grace").map((day) => fmtDate(day.date)),
  );
  return {
    windowDates,
    activeDates: windowDates.filter((d) => active.has(d)),
    freezeUsedDates: windowDates.filter((d) => grace.has(d)),
    todayUtc: fmtDate(today),
  };
}

// Test-only: reset for fixtures.
export async function __deleteUserStreakForTests(userId: string): Promise<void> {
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM public.user_streak_days WHERE user_id = ${userId}`;
    await tx`DELETE FROM public.user_streak WHERE user_id = ${userId}`;
  });
}
