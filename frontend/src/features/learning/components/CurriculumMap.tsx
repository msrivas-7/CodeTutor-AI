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

export type NodeState = "completed" | "next" | "untouched";

export interface MapNode {
  lesson: LessonMeta;
  state: NodeState;
  /** True when the PREVIOUS lesson is completed — colors the connector. */
  prevCompleted: boolean;
}

/**
 * Pure layout math for one course row: walk `course.lessonOrder`, resolve
 * each id to its meta (dropping ids with no meta — a content-lint error,
 * not a UI crash), and label each node.
 *
 * "next" is the FIRST uncompleted lesson in course order, matching the
 * course page's next-up logic. A fully-completed course has no "next".
 * Exported so the labelling is unit-testable without a DOM.
 */
export function buildCourseNodes(
  course: Course,
  lessons: LessonMeta[],
  completedLessonIds: string[],
): { nodes: MapNode[]; doneCount: number } {
  const completed = new Set(completedLessonIds);
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const ordered = course.lessonOrder
    .map((id) => byId.get(id))
    .filter((l): l is LessonMeta => !!l);
  const nextIdx = ordered.findIndex((l) => !completed.has(l.id));
  const nodes = ordered.map((lesson, i) => ({
    lesson,
    state: completed.has(lesson.id)
      ? ("completed" as const)
      : i === nextIdx
        ? ("next" as const)
        : ("untouched" as const),
    prevCompleted: i > 0 && completed.has(ordered[i - 1].id),
  }));
  return { nodes, doneCount: nodes.filter((n) => n.state === "completed").length };
}

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
          const { nodes, doneCount } = buildCourseNodes(
            course,
            lessons,
            courseProgressMap[course.id]?.completedLessonIds ?? [],
          );
          return (
            <div key={course.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-ink">
                  {course.title}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-faint">
                  {doneCount}/{nodes.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-y-2">
                {nodes.map(({ lesson, state, prevCompleted }, i) => {
                  return (
                    <div key={lesson.id} className="flex items-center">
                      {i > 0 && (
                        <span
                          aria-hidden="true"
                          className={`h-px w-3 sm:w-4 ${
                            state === "completed" || prevCompleted
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
