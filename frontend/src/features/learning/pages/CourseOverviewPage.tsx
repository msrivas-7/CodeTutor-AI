import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Course, LessonMeta } from "../types";
import { loadCourse, loadAllLessonMetas } from "../content/courseLoader";
import { useProgressStore } from "../stores/progressStore";
import { useAuthStore } from "../../../auth/authStore";
import { LessonList } from "../components/LessonList";
import { AnimatedProgressBar } from "../components/AnimatedProgressBar";
import { StaggerReveal, StaggerItem } from "../../../components/StaggerReveal";
import { UserMenu } from "../../../components/UserMenu";
import { FeedbackButton } from "../../../components/FeedbackButton";
import { Wordmark } from "../../../components/Wordmark";
import { Modal } from "../../../components/Modal";
import {
  CourseCompleteFlourish,
  useCourseCompleteBurst,
  clearCourseCelebratedFlag,
} from "../components/CourseCompleteFlourish";
import { CourseCompleteHero } from "../components/CourseCompleteHero";
import { motion } from "framer-motion";
import type { ProgressStatus } from "../types";

export default function CourseOverviewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const learnerId = user!.id;
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
        loadCourseProgress(learnerId, courseId);
        ls.forEach((l) =>
          loadLessonProgress(learnerId, courseId, l.id)
        );
      })
      .catch(() => setCourse(null))
      .finally(() => setLoading(false));
  }, [courseId, learnerId, loadCourseProgress, loadLessonProgress]);

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
  // "Complete" = every required lesson's progress row is `completed`.
  // `lessons.length > 0` guards against the brief loading state where
  // the list is empty and pct would be 0 — which we don't want to
  // celebrate. Also guards against the flicker between setCourse and
  // the first progress row landing.
  const courseComplete = lessons.length > 0 && completedIds.length >= lessons.length;
  useCourseCompleteBurst({ courseId, isComplete: courseComplete });

  // Cinema Kit — streak signal for returning learners. Derives the most
  // recent activity across lessons in THIS course (not-started rows
  // excluded so a stale "never touched" updatedAt can't fake a streak).
  // Translates to an "Active today" or "Back this week" pill next to
  // the progress counter. No pill for idle > 7 days — the silence is
  // the signal there.
  const lastActivityMs = (() => {
    let max = 0;
    for (const l of lessons) {
      const lp = lessonProgressMap[`${courseId}/${l.id}`];
      if (!lp || lp.status === "not_started") continue;
      const t = Date.parse(lp.updatedAt);
      if (!Number.isNaN(t) && t > max) max = t;
    }
    return max;
  })();
  const activityPill = (() => {
    if (lastActivityMs === 0) return null;
    const delta = Date.now() - lastActivityMs;
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (delta < ONE_DAY) {
      return {
        label: "Active today",
        className:
          "rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success ring-1 ring-success/30",
      };
    }
    if (delta <= 7 * ONE_DAY) {
      return {
        label: "Back this week",
        className:
          "rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30",
      };
    }
    return null;
  })();

  return (
    <div className="relative flex h-full flex-col bg-bg text-ink">
      <header className="relative z-20 flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav("/learn")}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
          aria-label="Back to courses"
        >
          ← Courses
        </button>
        <Wordmark size="sm" />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <h1 className="truncate text-[14px] font-medium tracking-tight text-ink">
          {course?.title ?? "Course"}
        </h1>
        {courseComplete && (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 240,
              damping: 18,
              delay: 0.2,
            }}
            className="flex items-center gap-1 rounded-full border border-[rgb(234,179,8)]/40 bg-[rgb(234,179,8)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[rgb(234,179,8)] shadow-[0_0_12px_rgba(234,179,8,0.25)]"
            aria-label="Course complete"
            title="Course complete — every lesson done"
          >
            <svg
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.5 11.5l-3-3 1-1 2 2 4.5-4.5 1 1z" />
            </svg>
            Complete
          </motion.span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FeedbackButton />
          <UserMenu />
        </div>
      </header>

      {courseComplete && <CourseCompleteFlourish seed={courseId?.length ?? 1} />}

      <div className="relative flex-1 overflow-y-auto">
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
          <StaggerReveal className="mx-auto max-w-2xl px-6 py-6">
            {courseComplete && (
              <StaggerItem>
                <CourseCompleteHero
                  courseTitle={course.title}
                  completedLessons={completedIds.length}
                  totalLessons={lessons.length}
                  practiceDone={practiceDoneTotal}
                  practiceTotal={practiceGrandTotal}
                />
              </StaggerItem>
            )}
            <StaggerItem>
              <p className="mb-4 text-xs leading-relaxed text-muted">
                {course.description}
              </p>
            </StaggerItem>

            <StaggerItem className="mb-6 rounded-lg border border-border bg-panel/60 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Progress
                </span>
                <div className="flex items-center gap-2 text-[11px]">
                  {/* Cinema Kit — Fraunces echo. The completed-count
                      number carries the cinematic's display face.
                      Reading surfaces don't earn grain or rings; the
                      typographic echo is the continuity signal. */}
                  <span className="text-ink">
                    <span className="font-display text-[16px] font-semibold">
                      {completedIds.length}
                    </span>
                    <span className="font-medium text-muted">
                      /{lessons.length} lessons
                    </span>
                  </span>
                  {practiceGrandTotal > 0 && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="font-medium text-violet/90">
                        {practiceDoneTotal}/{practiceGrandTotal} practice
                      </span>
                    </>
                  )}
                  {/* Cinema Kit — streak pill. Only renders when the
                      learner's been active within the last week. */}
                  {activityPill && (
                    <span className={activityPill.className}>
                      {activityPill.label}
                    </span>
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
              <AnimatedProgressBar
                pct={pct}
                height={8}
                // Gold when course is complete — makes the bar itself
                // read as "done, celebrated" rather than just "full".
                // Violet fill otherwise so in-progress vs complete are
                // distinct at a glance from across the page.
                fillClassName={
                  courseComplete
                    ? "bg-gradient-to-r from-[rgb(234,179,8)] via-[rgb(250,204,21)] to-[rgb(245,158,11)] shadow-[0_0_10px_-2px_rgba(234,179,8,0.6)]"
                    : "bg-violet"
                }
                trackClassName="bg-elevated"
                ariaLabel={`Course progress: ${completedIds.length} of ${lessons.length} lessons completed`}
                shimmerKey={courseId ? `course:${courseId}:lessons` : undefined}
              />
              {practiceGrandTotal > 0 && (
                <div className="mt-1.5" title={`${practiceDoneTotal}/${practiceGrandTotal} practice exercises`}>
                  <AnimatedProgressBar
                    pct={practicePct}
                    height={6}
                    fillClassName="bg-gradient-to-r from-violet/70 to-accent/70"
                    trackClassName="bg-elevated/60"
                    ariaLabel={`Practice progress: ${practiceDoneTotal} of ${practiceGrandTotal} exercises done`}
                    shimmerKey={courseId ? `course:${courseId}:practice` : undefined}
                  />
                </div>
              )}
            </StaggerItem>

            {completedIds.length === 0 && (!cp || cp.status === "not_started") && lessons.length > 0 && (
              <StaggerItem className="mb-5 flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
                <span className="text-lg">👇</span>
                <p className="text-xs leading-relaxed text-ink/80">
                  Start with <strong>Lesson 1</strong> — each lesson builds on the last. Click a lesson to open it.
                </p>
              </StaggerItem>
            )}

            <StaggerItem>
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
            </StaggerItem>
          </StaggerReveal>
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
                resetCourseProgress(learnerId, courseId, course.lessonOrder);
                // Clear the "already celebrated" flag so that if the
                // learner re-completes this course, the confetti burst
                // fires again. Persistent flourish comes back online
                // automatically when pct climbs back to 100.
                clearCourseCelebratedFlag(courseId);
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
