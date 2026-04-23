import { useEffect, useRef, useState } from "react";
import { useShortcutLabels } from "../../../util/platform";

interface CoachRailProps {
  hasEdited: boolean;
  hasRun: boolean;
  hasError: boolean;
  hasChecked: boolean;
  checkPassed: boolean;
  failedCheckCount: number;
  lessonComplete: boolean;
  tutorConfigured: boolean;
  // Wave 2 (function_tests lessons only). Undefined → no function_tests on
  // this lesson, so the split counters don't apply and legacy rules still
  // fire off failedCheckCount.
  hasFunctionTests?: boolean;
  // Cumulative count of Check attempts where ≥1 VISIBLE test failed.
  failedVisibleTests?: number;
  // Cumulative count of Check attempts where visible all passed but ≥1
  // HIDDEN test failed.
  failedHiddenTests?: number;
  // Current count of visible tests passing in the latest test report. Used
  // by mixed-pass-fail to detect "making progress but stuck on one".
  passedVisibleTests?: number;
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
  const keys = useShortcutLabels();

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

  const nudge = pickNudge(props, elapsed, idle, dismissed, keys.runPhrase);
  if (!nudge) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="mb-3 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-relaxed text-ink/80"
    >
      <span className="shrink-0 text-sm" aria-hidden="true">{nudge.icon}</span>
      <span className="flex-1">{nudge.message}</span>
      <button
        onClick={() => setDismissed((s) => new Set(s).add(nudge.id))}
        className="shrink-0 rounded px-1 text-[11px] leading-none text-muted transition hover:text-ink"
        title="Dismiss this tip"
        aria-label="Dismiss coach tip"
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
  runPhrase: string = "Cmd+Enter",
): Nudge | null {
  const failedVisible = p.failedVisibleTests ?? 0;
  const failedHidden = p.failedHiddenTests ?? 0;
  const passedVisible = p.passedVisibleTests ?? 0;

  const rules: Array<Nudge & { condition: boolean }> = [
    {
      id: "completed-idle",
      condition: p.lessonComplete,
      icon: "🎯",
      message: "Nice work! You can practice more, or move on to the next lesson.",
    },
    // Fires BEFORE many-fails: learner is making progress (at least one
    // visible passes) but has repeatedly missed ≥2 visible tests. Points
    // them at the specific failure instead of escalating to hints/tutor.
    {
      id: "mixed-pass-fail",
      condition: !!p.hasFunctionTests && failedVisible >= 2 && passedVisible >= 1 && !p.checkPassed,
      icon: "🎯",
      message: "Most tests pass but one keeps failing. Focus on the one failing test and read its input carefully.",
    },
    {
      id: "many-fails",
      // Fires on any of: total check fails ≥3, visible-test fails ≥3, or
      // hidden-test fails ≥3. For legacy lessons (no function_tests) only
      // failedCheckCount is set, so behavior is unchanged.
      condition: (p.failedCheckCount >= 3 || failedVisible >= 3 || failedHidden >= 3) && !p.checkPassed,
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
      message: p.hasFunctionTests
        ? "Your code ran! Click Check My Work — or switch to the Examples tab to try the test cases first."
        : "Your code ran! Click Check My Work to see if it passes.",
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
      message: `Press the Run button (or ${runPhrase}) to see what your code does.`,
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
