import { useEffect, useRef, useState } from "react";

interface CoachRailProps {
  hasEdited: boolean;
  hasRun: boolean;
  hasError: boolean;
  hasChecked: boolean;
  checkPassed: boolean;
  failedCheckCount: number;
  lessonComplete: boolean;
  tutorConfigured: boolean;
}

interface Nudge {
  id: string;
  message: string;
  icon: string;
}

const TICK_MS = 5_000;

export function CoachRail(props: CoachRailProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const mountTime = useRef(Date.now());
  const lastActionTime = useRef(Date.now());

  useEffect(() => {
    lastActionTime.current = Date.now();
  }, [props.hasEdited, props.hasRun, props.hasChecked, props.hasError]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.floor((Date.now() - mountTime.current) / 1000);
  const idle = Math.floor((Date.now() - lastActionTime.current) / 1000);
  void tick;

  const nudge = pickNudge(props, elapsed, idle, dismissed);
  if (!nudge) return null;

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-relaxed text-ink/80">
      <span className="shrink-0 text-sm">{nudge.icon}</span>
      <span className="flex-1">{nudge.message}</span>
      <button
        onClick={() => setDismissed((s) => new Set(s).add(nudge.id))}
        className="shrink-0 rounded px-1 text-[11px] leading-none text-muted transition hover:text-ink"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function pickNudge(
  p: CoachRailProps,
  elapsed: number,
  idle: number,
  dismissed: Set<string>,
): Nudge | null {
  const rules: Array<Nudge & { condition: boolean }> = [
    {
      id: "completed-idle",
      condition: p.lessonComplete,
      icon: "🎯",
      message: "Nice work! You can practice more, or move on to the next lesson.",
    },
    {
      id: "many-fails",
      condition: p.failedCheckCount >= 3 && !p.checkPassed,
      icon: "💪",
      message: p.tutorConfigured
        ? "This one's tricky — try 'Show hints' in the instructions, or ask the tutor for help."
        : "This one's tricky — try clicking 'Show hints' below for some guidance.",
    },
    {
      id: "failed-check",
      condition: p.hasChecked && !p.checkPassed && idle > 30,
      icon: "🔄",
      message: "Not quite right. Re-read the instructions, adjust your code, and try again.",
    },
    {
      id: "ran-ok-check",
      condition: p.hasRun && !p.hasError && !p.hasChecked && !p.lessonComplete,
      icon: "✅",
      message: "Your code ran! Click Check Solution to see if it passes.",
    },
    {
      id: "ran-error",
      condition: p.hasRun && p.hasError && idle > 30,
      icon: "🔍",
      message: p.tutorConfigured
        ? "Got an error? Read the red text in the output — it tells you which line went wrong. Or click 'Explain Error' for help."
        : "Got an error? Read the red text in the output — it usually tells you which line has the problem.",
    },
    {
      id: "edited-no-run",
      condition: p.hasEdited && !p.hasRun && idle > 45,
      icon: "▶️",
      message: "Press the Run button (or Cmd+Enter) to see what your code does.",
    },
    {
      id: "no-edits-long",
      condition: !p.hasEdited && elapsed > 60,
      icon: "✏️",
      message: "Ready? Try changing the code in the editor to match what the instructions describe.",
    },
    {
      id: "no-edits-short",
      condition: !p.hasEdited && elapsed > 30,
      icon: "📖",
      message: "Start by reading the instructions below, then try editing the code.",
    },
  ];

  return rules.find((r) => r.condition && !dismissed.has(r.id)) ?? null;
}
