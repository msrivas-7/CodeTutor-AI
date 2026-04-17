import type { LessonMeta } from "../types";

interface LessonCompletePanelProps {
  lesson: LessonMeta;
  onNext?: () => void;
  onDismiss: () => void;
}

export function LessonCompletePanel({ lesson, onNext, onDismiss }: LessonCompletePanelProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-green-500/30 bg-panel p-6 shadow-xl">
        <div className="mb-4 text-center">
          <span className="text-4xl">🎉</span>
          <h2 className="mt-2 text-lg font-bold text-green-400">Lesson Complete!</h2>
          <p className="mt-1 text-sm text-muted">
            Lesson {lesson.order}: {lesson.title}
          </p>
        </div>

        {lesson.recap && (
          <div className="mb-4 rounded-lg bg-green-500/5 px-4 py-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-green-400/70">
              What you learned
            </h3>
            <p className="text-xs leading-relaxed text-ink/80">{lesson.recap}</p>
          </div>
        )}

        {lesson.conceptTags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {lesson.conceptTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-violet/10 px-2 py-0.5 text-[10px] font-medium text-violet"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {lesson.practicePrompts && lesson.practicePrompts.length > 0 && (
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

        <div className="flex items-center gap-2">
          <button
            onClick={onDismiss}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
          >
            Keep practicing
          </button>
          {onNext && (
            <button
              onClick={onNext}
              className="flex-1 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg transition hover:bg-accent/90"
            >
              Next Lesson →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
