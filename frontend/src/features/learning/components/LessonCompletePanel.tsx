import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LessonMeta } from "../types";
import { formatTimeSpent, type MasteryLevel } from "../utils/mastery";
import { LessonFeedbackChip } from "./LessonFeedbackChip";
import { StreakChip } from "./StreakChip";
import { RingPulse } from "../../../components/cinema/RingPulse";
import { invalidateStreak, useStreak } from "../../../state/useStreak";
import { useDisableStreaks } from "../../../state/preferencesStore";

interface LessonCompletePanelProps {
  lesson: LessonMeta;
  completedPracticeIds?: string[];
  mastery?: MasteryLevel | null;
  timeSpentMs?: number;
  onNext?: () => void;
  onDismiss: () => void;
  onStartPractice?: () => void;
  // Phase 21C: opens the cinematic Share dialog. When omitted (e.g., we
  // can't assemble a snippet — practice mode, no lastCode), the button
  // is hidden rather than shown disabled. Sharing is celebratory; a
  // dimmed "Share" feels worse than no share at all.
  onShare?: () => void;
}

export function LessonCompletePanel({
  lesson,
  completedPracticeIds = [],
  mastery = null,
  timeSpentMs,
  onNext,
  onDismiss,
  onStartPractice,
  onShare,
}: LessonCompletePanelProps) {
  const practiceExercises = lesson.practiceExercises ?? [];
  const practiceCount = practiceExercises.length;
  const practiceDone = practiceExercises.filter((ex) =>
    completedPracticeIds.includes(ex.id)
  ).length;
  const showShakyNudge =
    mastery === "shaky" && practiceCount > 0 && practiceDone < practiceCount;

  // Phase B: Esc dismisses (preserved from the prior Modal wrapper).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Phase 21B (iter-4, post-feedback): refetch streak on mount, then
  // celebrate the CURRENT value — not a value-just-changed odometer.
  //
  // Why we dropped the justExtended/odometer flow:
  //   The qualifying action that EXTENDS the streak is almost always
  //   the first code-run of the day (which fires updateUserStreak
  //   server-side via the lesson PATCH's runCount bump). By the time
  //   the LessonCompletePanel mounts, the streak has already
  //   incremented and the toolbar chip already shows the new value —
  //   so justExtended would be FALSE here, and the odometer-flip
  //   cinematic would never fire in the common path.
  //
  //   New design: the lesson-complete moment ALWAYS gets a streak
  //   celebration when streak > 0, regardless of when the increment
  //   fired. The chip lands prominently with a single RingPulse +
  //   acknowledge so the learner sees their streak as part of the
  //   celebration, not as a detached "+1" event.
  useEffect(() => {
    invalidateStreak();
  }, []);
  const { streak } = useStreak();
  // Phase 27: hide every streak-related surface on this panel when the
  // user has opted out. The chip render below + the milestone-confetti
  // effect both gate on this — turning off must mean nothing flashes.
  const disableStreaks = useDisableStreaks();

  const isMilestone =
    !disableStreaks &&
    !!streak &&
    [7, 14, 30, 100, 365].includes(streak.current);
  // Lazy confetti for milestones — only the most special days earn it.
  // Reduced-motion users get nothing fired, matching the rest of the
  // panel's choreography.
  useEffect(() => {
    if (!isMilestone) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("canvas-confetti");
        if (cancelled) return;
        mod.default({
          particleCount: 80,
          spread: 70,
          origin: { x: 0.85, y: 0.18 },
          ticks: 220,
          colors: ["#34D399", "#38BDF8", "#C084FC", "#D9B269"],
          zIndex: 9999,
        });
      } catch {
        /* swallow — confetti is decoration, not load-bearing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMilestone]);

  // Phase B: full-frame takeover, not a Modal. The lesson-complete
  // beat is the third-act climax — the most emotionally important
  // moment in the product. Pre-Phase B it shipped in a `max-w-md`
  // Modal with the same chrome as the Reset Lesson confirm dialog,
  // and the same 160 ms scale-down exit. Now the panel takes the
  // center column at max-w-2xl, the workspace dims to 20 % opacity
  // behind it (handled by LessonPage), the heading is 40 px in
  // Fraunces, and the rings (already wrapped by CelebrationHeader)
  // get the room they need to breathe.
  return (
    <motion.div
      role="alertdialog"
      aria-labelledby="lesson-complete-title"
      aria-describedby="lesson-complete-desc"
      className="fixed inset-0 z-[55] flex items-center justify-center px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <motion.div
        className="relative w-full max-w-2xl rounded-2xl border border-success/30 bg-panel/95 p-10 shadow-2xl backdrop-blur"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
      <div className="relative">
        {/* Phase 21B (iter-4): always-fire streak celebration on the
            lesson-complete panel. The chip is rendered in PROMINENT mode
            (larger glyph + text) and is non-interactive (no click-to-
            expand popover — this is a celebration moment, not a stats
            lookup). A single RingPulse + soft glow disc fires once on
            mount. Milestone days (7/14/30/100/365) get confetti via
            the effect above.
            Position: top-right of the panel, sized large enough to read
            without competing with the heading. */}
        {streak && streak.current > 0 && !disableStreaks && (
          <div className="absolute right-2 top-2 z-10">
            <div className="relative">
              {/* Soft glow disc behind the chip — blooms on mount,
                  fades. Color matches the success-tier celebration. */}
              <motion.div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 -z-10 rounded-full blur-2xl ${
                  isMilestone ? "bg-success/40" : "bg-accent/30"
                }`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 0.7, scale: 1.6 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
              {/* Single ring pulse around the chip — quiet companion to
                  the existing CelebrationHeader rings. Milestones bump
                  scale + use 3-ring sonar. */}
              <RingPulse
                anchor="self"
                rings={isMilestone ? 3 : 1}
                maxScale={isMilestone ? 18 : 12}
                borderClass={isMilestone ? "border-success/60" : "border-accent/50"}
                delayMs={400}
              />
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
              >
                <StreakChip prominent interactive={false} />
              </motion.div>
            </div>
          </div>
        )}
        <CelebrationHeader
          orderLabel={`Lesson ${lesson.order}: ${lesson.title}`}
        />
        <div className="sr-only" id="lesson-complete-title">Lesson Complete!</div>
        <div className="sr-only" id="lesson-complete-desc">
          Lesson {lesson.order}: {lesson.title}
        </div>
        <div className="mb-4 text-center">
          {/* Heading + subtitle are rendered inside <CelebrationHeader>
              for the animated version. These SR-only copies duplicate
              them so labelledBy/describedBy still point at valid nodes
              without assistive tech tripping over motion elements. */}
          {timeSpentMs !== undefined && timeSpentMs > 0 && (
            <motion.p
              className="text-[11px] text-faint"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              Time spent: <span className="font-medium text-muted">{formatTimeSpent(timeSpentMs)}</span>
              {lesson.estimatedMinutes > 0 && (
                <span className="opacity-70"> (est. {lesson.estimatedMinutes}m)</span>
              )}
            </motion.p>
          )}
        </div>

        {lesson.recap && (
          <div className="mb-4 rounded-lg bg-success/5 px-4 py-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-success/70">
              What you learned
            </h3>
            <p className="text-xs leading-relaxed text-ink/80">{lesson.recap}</p>
          </div>
        )}

        {lesson.teachesConceptTags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {lesson.teachesConceptTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-medium text-violet"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {practiceCount > 0 && (
          <div
            className={`mb-5 rounded-lg border bg-violet/5 px-4 py-3 ${
              showShakyNudge
                ? "border-l-4 border-l-warn border-y-warn/25 border-r-warn/25"
                : "border-violet/20"
            }`}
          >
            {showShakyNudge && (
              <p className="mb-2 text-[11px] font-medium leading-relaxed text-warn/90">
                This one took a few tries — the practice below will help lock it in.
              </p>
            )}
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-violet/80">
                Practice challenges (optional)
              </h3>
              <span className="text-[10px] text-muted">
                {practiceDone}/{practiceCount}
              </span>
            </div>
            <ul className="mb-2 space-y-1.5">
              {practiceExercises.map((ex, i) => {
                const done = completedPracticeIds.includes(ex.id);
                return (
                  <li key={ex.id} className="flex items-start gap-2 text-xs text-ink/80">
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold md:h-4 md:w-4 md:text-[9px] ${
                        done
                          ? "bg-success/20 text-success"
                          : "bg-violet/15 text-violet"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={done ? "line-through opacity-60" : ""}>
                      {ex.title}
                    </span>
                  </li>
                );
              })}
            </ul>
            {onStartPractice && practiceDone < practiceCount && !showShakyNudge && (
              <button
                onClick={onStartPractice}
                className="w-full rounded-lg bg-violet/20 px-3 py-1.5 text-xs font-semibold text-violet transition hover:bg-violet/30"
                aria-label={practiceDone === 0 ? "Start practice challenges" : "Continue practice challenges"}
              >
                {practiceDone === 0 ? "Start Practice" : "Continue Practice"}
              </button>
            )}
          </div>
        )}

        {lesson.practicePrompts && lesson.practicePrompts.length > 0 && practiceCount === 0 && (
          <div className="mb-5 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent/70">
              Try these next
            </h3>
            <ul className="space-y-1.5">
              {lesson.practicePrompts.map((prompt, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink/80">
                  <span className="shrink-0 text-accent/60">•</span>
                  {prompt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Phase 27: prominent share-the-win callout, shown only on
            Lesson 1 of a course (order === 1) — the first program is
            the most emotionally chargeable moment in the journey, and
            the small "Share this win" pill at the bottom undersells it.
            Replaces the bottom pill for lesson 1; pill stays for the
            rest of the course. */}
        {lesson.order === 1 && onShare && (
          <div className="mb-5 rounded-lg border border-accent/30 bg-gradient-to-br from-accent/10 via-violet/5 to-success/10 px-4 py-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent/80">
              Your first one
            </h3>
            <p className="mb-3 text-[13px] leading-relaxed text-ink/85">
              First program shipped. Text it to someone who'd be proud — a
              friend, a group chat, the person who said you'd never start.
            </p>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-violet px-4 py-2 text-[12px] font-bold text-bg shadow-sm transition hover:opacity-90"
              aria-label="Share your first program"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
              Share it
            </button>
          </div>
        )}

        {/* CTA priority swap: when mastery is shaky and practice is incomplete,
            Start Practice becomes primary and Next Lesson is secondary. */}
        <div className="flex items-center gap-2">
          {showShakyNudge && onStartPractice ? (
            <>
              <button
                onClick={onDismiss}
                className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
                aria-label="Close celebration and stay on this lesson"
              >
                Close
              </button>
              {onNext && (
                <button
                  onClick={onNext}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
                  aria-label="Skip to next lesson"
                >
                  Next Lesson →
                </button>
              )}
              <button
                onClick={onStartPractice}
                className="flex-1 rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-2 text-xs font-bold text-bg shadow-glow transition hover:opacity-90"
                aria-label={practiceDone === 0 ? "Start practice challenges" : "Continue practice challenges"}
              >
                {practiceDone === 0 ? "Start Practice →" : "Continue Practice →"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onDismiss}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
                aria-label="Close celebration and stay on this lesson"
              >
                Keep practicing
              </button>
              {onNext && (
                <button
                  onClick={onNext}
                  className="flex-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg transition hover:bg-accent/90"
                  aria-label="Go to next lesson"
                >
                  Next Lesson →
                </button>
              )}
            </>
          )}
        </div>

        {/* Phase 21C: cinematic Share. Subordinate to the primary CTA
            row above — a quiet "Share this win" link, not a competing
            gradient pill. The dialog itself owns the visual reward
            (preview, opt-in, "Make public & share" gradient button).
            Hidden entirely when onShare is not wired (e.g., practice
            mode, no code to share) — better than a dimmed affordance.
            Phase 27: also hidden on Lesson 1 — the prominent "Your
            first one" card above already owns the share affordance. */}
        {onShare && lesson.order !== 1 && (
          <div className="mt-3 flex items-center justify-center">
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-1.5 text-[12px] font-medium text-muted transition hover:border-accent/40 hover:bg-accent/5 hover:text-ink"
              aria-label="Open share dialog for this lesson"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
              Share this win
            </button>
          </div>
        )}

        <LessonFeedbackChip lessonId={lesson.id} lessonTitle={lesson.title} />
      </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * The moment. A checkmark draws itself in, surrounded by expanding rings of
 * light; the heading springs in with overshoot; the subtitle follows.
 * Confetti is fired separately from useLessonValidator so the bursts
 * start on the same frame as the modal's scale-in.
 *
 * Reduced-motion users get a static checkmark + still heading — the
 * content is communicated, the choreography is not.
 */
function CelebrationHeader({ orderLabel }: { orderLabel: string }) {
  const reduce = useReducedMotion();

  return (
    <div className="relative mb-5 flex flex-col items-center text-center">
      {/* Ring cluster behind the check: three concentric rings expand
          outward in a staggered loop. Sits absolute so it's layered
          under the check SVG. pointer-events-none so the panel's own
          focus/click handling isn't intercepted. */}
      {!reduce && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 flex h-24 items-center justify-center"
        >
          {[0, 0.25, 0.5].map((delay, i) => (
            <motion.span
              key={i}
              className="absolute h-16 w-16 rounded-full border border-success/60"
              initial={{ scale: 0.4, opacity: 0.8 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{
                duration: 1.4,
                delay: 0.15 + delay,
                ease: [0.22, 1, 0.36, 1],
                repeat: 1,
                repeatDelay: 0.2,
              }}
            />
          ))}
          {/* Soft glow disc — sits behind the rings, grows with the
              first ring and lingers. Creates a halo feeling without
              another hard-edged circle. */}
          <motion.span
            className="absolute h-24 w-24 rounded-full bg-success/30 blur-2xl"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1.1, opacity: 0.7 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      )}

      {/* SVG check — path draws in via pathLength. stroke-linecap:round so
          the stroke doesn't look chopped when it's partway drawn. The
          outer circle fills in first (a beat of anticipation), then the
          check strokes in. */}
      <motion.svg
        viewBox="0 0 80 80"
        width="72"
        height="72"
        className="relative z-10 mb-2"
        aria-hidden="true"
        initial={reduce ? { opacity: 0 } : { scale: 0.3, opacity: 0, rotate: -12 }}
        animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1, rotate: 0 }}
        transition={
          reduce
            ? { duration: 0.2 }
            : {
                scale: { type: "spring", stiffness: 260, damping: 14 },
                opacity: { duration: 0.3 },
                rotate: { type: "spring", stiffness: 200, damping: 14 },
              }
        }
      >
        {/* Filled circle backing — drawn fully on mount, dark-green
            tinted disc that anchors the check against the backdrop. */}
        <circle cx="40" cy="40" r="32" fill="rgb(var(--color-success) / 0.15)" />
        {/* Stroke ring — draws around the disc as punctuation. */}
        <motion.circle
          cx="40"
          cy="40"
          r="32"
          fill="none"
          stroke="rgb(var(--color-success))"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ pathLength: reduce ? 1 : undefined }}
          initial={reduce ? undefined : { pathLength: 0, rotate: -90 }}
          animate={reduce ? undefined : { pathLength: 1, rotate: -90 }}
          transition={reduce ? undefined : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          transform="rotate(-90 40 40)"
        />
        {/* The check — drawn last, overshooting into the circle with a
            small pause for drama. The strokeDasharray: "auto" trick
            lets pathLength drive reveal cleanly. */}
        <motion.path
          d="M25 42 L36 53 L56 30"
          fill="none"
          stroke="rgb(var(--color-success))"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pathLength: reduce ? 1 : undefined }}
          initial={reduce ? undefined : { pathLength: 0 }}
          animate={reduce ? undefined : { pathLength: 1 }}
          transition={reduce ? undefined : { duration: 0.45, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
      </motion.svg>

      {/* Heading — springs up with overshoot. Gradient fill is ONE of
          the allowed accent→violet uses in the product — this is the
          single most celebratory moment, it earns the treatment.
          Phase B: scaled from 24 → 40 px (Fraunces display) so the
          climactic beat actually reads as climactic — pre-Phase B
          this was clipped inside a max-w-md Modal at button-heading
          weight. The new full-frame takeover gives the heading
          breathing room. */}
      <motion.h2
        className="mb-1 bg-gradient-to-r from-success via-accent to-violet bg-clip-text font-display text-[40px] font-semibold leading-tight tracking-tight text-transparent"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 6 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={
          reduce
            ? { duration: 0.2 }
            : {
                type: "spring",
                stiffness: 220,
                damping: 16,
                delay: 0.2,
              }
        }
      >
        Lesson Complete!
      </motion.h2>

      <motion.p
        className="text-[13px] leading-relaxed text-muted"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: reduce ? 0.1 : 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        {orderLabel}
      </motion.p>
    </div>
  );
}
