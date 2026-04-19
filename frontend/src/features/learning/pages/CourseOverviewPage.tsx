import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Course, LessonMeta } from "../types";
import { loadCourse, loadAllLessonMetas } from "../content/courseLoader";
import { useProgressStore } from "../stores/progressStore";
import { useLearnerStore } from "../stores/learnerStore";
import { LessonList } from "../components/LessonList";
import { SettingsButton } from "../../../components/SettingsButton";
import { Modal } from "../../../components/Modal";
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
  const practiceProgressMap: Record<string, { done: number; total: number }> = {};
  let practiceDoneTotal = 0;
  let practiceGrandTotal = 0;
  for (const l of lessons) {
    const lp = lessonProgressMap[`${courseId}/${l.id}`];
    progressMap[l.id] = lp?.status ?? "not_started";
    const total = l.practiceExercises?.length ?? 0;
    if (total > 0) {
      const doneIds = lp?.practiceCompletedIds ?? [];
      const done = doneIds.filter((id) => l.practiceExercises!.some((e) => e.id === id)).length;
      practiceProgressMap[l.id] = { done, total };
      practiceDoneTotal += done;
      practiceGrandTotal += total;
    }
  }

  const pct =
    lessons.length > 0
      ? Math.round((completedIds.length / lessons.length) * 100)
      : 0;
  const practicePct =
    practiceGrandTotal > 0
      ? Math.round((practiceDoneTotal / practiceGrandTotal) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav("/learn")}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
          aria-label="Back to courses"
        >
          ← Courses
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
          AI
        </div>
        <h1 className="text-sm font-semibold tracking-tight">
          {course?.title ?? "Course"}
        </h1>
        <div className="ml-auto">
          <SettingsButton />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div
            className="mx-auto max-w-2xl px-6 py-6"
            role="status"
            aria-live="polite"
            aria-label="Loading course"
          >
            <span className="sr-only">Loading…</span>
            <span className="skeleton mb-4 block h-3 w-3/4 rounded" />
            <div className="mb-6 rounded-lg border border-border bg-panel/60 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="skeleton h-3 w-20 rounded" />
                <span className="skeleton h-3 w-24 rounded" />
              </div>
              <span className="skeleton block h-2 w-full rounded-full" />
            </div>
            <ul className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-border bg-panel/60 px-4 py-3"
                >
                  <span className="skeleton h-6 w-6 rounded-full" />
                  <span className="skeleton h-4 flex-1 rounded" />
                  <span className="skeleton h-3 w-12 rounded" />
                </li>
              ))}
            </ul>
          </div>
        ) : course ? (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <p className="mb-4 text-xs leading-relaxed text-muted">
              {course.description}
            </p>

            <div className="mb-6 rounded-lg border border-border bg-panel/60 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Progress
                </span>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium text-ink">
                    {completedIds.length}/{lessons.length} lessons
                  </span>
                  {practiceGrandTotal > 0 && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="font-medium text-violet/90">
                        {practiceDoneTotal}/{practiceGrandTotal} practice
                      </span>
                    </>
                  )}
                  {cp && cp.status !== "not_started" && (
                    <button
                      onClick={() => setConfirmReset(true)}
                      className="ml-1 rounded-md border border-danger/20 px-2 py-0.5 text-[10px] font-medium text-danger/80 transition hover:bg-danger/10 hover:text-danger"
                      title="Reset all progress for this course (destructive)"
                      aria-label="Reset all course progress"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-elevated"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Course progress: ${completedIds.length} of ${lessons.length} lessons completed`}
              >
                <div
                  className="h-full rounded-full bg-violet transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {practiceGrandTotal > 0 && (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated/60"
                  role="progressbar"
                  aria-valuenow={practicePct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Practice progress: ${practiceDoneTotal} of ${practiceGrandTotal} exercises done`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet/70 to-accent/70 transition-all"
                    style={{ width: `${practicePct}%` }}
                    title={`${practiceDoneTotal}/${practiceGrandTotal} practice exercises`}
                  />
                </div>
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
              practiceProgressMap={practiceProgressMap}
              onSelect={(lessonId) =>
                nav(`/learn/course/${courseId}/lesson/${lessonId}`)
              }
              onSelectPractice={(lessonId) =>
                nav(`/learn/course/${courseId}/lesson/${lessonId}?mode=practice`)
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
        <Modal
          onClose={() => setConfirmReset(false)}
          role="alertdialog"
          labelledBy="reset-course-title"
          position="center"
          panelClassName="mx-4 w-full max-w-sm rounded-xl border border-danger/30 bg-panel p-5 shadow-xl"
        >
          <h2 id="reset-course-title" className="text-sm font-bold text-ink">Reset Course Progress?</h2>
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
              className="flex-1 rounded-lg bg-danger/20 px-4 py-2 text-xs font-semibold text-danger ring-1 ring-danger/40 transition hover:bg-danger/30"
            >
              Reset Course
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
