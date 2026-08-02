import { useEffect, useState } from "react";

// Phase 20-P4: pill rendered in place of the existing session UsageChip when
// the tutor is running on the operator's key. Counter decrements are driven
// by useAIStatus()'s refetch after each assistant turn; the local setInterval
// here only keeps the "resets at …" phrasing fresh without polling the
// backend — all it reads is `resetAtUtc`, already in the status payload.

interface FreeTierPillProps {
  remaining: number;
  cap: number;
  resetAtUtc: string;
}

// QA-M8: wall-clock phrasing in the learner's local timezone. "resets in
// Xh Ym" was UTC-derived and could mislead a learner in e.g. UTC+13 whose
// wall-clock day flipped hours ago. "resets at 9:00 AM" is unambiguous; if
// the reset is more than 24h out (shouldn't be for L1, but L2/L3 aggregate
// windows are longer) we fall back to a date-qualified form.
export function formatReset(resetAtUtc: string, now: Date): string {
  const reset = new Date(resetAtUtc);
  const ms = reset.getTime() - now.getTime();
  if (ms <= 0) return "resets now";
  const timeStr = reset.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay =
    reset.getFullYear() === now.getFullYear() &&
    reset.getMonth() === now.getMonth() &&
    reset.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    reset.getFullYear() === tomorrow.getFullYear() &&
    reset.getMonth() === tomorrow.getMonth() &&
    reset.getDate() === tomorrow.getDate();
  if (sameDay) return `resets at ${timeStr}`;
  if (isTomorrow) return `resets tomorrow at ${timeStr}`;
  return `resets ${reset.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${timeStr}`;
}

export function FreeTierPill({ remaining, cap, resetAtUtc }: FreeTierPillProps) {
  // Re-render once a minute so the wall-clock phrasing stays fresh across
  // midnight. This is purely presentational; the actual counter doesn't
  // change until the caller refetches ai-status.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const amber = cap > 0 && remaining / cap < 0.2;
  const cls = amber
    ? "border-warn/40 bg-warn/10 text-warnInk"
    : "border-accent/40 bg-accent/10 text-accentInk";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${cls}`}
      title={`Free tutor — ${remaining} of ${cap} questions remaining today`}
      // QA-L3: aria-live polite so an SR user hears the counter decrement and
      // the amber threshold crossing (wording changes to include "running low"
      // when < 20%). `aria-atomic` re-reads the whole pill each decrement so
      // the assistive-tech user gets the full "3 of 5 remaining, resets at …"
      // announcement rather than a bare number change.
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span aria-hidden="true">✨</span>
      <span>
        {amber ? "Free tutor · running low · " : "Free tutor · "}
        <span className="font-mono tabular-nums">{remaining}/{cap}</span> today · {formatReset(resetAtUtc, now)}
      </span>
    </span>
  );
}
