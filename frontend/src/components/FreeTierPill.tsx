import { useEffect, useState } from "react";

// Phase 20-P4: pill rendered in place of the existing session UsageChip when
// the tutor is running on the operator's key. Counter decrements are driven
// by useAIStatus()'s refetch after each assistant turn; the local setInterval
// here only keeps the "resets in Xh Ym" phrasing fresh without polling the
// backend — all it reads is `resetAtUtc`, already in the status payload.

interface FreeTierPillProps {
  remaining: number;
  cap: number;
  resetAtUtc: string;
}

function formatReset(resetAtUtc: string): string {
  const ms = Math.max(0, new Date(resetAtUtc).getTime() - Date.now());
  if (ms === 0) return "resets now";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `resets in ${minutes}m`;
  return `resets in ${hours}h ${minutes}m`;
}

export function FreeTierPill({ remaining, cap, resetAtUtc }: FreeTierPillProps) {
  // Re-render once a minute so the "resets in Xh Ym" clock stays current. This
  // is purely presentational; the actual counter doesn't change until the
  // caller refetches ai-status.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Silence unused-var warning — the tick is read as an effect dependency.
  void tick;

  const amber = cap > 0 && remaining / cap < 0.2;
  const cls = amber
    ? "border-warn/40 bg-warn/10 text-warnInk"
    : "border-accent/40 bg-accent/10 text-accent";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10px] ${cls}`}
      title={`Free tutor — ${remaining} of ${cap} questions remaining today`}
    >
      <span aria-hidden="true">✨</span>
      <span>
        Free tutor · <span className="font-mono tabular-nums">{remaining}/{cap}</span> today · {formatReset(resetAtUtc)}
      </span>
    </span>
  );
}
