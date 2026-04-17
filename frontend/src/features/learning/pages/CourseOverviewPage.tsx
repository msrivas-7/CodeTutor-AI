import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Course, LessonMeta } from "../types";
import { loadCourse, loadAllLessonMetas } from "../content/courseLoader";
import { useProgressStore } from "../stores/progressStore";
import { useLearnerStore } from "../stores/learnerStore";
import { LessonList } from "../components/LessonList";
import type { ProgressStatus } from "../types";

export default function CourseOverviewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const nav = useNavigate();
  const { identity } = useLearnerStore();
  const loadCourseProgress = useProgressStore((s) => s.loadCourseProgress);
  const loadLessonProgress = useProgressStore((s) => s.loadLessonProgress);
  const resetCourseProgress = useProgressStore((s) => s.resetCourseProgress);
  const courseProgressMap = useProgressStore((s) => s.courseProgress);
  const lessonProgressMap = useProgressStore((s) => s.lessonProgress);

  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<LessonMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    Promise.all([loadCourse(courseId), loadAllLessonMetas(courseId)])
      .then(([c, ls]) => {
        setCourse(c);
        setLessons(ls);
        loadCourseProgress(identity.learnerId, courseId);
        ls.forEach((l) =>
          loadLessonProgress(identity.learnerId, courseId, l.id)
        );
      })
      .catch(() => setCourse(null))
      .finally(() => setLoading(false));
  }, [courseId, identity.learnerId, loadCourseProgress, loadLessonProgress]);

  if (!courseId) return null;

  const cp = courseProgressMap[courseId];
  const completedIds = cp?.completedLessonIds ?? [];
  const progressMap: Record<string, ProgressStatus> = {};
  for (const l of lessons) {
    const lp = lessonProgressMap[`${courseId}/${l.id}`];
    progressMap[l.id] = lp?.status ?? "not_started";
  }

  const pct =
    lessons.length > 0
      ? Math.round((completedIds.length / lessons.length) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav("/learn")}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
        >
          ← Courses
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
          AI
        </div>
        <h1 className="text-sm font-semibold tracking-tight">
          {course?.title ?? "Course"}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="skeleton h-4 w-32 rounded" />
          </div>
        ) : course ? (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <p className="mb-4 text-xs leading-relaxed text-muted">
              {course.description}
            </p>

            <div className="mb-6 flex items-center gap-3">
              <div className="h-2 flex-1 rounded-full bg-elevated">
                <div
                  className="h-full rounded-full bg-violet transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-muted">
                {completedIds.length}/{lessons.length} lessons
              </span>
              {cp && cp.status !== "not_started" && (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="rounded-md px-2 py-1 text-[10px] text-muted transition hover:bg-red-500/10 hover:text-red-400"
                  title="Reset all progress for this course"
                >
                  Reset Course
                </button>
              )}
            </div>

            {completedIds.length === 0 && (!cp || cp.status === "not_started") && lessons.length > 0 && (
              <div className="mb-5 flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
                <span className="text-lg">👇</span>
                <p className="text-xs leading-relaxed text-ink/80">
                  Start with <strong>Lesson 1</strong> — each lesson builds on the last. Click a lesson to open it.
                </p>
              </div>
            )}

            <LessonList
              lessons={lessons}
              progressMap={progressMap}
              completedIds={completedIds}
              onSelect={(lessonId) =>
                nav(`/learn/course/${courseId}/lesson/${lessonId}`)
              }
            />
          </div>
        ) : (
          <div className="flex items-center justify-center py-20 text-sm text-muted">
            Course not found
          </div>
        )}
      </div>
      {confirmReset && course && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-red-500/30 bg-panel p-5 shadow-xl">
            <h2 className="text-sm font-bold text-ink">Reset Course Progress?</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              This will clear all progress for every lesson in <span className="font-semibold text-ink">{course.title}</span> — attempts, runs, hints, saved code, and completion status. You'll start the entire course from scratch.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => setConfirmReset(false)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted transition hover:bg-elevated hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  resetCourseProgress(identity.learnerId, courseId, course.lessonOrder);
                  setConfirmReset(false);
                }}
                className="flex-1 rounded-lg bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-400 ring-1 ring-red-500/30 transition hover:bg-red-500/25"
              >
                Reset Course
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
