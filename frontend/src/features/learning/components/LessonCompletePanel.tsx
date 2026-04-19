import type { LessonMeta } from "../types";
import { formatTimeSpent, type MasteryLevel } from "../utils/mastery";
import { Modal } from "../../../components/Modal";

interface LessonCompletePanelProps {
  lesson: LessonMeta;
  completedPracticeIds?: string[];
  mastery?: MasteryLevel | null;
  timeSpentMs?: number;
  onNext?: () => void;
  onDismiss: () => void;
  onStartPractice?: () => void;
}

export function LessonCompletePanel({
  lesson,
  completedPracticeIds = [],
  mastery = null,
  timeSpentMs,
  onNext,
  onDismiss,
  onStartPractice,
}: LessonCompletePanelProps) {
  const practiceExercises = lesson.practiceExercises ?? [];
  const practiceCount = practiceExercises.length;
  const practiceDone = practiceExercises.filter((ex) =>
    completedPracticeIds.includes(ex.id)
  ).length;
  const showShakyNudge =
    mastery === "shaky" && practiceCount > 0 && practiceDone < practiceCount;

  return (
    <Modal
      onClose={onDismiss}
      role="alertdialog"
      labelledBy="lesson-complete-title"
      position="center"
      panelClassName="mx-4 w-full max-w-md rounded-xl border border-success/30 bg-panel p-6 shadow-xl"
    >
      <div>
        <div className="mb-4 text-center">
          <span aria-hidden="true" className="text-4xl">🎉</span>
          <h2 id="lesson-complete-title" className="mt-2 text-lg font-bold text-success">Lesson Complete!</h2>
          <p id="lesson-complete-desc" className="mt-1 text-sm text-muted">
            Lesson {lesson.order}: {lesson.title}
          </p>
          {timeSpentMs !== undefined && timeSpentMs > 0 && (
            <p className="mt-1.5 text-[11px] text-faint">
              Time spent: <span className="font-medium text-muted">{formatTimeSpent(timeSpentMs)}</span>
              {lesson.estimatedMinutes > 0 && (
                <span className="opacity-70"> (est. {lesson.estimatedMinutes}m)</span>
              )}
            </p>
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
      </div>
    </Modal>
  );
}
