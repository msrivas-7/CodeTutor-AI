import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Course, LessonMeta, LessonProgress, CourseProgress } from "../types";
import { loadCourse, loadAllLessonMetas } from "../content/courseLoader";
import { useProgressStore, loadAllLessonProgress } from "../stores/progressStore";
import { useLearnerStore } from "../stores/learnerStore";
import { CourseCard } from "../components/CourseCard";

const COURSES = ["python-fundamentals"];

interface CourseData {
  course: Course;
  lessons: LessonMeta[];
}

export default function LearningDashboardPage() {
  const nav = useNavigate();
  const { identity } = useLearnerStore();
  const loadCourseProgress = useProgressStore((s) => s.loadCourseProgress);
  const courseProgressMap = useProgressStore((s) => s.courseProgress);

  const [courses, setCourses] = useState<CourseData[]>([]);
  const [allLessonProgress, setAllLessonProgress] = useState<LessonProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all(
      COURSES.map(async (id) => {
        const [course, lessons] = await Promise.all([
          loadCourse(id),
          loadAllLessonMetas(id),
        ]);
        loadCourseProgress(identity.learnerId, id);
        return { course, lessons };
      })
    )
      .then((data) => {
        setCourses(data);
        const lps: LessonProgress[] = [];
        for (const { course } of data) {
          lps.push(...loadAllLessonProgress(course.id, course.lessonOrder));
        }
        setAllLessonProgress(lps);
      })
      .finally(() => setLoading(false));
  }, [identity.learnerId, loadCourseProgress]);

  const activeCourse = courses[0] ?? null;
  const activeProgress: CourseProgress | null =
    activeCourse ? courseProgressMap[activeCourse.course.id] ?? null : null;

  const nextLesson: LessonMeta | null = useMemo(() => {
    if (!activeCourse || !activeProgress) return null;
    if (activeProgress.status === "completed") return null;
    return (
      activeCourse.lessons.find(
        (l) => !activeProgress.completedLessonIds.includes(l.id)
      ) ?? null
    );
  }, [activeCourse, activeProgress]);

  const recentActivity = useMemo(() => {
    return [...allLessonProgress]
      .filter((lp) => lp.startedAt)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 3);
  }, [allLessonProgress]);

  const needsReview = useMemo(() => {
    return allLessonProgress.filter(
      (lp) => lp.runCount >= 5 || lp.attemptCount >= 3
    );
  }, [allLessonProgress]);

  const completedCount = activeProgress?.completedLessonIds.length ?? 0;
  const totalCount = activeCourse?.lessons.length ?? 0;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function lessonTitle(lessonId: string): string {
    const meta = activeCourse?.lessons.find((l) => l.id === lessonId);
    return meta?.title ?? lessonId;
  }

  function lessonOrder(lessonId: string): number {
    const meta = activeCourse?.lessons.find((l) => l.id === lessonId);
    return meta?.order ?? 0;
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return "";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav("/")}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
        >
          ← Home
        </button>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-[11px] font-bold text-bg shadow-glow">
          AI
        </div>
        <h1 className="text-sm font-semibold tracking-tight">Guided Learning</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="skeleton h-4 w-32 rounded" />
            </div>
          ) : (
            <>
              {/* First-visit welcome — shown when no course has been started */}
              {activeCourse && (!activeProgress || activeProgress.status === "not_started") && (
                <div className="mb-8 rounded-xl border border-violet/20 bg-gradient-to-br from-violet/5 to-accent/5 p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-violet text-sm font-bold text-bg shadow-glow">
                      AI
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-ink">Ready to start coding?</h2>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        Pick a course below to begin. Each lesson has step-by-step instructions, a code editor, and an AI tutor to help you along the way. No experience needed.
                      </p>
                      <button
                        onClick={() => nav(`/learn/course/${activeCourse.course.id}`)}
                        className="mt-4 rounded-lg bg-gradient-to-r from-accent to-violet px-5 py-2 text-xs font-bold text-bg shadow-glow transition hover:opacity-90"
                      >
                        Open {activeCourse.course.title} →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Progress summary + next lesson CTA */}
              {activeCourse && activeProgress && activeProgress.status !== "not_started" && (
                <div className="mb-8 rounded-xl border border-border bg-panel p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-bold">{activeCourse.course.title}</h2>
                      <p className="mt-1 text-sm text-muted">
                        {activeProgress.status === "completed" ? (
                          <>You completed all {totalCount} lessons!</>
                        ) : (
                          <>You've completed <span className="font-semibold text-ink">{completedCount}</span> of {totalCount} lessons</>
                        )}
                      </p>
                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-elevated">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-accent to-violet transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-muted">{pct}%</span>
                      </div>
                    </div>
                    {nextLesson && (
                      <button
                        onClick={() => nav(`/learn/course/${activeCourse.course.id}/lesson/${nextLesson.id}`)}
                        className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent/90"
                      >
                        {completedCount === 0 ? "Start" : "Continue"}
                      </button>
                    )}
                  </div>
                  {nextLesson && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-accent/5 px-3 py-2">
                      <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <div className="min-w-0">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-accent">Next up</span>
                        <p className="truncate text-xs font-semibold">
                          Lesson {nextLesson.order}: {nextLesson.title}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Recent activity */}
              {recentActivity.length > 0 && (
                <div className="mb-8">
                  <h2 className="mb-3 text-sm font-bold text-muted">Recent Activity</h2>
                  <div className="space-y-2">
                    {recentActivity.map((lp) => (
                      <button
                        key={lp.lessonId}
                        onClick={() => nav(`/learn/course/${lp.courseId}/lesson/${lp.lessonId}`)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border bg-panel/60 px-4 py-2.5 text-left transition hover:border-accent/30 hover:bg-panel"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elevated text-[11px] font-bold text-muted">
                          {lessonOrder(lp.lessonId)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{lessonTitle(lp.lessonId)}</p>
                          <p className="text-[10px] text-muted">
                            {lp.runCount} runs · {lp.attemptCount} attempts
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            lp.status === "completed"
                              ? "bg-green-500/15 text-green-400"
                              : "bg-accent/15 text-accent"
                          }`}>
                            {lp.status === "completed" ? "Done" : "In progress"}
                          </span>
                          <span className="text-[10px] text-faint">{timeAgo(lp.updatedAt)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Needs review */}
              {needsReview.length > 0 && (
                <div className="mb-8">
                  <h2 className="mb-3 text-sm font-bold text-muted">Might Need Review</h2>
                  <div className="rounded-lg border border-warn/20 bg-warn/5 p-3">
                    <p className="mb-2 text-[11px] text-warn/80">
                      These lessons took extra effort — revisiting them can strengthen your understanding.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {needsReview.map((lp) => (
                        <button
                          key={lp.lessonId}
                          onClick={() => nav(`/learn/course/${lp.courseId}/lesson/${lp.lessonId}`)}
                          className="flex items-center gap-1.5 rounded-md border border-warn/30 bg-bg/60 px-2.5 py-1 text-[11px] font-medium text-warn transition hover:bg-warn/10"
                        >
                          <span className="text-[10px] opacity-60">L{lessonOrder(lp.lessonId)}</span>
                          {lessonTitle(lp.lessonId)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Courses grid */}
              <h2 className="mb-4 text-sm font-bold text-muted">All Courses</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {courses.map(({ course, lessons }) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    progress={courseProgressMap[course.id] ?? null}
                    lessonCount={lessons.length}
                    onOpen={() => nav(`/learn/course/${course.id}`)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
