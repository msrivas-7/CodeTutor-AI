import { useEffect, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { LessonMeta } from "../types";
import { formatTimeSpent, type MasteryLevel } from "../utils/mastery";
import { LessonFeedbackChip } from "./LessonFeedbackChip";
import { StreakChip } from "./StreakChip";
import { RingPulse } from "../../../components/cinema/RingPulse";
import { invalidateStreak, useStreak } from "../../../state/useStreak";
import { useDisableStreaks } from "../../../state/preferencesStore";
import { Modal } from "../../../components/Modal";

/**
 * Phase A — A7: resolve the post-credits ("next episode") line.
 * Authored `nextLessonHint` wins; otherwise a soft tease built from the
 * next lesson's title; null on the final lesson (CourseCompleteFlourish
 * owns that ending) — a null result means render nothing.
 *
 * Deliberately carries no "Tomorrow"/streak framing: it names what comes
 * next, never when the learner must show up. Exported for unit tests.
 */
export function resolvePostCredits(
  nextLessonHint: string | undefined,
  nextLessonTitle: string | null | undefined,
): string | null {
  const hint = nextLessonHint?.trim();
  if (hint) return hint;
  const title = nextLessonTitle?.trim();
  return title ? `In the next lesson: ${title}.` : null;
}

interface LessonCompletePanelProps {
  lesson: LessonMeta;
  completedPracticeIds?: string[];
  mastery?: MasteryLevel | null;
  timeSpentMs?: number;
  onNext?: (trigger: HTMLButtonElement) => void;
  onDismiss: () => void;
  onStartPractice?: () => void;
  // Phase 21C: opens the cinematic Share dialog. When omitted (e.g., we
  // can't assemble a snippet — practice mode, no lastCode), the button
  // is hidden rather than shown disabled. Sharing is celebratory; a
  // dimmed "Share" feels worse than no share at all.
  onShare?: (trigger: HTMLButtonElement) => void;
  /**
   * Phase A — A7: post-credits beat. The next lesson's title, used as
   * the fallback tease when the lesson hasn't authored a
   * nextLessonHint. Null/omitted on the course's final lesson —
   * no tease, the CourseCompleteFlourish owns that ending.
   */
  nextLessonTitle?: string | null;
  /**
   * Phase 27-v2.1 — when "anon", suppresses the streak refetch + read
   * (would 401 on /api/user/streak), and the streak/practice-grid
   * surfaces that read from authed-only state. Default "authed"
   * preserves all existing behavior. The celebration body, share card,
   * mastery callout, and Next CTA all render the same on both modes.
   */
  mode?: "authed" | "anon";
  returnFocusRef?: RefObject<HTMLElement | null>;
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
  nextLessonTitle = null,
  mode = "authed",
  returnFocusRef,
}: LessonCompletePanelProps) {
  const postCredits = resolvePostCredits(lesson.nextLessonHint, nextLessonTitle);
  const practiceExercises = lesson.practiceExercises ?? [];
  const practiceCount = practiceExercises.length;
  const practiceDone = practiceExercises.filter((ex) =>
    completedPracticeIds.includes(ex.id)
  ).length;
  const showShakyNudge =
    mastery === "shaky" && practiceCount > 0 && practiceDone < practiceCount;

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
  // Phase 27-v2.1: anon skips streak fetch + read entirely. The streak
  // endpoint is auth-gated; firing it on the celebration moment for an
  // unauth caller would 401 in the network panel. The streak chip
  // render below already gates on `streak`, so streak === null on anon
  // hides the surface naturally.
  useEffect(() => {
    if (mode === "anon") return;
    invalidateStreak();
  }, [mode]);
  const { streak } = useStreak({ skip: mode === "anon" });
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
    <Modal
      onClose={onDismiss}
      role="dialog"
      labelledBy="lesson-complete-title"
      describedBy="lesson-complete-desc"
      position="center"
      zIndex={55}
      returnFocusRef={returnFocusRef}
      panelClassName="lesson-complete-panel relative w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-success/30 bg-panel/95 p-4 shadow-2xl backdrop-blur sm:p-6"
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
        <div className="completion-time mb-3 text-center">
          {/* Heading + subtitle are rendered inside <CelebrationHeader>
              for the animated version. These SR-only copies duplicate
              them so labelledBy/describedBy still point at valid nodes
              without assistive tech tripping over motion elements. */}
          {timeSpentMs !== undefined && timeSpentMs > 0 && (
            <motion.p
              className="text-meta text-faint"
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
          <div className="completion-recap mb-3 rounded-lg bg-success/5 px-4 py-2.5">
            <h3 className="mb-1 text-meta font-semibold uppercase tracking-wider text-success/70">
              What you learned
            </h3>
            <p className="line-clamp-2 text-sm leading-relaxed text-ink/80">{lesson.recap}</p>
          </div>
        )}

        {lesson.teachesConceptTags.length > 0 && (
          <div className="completion-tags mb-3 flex flex-wrap gap-1.5">
            {lesson.teachesConceptTags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-violet/10 px-2 py-1 text-meta font-medium text-violet"
              >
                {tag}
              </span>
            ))}
            {lesson.teachesConceptTags.length > 4 && (
              <span className="rounded-full bg-elevated px-2 py-1 text-meta font-medium text-muted">
                +{lesson.teachesConceptTags.length - 4} more
              </span>
            )}
          </div>
        )}

        {practiceCount > 0 && (
          <div
            className={`completion-practice mb-3 rounded-lg border bg-violet/5 px-4 py-2.5 ${
              showShakyNudge
                ? "border-l-4 border-l-warn border-y-warn/25 border-r-warn/25"
                : "border-violet/20"
            }`}
          >
            {showShakyNudge && (
              <p className="mb-2 text-base font-medium leading-relaxed text-warn/90 sm:text-body">
                This one took a few tries — the practice below will help lock it in.
              </p>
            )}
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-meta font-semibold uppercase tracking-wider text-violet/80">
                Practice challenges (optional)
              </h3>
              <span className="text-meta text-muted">
                {practiceDone}/{practiceCount}
              </span>
            </div>
            <p className="mb-2 text-sm leading-relaxed text-ink/80">
              {practiceDone === practiceCount
                ? "All optional challenges complete."
                : `${practiceCount - practiceDone} short challenge${practiceCount - practiceDone === 1 ? "" : "s"} can help this lesson stick.`}
            </p>
            {onStartPractice && practiceDone < practiceCount && !showShakyNudge && (
              <button
                onClick={onStartPractice}
                className="min-h-11 w-full rounded-lg bg-violet/20 px-3 py-2 text-sm font-semibold text-violet transition hover:bg-violet/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                aria-label={practiceDone === 0 ? "Start practice challenges" : "Continue practice challenges"}
              >
                {practiceDone === 0 ? "Start Practice" : "Continue Practice"}
              </button>
            )}
          </div>
        )}

        {lesson.practicePrompts && lesson.practicePrompts.length > 0 && practiceCount === 0 && (
          <div className="completion-practice mb-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-2.5">
            <h3 className="mb-2 text-meta font-semibold uppercase tracking-wider text-accent/70">
              Try these next
            </h3>
            <p className="line-clamp-2 text-sm leading-relaxed text-ink/80">
              {lesson.practicePrompts[0]}
              {lesson.practicePrompts.length > 1 ? ` · +${lesson.practicePrompts.length - 1} more` : ""}
            </p>
          </div>
        )}

        {/* Phase 27: prominent share-the-win callout, shown only on
            Lesson 1 of a course (order === 1) — the first program is
            the most emotionally chargeable moment in the journey, and
            the small "Share this win" pill at the bottom undersells it.
            Replaces the bottom pill for lesson 1; pill stays for the
            rest of the course. */}
        {lesson.order === 1 && onShare && (
          <div className="completion-share mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-gradient-to-br from-accent/10 via-violet/5 to-success/10 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-meta font-semibold uppercase tracking-wider text-accent/80">
                Your first one
              </h3>
              <p className="text-sm leading-relaxed text-ink/85">
                First program shipped. Share the win with someone you'd like to show.
              </p>
            </div>
            <button
              type="button"
              onClick={(event) => onShare(event.currentTarget)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-accent to-violet px-4 py-2 text-sm font-bold text-bg shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

        {/* Phase A — A7: post-credits. Sits right above the CTA row so
            the tease is the last thing read before choosing to
            continue — the "next episode" card, not a nag. */}
        {postCredits && (
          <p className="completion-post-credits mb-3 text-center text-sm italic leading-relaxed text-muted">
            {postCredits}
          </p>
        )}
        {/* CTA priority swap: when mastery is shaky and practice is incomplete,
            Start Practice becomes primary and Next Lesson is secondary. */}
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          {showShakyNudge && onStartPractice ? (
            <>
              <button
                onClick={onDismiss}
                className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Keep practicing on this lesson"
              >
                Close
              </button>
              {onNext && (
                <button
                  onClick={(event) => onNext(event.currentTarget)}
                  className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label="Skip to next lesson"
                >
                  Next Lesson →
                </button>
              )}
              <button
                onClick={onStartPractice}
                className="min-h-11 flex-1 rounded-lg bg-gradient-to-r from-violet to-accent px-4 py-2 text-sm font-bold text-bg shadow-glow transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={practiceDone === 0 ? "Start practice challenges" : "Continue practice challenges"}
              >
                {practiceDone === 0 ? "Start Practice →" : "Continue Practice →"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onDismiss}
                className="min-h-11 flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Keep practicing on this lesson"
              >
                Keep practicing
              </button>
              {onNext && (
                <button
                  onClick={(event) => onNext(event.currentTarget)}
                  className="min-h-11 flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              onClick={(event) => onShare(event.currentTarget)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-muted transition hover:border-accent/40 hover:bg-accent/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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

        {mode === "authed" && (
          <div className="completion-feedback">
            <LessonFeedbackChip lessonId={lesson.id} lessonTitle={lesson.title} />
          </div>
        )}
      </div>
    </Modal>
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
    <div className="completion-celebration relative mb-3 flex flex-col items-center text-center">
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
        className="completion-check relative z-10 mb-1"
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
        className="completion-title mb-1 bg-gradient-to-r from-success via-accent to-violet bg-clip-text font-display text-[34px] font-semibold leading-tight tracking-tight text-transparent sm:text-[38px]"
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
