import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Course, LessonMeta, LessonProgress, CourseProgress } from "../types";
import {
  listPublicCourses,
  loadAllLessonMetas,
  isCourseCompleted,
} from "../content/courseLoader";
import { useProgressStore, loadAllLessonProgress } from "../stores/progressStore";
import { useAuthStore } from "../../../auth/authStore";
import { CourseCard } from "../components/CourseCard";
import { CurriculumMap } from "../components/CurriculumMap";
import { CoursePrereqWarningModal } from "../components/CoursePrereqWarningModal";
import { ProgressRing } from "../components/ProgressRing";
import { StaggerReveal, StaggerItem } from "../../../components/StaggerReveal";
import { UserMenu } from "../../../components/UserMenu";
import { FeedbackButton } from "../../../components/FeedbackButton";
import { StreakChip } from "../components/StreakChip";
import { Wordmark } from "../../../components/Wordmark";
import { pickShakyLessons, formatTimeSpent } from "../utils/mastery";

interface CourseData {
  course: Course;
  lessons: LessonMeta[];
}

export default function LearningDashboardPage() {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const learnerId = user!.id;
  const loadCourseProgress = useProgressStore((s) => s.loadCourseProgress);
  const courseProgressMap = useProgressStore((s) => s.courseProgress);

  const [courses, setCourses] = useState<CourseData[]>([]);
  const [allLessonProgress, setAllLessonProgress] = useState<LessonProgress[]>([]);
  const [loading, setLoading] = useState(true);
  // Phase 22F2A — B6: prereq-warning modal state. Holds the (target, prereq)
  // pair when the learner clicks a course with unmet prerequisites. The
  // modal is purely advisory — `Continue` still routes into the target.
  const [prereqWarning, setPrereqWarning] = useState<{
    target: Course;
    prereq: Course;
  } | null>(null);

  useEffect(() => {
    listPublicCourses()
      .then(async (publicCourses) => {
        const data = await Promise.all(
          publicCourses.map(async (course) => {
            const lessons = await loadAllLessonMetas(course.id);
            loadCourseProgress(learnerId, course.id);
            return { course, lessons };
          }),
        );
        setCourses(data);
        const lps: LessonProgress[] = [];
        for (const { course } of data) {
          lps.push(...loadAllLessonProgress(course.id, course.lessonOrder));
        }
        setAllLessonProgress(lps);
      })
      .finally(() => setLoading(false));
  }, [learnerId, loadCourseProgress]);

  // Pick the course the learner most recently touched. Before: `courses[0]`
  // silently pinned the dashboard to Python even for learners who were deep
  // into JavaScript. Sort by courseProgress.updatedAt desc; untouched courses
  // fall to the end and we fall back to `courses[0]` only when nobody has
  // started anything.
  //
  // `loadCourseProgress` writes a fresh `updatedAt: now()` into the store even
  // for "not_started" rows, so raw updatedAt alone can't distinguish touched
  // from untouched — whichever course hydrated last wins. Gate the timestamp
  // on `status !== "not_started"` so untouched courses genuinely return 0.
  const activeCourse = useMemo(() => {
    if (courses.length === 0) return null;
    const ts = (id: string): number => {
      const p = courseProgressMap[id];
      if (!p?.updatedAt || p.status === "not_started") return 0;
      const t = new Date(p.updatedAt).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    return [...courses].sort((a, b) => ts(b.course.id) - ts(a.course.id))[0];
  }, [courses, courseProgressMap]);
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

  const shakyLessons = useMemo(() => {
    const metasById: Record<string, LessonMeta> = {};
    for (const { lessons } of courses) {
      for (const m of lessons) metasById[m.id] = m;
    }
    return pickShakyLessons(allLessonProgress, metasById, 3);
  }, [allLessonProgress, courses]);

  const completedCount = activeProgress?.completedLessonIds.length ?? 0;
  const totalCount = activeCourse?.lessons.length ?? 0;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Phase 22F2A — B6: course-card click resolver. Walks the target course's
  // `prerequisiteCourseIds` (in declaration order), returns the FIRST one
  // whose lessons aren't all completed by this learner. Returns null when
  // every prereq is satisfied (or there are none) — that's the green-light
  // "navigate immediately" path.
  function firstUnmetPrereq(target: Course): Course | null {
    const ids = target.prerequisiteCourseIds ?? [];
    if (ids.length === 0) return null;
    for (const id of ids) {
      const data = courses.find((c) => c.course.id === id);
      if (!data) continue; // unknown id — content-lint catches; UI tolerant
      const completed = courseProgressMap[id]?.completedLessonIds ?? [];
      if (!isCourseCompleted(data.course, completed)) {
        return data.course;
      }
    }
    return null;
  }

  function handleCourseOpen(target: Course) {
    const unmet = firstUnmetPrereq(target);
    if (unmet) {
      setPrereqWarning({ target, prereq: unmet });
      return;
    }
    nav(`/learn/course/${target.id}`);
  }

  function lessonMeta(courseId: string, lessonId: string): LessonMeta | undefined {
    return courses
      .find(({ course }) => course.id === courseId)
      ?.lessons.find((lesson) => lesson.id === lessonId);
  }

  function lessonTitle(courseId: string, lessonId: string): string {
    const meta = lessonMeta(courseId, lessonId);
    return meta?.title ?? lessonId;
  }

  function lessonOrder(courseId: string, lessonId: string): number | null {
    const meta = lessonMeta(courseId, lessonId);
    return meta?.order ?? null;
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
    <div className="relative flex h-full flex-col bg-bg text-ink">
      <header className="relative z-20 flex items-center gap-3 border-b border-border bg-panel/80 px-4 py-2 backdrop-blur">
        <button
          onClick={() => nav("/start")}
          className="rounded px-2 py-1 text-xs text-muted transition hover:bg-elevated hover:text-ink"
        >
          ← Home
        </button>
        <Wordmark size="sm" />
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <h1 className="text-[14px] font-medium tracking-tight text-ink">Guided Learning</h1>
        {/* Phase 21B (iter-3): streak chip absolute-anchored to header
            centre — same global position as every other major page. */}
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto"><StreakChip /></div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <FeedbackButton />
          <UserMenu />
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {loading ? (
            <div
              role="status"
              aria-label="Loading courses and progress"
              aria-live="polite"
              className="flex flex-col gap-6"
            >
              <span className="sr-only">Loading…</span>
              {/* Progress-summary placeholder */}
              <div className="rounded-xl border border-border bg-panel p-5">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <span className="skeleton h-4 w-40 rounded" />
                  <span className="skeleton h-3 w-16 rounded" />
                </div>
                <span className="skeleton block h-2 w-full rounded-full" />
                <div className="mt-4 flex gap-2">
                  <span className="skeleton h-8 w-28 rounded-lg" />
                  <span className="skeleton h-8 w-24 rounded-lg" />
                </div>
              </div>
              {/* Course card placeholders */}
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-panel p-5"
                  aria-hidden="true"
                >
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <span className="skeleton h-4 w-48 rounded" />
                    <span className="skeleton h-3 w-12 rounded" />
                  </div>
                  <span className="skeleton block h-3 w-5/6 rounded" />
                  <span className="skeleton mt-2 block h-3 w-3/4 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <StaggerReveal>
              {/* Phase 27: Resume-where-you-left-off banner. Renders at the
                  TOP of the dashboard for in-progress users so a returning
                  learner has a single-click path back to their lesson
                  without scanning the progress card or the course list.
                  Hidden when:
                   - course is not_started (welcome card takes this slot)
                   - course is completed (no nextLesson to jump to)
                  When visible, it sits ABOVE the progress card — banner is
                  the fast action, card stays as the context view. */}
              {nextLesson && activeCourse && activeProgress &&
               activeProgress.status === "in_progress" && (
                <StaggerItem className="mb-6">
                  <button
                    onClick={() =>
                      nav(
                        `/learn/course/${activeCourse.course.id}/lesson/${nextLesson.id}`,
                      )
                    }
                    className="group w-full rounded-xl border border-accent/40 bg-gradient-to-r from-accent/10 via-violet/10 to-accent/5 px-5 py-4 text-left transition hover:from-accent/15 hover:via-violet/15 hover:to-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    aria-label={`Pick up where you left off — Lesson ${nextLesson.order}: ${nextLesson.title}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-accent">
                          Pick up where you left off
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold text-ink">
                          Lesson {nextLesson.order}: {nextLesson.title}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium text-accent transition group-hover:translate-x-0.5">
                        Continue →
                      </span>
                    </div>
                  </button>
                </StaggerItem>
              )}

              {/* First-visit welcome — shown when no course has been started */}
              {activeCourse && (!activeProgress || activeProgress.status === "not_started") && (
                <StaggerItem className="mb-8 rounded-xl border border-border bg-panel p-6">
                  <div className="flex items-start gap-4">
                    <div>
                      <h2 className="text-[18px] font-semibold tracking-tight text-ink">Ready to start coding?</h2>
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
                </StaggerItem>
              )}

              {/* Progress summary + next lesson CTA */}
              {activeCourse && activeProgress && activeProgress.status !== "not_started" && (
                <StaggerItem className="mb-8 rounded-xl border border-border bg-panel p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <ProgressRing
                        pct={pct}
                        size={64}
                        label={`${pct}% of ${activeCourse.course.title} complete`}
                      />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-bold">{activeCourse.course.title}</h2>
                        <p className="mt-1 text-sm text-muted">
                          {activeProgress.status === "completed" ? (
                            <>You completed all {totalCount} lessons!</>
                          ) : (
                            <>You've completed <span className="font-semibold text-ink">{completedCount}</span> of {totalCount} lessons</>
                          )}
                        </p>
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
                </StaggerItem>
              )}

              {/* Phase A — A7: curriculum map. The whole journey at a
                  glance — every course a row, every lesson a node. Sits
                  between "what's next" (cards above) and "what happened"
                  (activity below): present, past, and the whole road. */}
              <StaggerItem className="mb-8">
                <CurriculumMap
                  courses={courses}
                  courseProgressMap={courseProgressMap}
                  onOpenLesson={(cId, lId) =>
                    nav(`/learn/course/${cId}/lesson/${lId}`)
                  }
                />
              </StaggerItem>

              {/* Recent activity — inner StaggerReveal so each row
                  cascades in sequence instead of the whole block popping
                  as one. Kicks off once the outer stagger reaches this
                  section (framer variants propagate through the tree). */}
              {recentActivity.length > 0 && (
                <StaggerItem className="mb-8">
                  <h2 className="mb-3 text-sm font-bold text-muted">Recent Activity</h2>
                  <StaggerReveal nested className="space-y-2">
                    {recentActivity.map((lp) => (
                      <StaggerItem
                        key={lp.lessonId}
                        className="flex w-full"
                      >
                      <button
                        onClick={() => nav(`/learn/course/${lp.courseId}/lesson/${lp.lessonId}`)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border bg-panel/60 px-4 py-2.5 text-left transition hover:border-accent/30 hover:bg-panel"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-elevated text-[11px] font-bold text-muted">
                          {lessonOrder(lp.courseId, lp.lessonId) ?? "—"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">
                            {lessonTitle(lp.courseId, lp.lessonId)}
                          </p>
                          <p className="text-[10px] text-muted">
                            {lp.runCount} {lp.runCount === 1 ? "run" : "runs"} · {lp.attemptCount} {lp.attemptCount === 1 ? "attempt" : "attempts"}
                            {typeof lp.timeSpentMs === "number" && lp.timeSpentMs > 0
                              ? <> · {formatTimeSpent(lp.timeSpentMs)}</>
                              : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            lp.status === "completed"
                              ? "bg-success/15 text-success"
                              : "bg-accent/15 text-accent"
                          }`}>
                            {lp.status === "completed" ? "Done" : "In progress"}
                          </span>
                          <span className="text-[10px] text-faint">{timeAgo(lp.updatedAt)}</span>
                        </div>
                      </button>
                      </StaggerItem>
                    ))}
                  </StaggerReveal>
                </StaggerItem>
              )}

              {/* Cinema Kit — reframed from "Might Need Review" (warn-
                  yellow, diagnostic) to "Lessons Worth a Second Pass"
                  (violet, invitation). The violet here isn't random —
                  it's the same fill-light hue from the cinematic's
                  three-point rig. Mastery data is the same; the
                  framing says "growth," not "damage control." */}
              {shakyLessons.length > 0 && (
                <StaggerItem className="mb-8">
                  <h2 className="mb-3 text-sm font-bold text-muted">
                    Lessons Worth a Second Pass
                  </h2>
                  <div className="rounded-xl border border-violet/25 bg-violet/5 p-4">
                    <p className="mb-3 text-[11px] leading-relaxed text-violet/85">
                      These ones took more passes. Worth sitting with again — the second read usually clicks.
                    </p>
                    <div className="space-y-2">
                      {shakyLessons.map((s) => {
                        const priority = s.score >= 3 ? "high" : "medium";
                        return (
                          <div
                            key={s.lessonId}
                            className="flex items-center gap-3 rounded-lg border border-violet/20 bg-bg/40 px-3 py-2.5"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet/15 text-[11px] font-bold text-violet">
                              {s.meta.order}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-xs font-semibold text-ink">{s.meta.title}</p>
                                <span
                                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                    priority === "high"
                                      ? "bg-violet/25 text-violet"
                                      : "bg-violet/15 text-violet/80"
                                  }`}
                                  title={priority === "high" ? "Multiple signals suggest revisiting now" : "Some signals suggest a quick revisit"}
                                >
                                  {priority === "high" ? "Priority" : "Suggested"}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {s.reasons.map((r, i) => (
                                  <span
                                    key={i}
                                    className="rounded-full border border-violet/20 bg-violet/10 px-2 py-0.5 text-[10px] font-medium text-violet/90"
                                  >
                                    {r}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => nav(`/learn/course/${s.courseId}/lesson/${s.lessonId}`)}
                              className="shrink-0 rounded-md bg-violet/15 px-3 py-1.5 text-[11px] font-semibold text-violet transition hover:bg-violet/25"
                              aria-label={`Revisit lesson ${s.meta.order}: ${s.meta.title}`}
                            >
                              Revisit →
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </StaggerItem>
              )}

              {/* Courses grid — nested StaggerReveal so each course card
                  cascades in turn. Keeps the "All Courses" heading on
                  its own beat, then the grid fills cell by cell. */}
              <StaggerItem>
                <h2 className="mb-4 text-sm font-bold text-muted">All Courses</h2>
                {courses.length === 0 ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-border bg-panel p-6 text-center"
                  >
                    <p className="text-sm font-semibold text-ink">No courses available yet</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                      Something went wrong loading the course catalog. Reload the page,
                      or check your internet connection if this keeps happening.
                    </p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-bg transition hover:bg-accent/90"
                    >
                      Reload
                    </button>
                  </div>
                ) : (
                  <StaggerReveal nested className="grid gap-4 sm:grid-cols-2">
                    {courses.map(({ course, lessons }) => (
                      <StaggerItem key={course.id}>
                        <CourseCard
                          course={course}
                          progress={courseProgressMap[course.id] ?? null}
                          lessonCount={lessons.length}
                          onOpen={() => handleCourseOpen(course)}
                        />
                      </StaggerItem>
                    ))}
                  </StaggerReveal>
                )}
              </StaggerItem>
            </StaggerReveal>
          )}
        </div>
      </div>
      {prereqWarning && (
        <CoursePrereqWarningModal
          targetCourseTitle={prereqWarning.target.title}
          prereqCourseTitle={prereqWarning.prereq.title}
          onClose={() => setPrereqWarning(null)}
          onContinue={() => {
            const t = prereqWarning.target;
            setPrereqWarning(null);
            nav(`/learn/course/${t.id}`);
          }}
          onGoToPrereq={() => {
            const p = prereqWarning.prereq;
            setPrereqWarning(null);
            nav(`/learn/course/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
