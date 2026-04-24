import { motion } from "framer-motion";
import type { LessonMeta, CourseProgress } from "../types";
import { FilmGrain } from "../../../components/cinema/FilmGrain";

interface ResumeLearningCardProps {
  courseTitle: string;
  progress: CourseProgress;
  nextLesson: LessonMeta | null;
  /** Needed for the "N of M done" headline. Caller (StartPage)
   *  already has the count from its lesson-meta fetch. */
  totalLessons: number;
  onResume: () => void;
}

// Cinema Kit — return moment card.
//
// Reframes from "here's your next task" to "here's how far you've
// come." The completed count is the eyebrow on the shot, rendered
// in the cinematic's Fraunces display face. Next-lesson title
// demotes to a muted subtitle. Once the learner crosses 50% of the
// course, the card's accent border switches to a success glow —
// visible proof that most of this course is behind them.
//
// Earns FilmGrain at `ambient` intensity: this is one of the three
// return-moment surfaces in the product, exactly where a director
// would want a little texture. Grain stays pointer-events:none so
// the Resume button remains fully interactive.
export function ResumeLearningCard({
  courseTitle,
  progress,
  nextLesson,
  totalLessons,
  onResume,
}: ResumeLearningCardProps) {
  if (!nextLesson) return null;

  const completed = progress.completedLessonIds.length;
  const pct = totalLessons > 0 ? completed / totalLessons : 0;
  const pastHalf = pct > 0.5;

  const frameClass = pastHalf
    ? "border-success/40 bg-success/5 shadow-[0_0_24px_-8px_rgb(var(--color-success)/0.3)]"
    : "border-accent/30 bg-accent/5";

  return (
    <div className={`relative overflow-hidden rounded-xl border p-4 ${frameClass}`}>
      <FilmGrain intensity="ambient" />
      <div className="relative z-10 flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            {courseTitle}
          </p>
          {/* Fraunces echo — the number of lessons done leads the
              eye. The rest is subtitle weight. */}
          <p className="text-ink">
            <span className="font-display text-[28px] font-semibold leading-tight">
              {completed}
            </span>
            <span className="ml-1 text-sm text-muted">
              of {totalLessons} done
            </span>
          </p>
          <p className="mt-0.5 truncate text-sm text-muted">
            Next up: <span className="text-ink/80">{nextLesson.title}</span>
          </p>
        </div>
        <motion.button
          onClick={onResume}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.12 }}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg transition hover:bg-accent/90"
        >
          Resume
        </motion.button>
      </div>
    </div>
  );
}
