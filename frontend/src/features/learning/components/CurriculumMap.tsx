import type { Course, LessonMeta, CourseProgress } from "../types";

// Phase A — A7 (founder identity batch): the curriculum map.
//
// One glanceable picture of the whole journey — every course as a row,
// every lesson as a node on that row, colored by state. The dashboard
// already answers "what's next?" (resume banner + progress card); this
// answers "where am I on the whole road?" — the map a learner mentally
// draws anyway, drawn for them. Identity value: the product visibly HAS
// a curriculum with a shape and an end, which is exactly the thing an
// open-ended chat tutor can't show.
//
// Interaction: nodes are buttons. Completed/in-progress lessons navigate
// straight in; untouched lessons navigate too — the lesson loader's
// prereq guard already bounces locked lessons back to the course page,
// so the map doesn't re-implement gating.

interface CourseRow {
  course: Course;
  lessons: LessonMeta[];
}

export interface CurriculumMapProps {
  courses: CourseRow[];
  courseProgressMap: Record<string, CourseProgress | undefined>;
  onOpenLesson: (courseId: string, lessonId: string) => void;
}

type NodeState = "completed" | "next" | "untouched";

export function CurriculumMap({
  courses,
  courseProgressMap,
  onOpenLesson,
}: CurriculumMapProps) {
  if (courses.length === 0) return null;
  return (
    <section aria-label="Curriculum map" className="flex flex-col gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        The whole road
      </h2>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-4">
        {courses.map(({ course, lessons }) => {
          const completed = new Set(
            courseProgressMap[course.id]?.completedLessonIds ?? [],
          );
          const ordered = course.lessonOrder
            .map((id) => lessons.find((l) => l.id === id))
            .filter((l): l is LessonMeta => !!l);
          // "next" = first uncompleted lesson in order; everything after
          // is untouched. Matches the course page's next-up logic.
          const nextIdx = ordered.findIndex((l) => !completed.has(l.id));
          const doneCount = ordered.filter((l) => completed.has(l.id)).length;
          return (
            <div key={course.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-ink">
                  {course.title}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-faint">
                  {doneCount}/{ordered.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-y-2">
                {ordered.map((lesson, i) => {
                  const state: NodeState = completed.has(lesson.id)
                    ? "completed"
                    : i === nextIdx
                      ? "next"
                      : "untouched";
                  return (
                    <div key={lesson.id} className="flex items-center">
                      {i > 0 && (
                        <span
                          aria-hidden="true"
                          className={`h-px w-3 sm:w-4 ${
                            state === "completed" ||
                            (i - 1 >= 0 && completed.has(ordered[i - 1].id))
                              ? "bg-success/50"
                              : "bg-border"
                          }`}
                        />
                      )}
                      <button
                        onClick={() => onOpenLesson(course.id, lesson.id)}
                        title={`Lesson ${lesson.order}: ${lesson.title}`}
                        aria-label={`Lesson ${lesson.order}: ${lesson.title} — ${
                          state === "completed"
                            ? "completed"
                            : state === "next"
                              ? "up next"
                              : "not started"
                        }`}
                        className={`flex h-4 w-4 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          state === "completed"
                            ? "bg-success/80 hover:bg-success"
                            : state === "next"
                              ? "bg-accent/20 ring-2 ring-accent hover:bg-accent/40"
                              : "bg-elevated ring-1 ring-border hover:ring-muted"
                        }`}
                      >
                        {state === "completed" && (
                          <svg
                            className="h-2.5 w-2.5 text-bg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
