import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion"; // still used on the landing cards
import { UserMenu } from "../components/UserMenu";
import { FeedbackButton } from "../components/FeedbackButton";
import { AmbientGlyphField } from "../components/AmbientGlyphField";
import { StaggerReveal, StaggerItem } from "../components/StaggerReveal";
import { Wordmark } from "../components/Wordmark";
import { usePreferencesStore } from "../state/preferencesStore";
import { useProgressStore } from "../features/learning/stores/progressStore";
import { listPublicCourses, loadAllLessonMetas } from "../features/learning/content/courseLoader";
import { ResumeLearningCard } from "../features/learning/components/ResumeLearningCard";
import { StreakChip } from "../features/learning/components/StreakChip";
import type { Course, CourseProgress, LessonMeta } from "../features/learning/types";
import { clearAnonStash, readAnonStash } from "../features/anon/anonStash";
import { api } from "../api/client";

interface ResumeTarget {
  course: Course;
  progress: CourseProgress;
  nextLesson: LessonMeta | null;
  totalLessons: number;
}

export default function StartPage() {
  const nav = useNavigate();
  const welcomeDone = usePreferencesStore((s) => s.welcomeDone);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const courseProgressMap = useProgressStore((s) => s.courseProgress);
  const progressHydrated = useProgressStore((s) => s.hydrated);

  // Phase 27-v2 Day 4a: anon→authed handoff intercept. SignupPage
  // and AuthCallbackPage both land authed users at /start. If a
  // freshly-signed-up user has a sessionStorage stash from the
  // /try/ flow (Day 3c writes it on the celebration's Sign Up CTA),
  // we redeem it BEFORE StartPage's existing welcomeDone gate
  // bounces them to /welcome — otherwise Maya would replay the
  // cinematic she just dismissed and redo lesson 1 she just
  // completed. The handoff endpoint idempotently:
  //   - marks lesson 1 done in lesson_progress (status=completed,
  //     completed_at=now, last_code={"main.py": user's code})
  //   - upserts course_progress (in_progress, completedLessonIds)
  //   - sets welcome_done + workspace_coach_done on user_preferences
  //     per the honest flags the stash carries
  // We then route her to lesson 2 directly. Maya's signup-form
  // firstName remains the source of truth for the lesson-2 tutor's
  // "Hey {name}" — the stash.name is informational, not persisted
  // server-side (would require Supabase auth admin API). The local
  // preferences store is also patched optimistically so a later
  // /start visit in-session doesn't re-trip the welcome redirect
  // before HydrationGate's next pull.
  //
  // Captured ONCE at first render via useState's initializer so the
  // welcomeDone gate below can hold the /welcome redirect while the
  // POST is in flight. If no stash, phase starts at "ok" and the
  // existing flow runs unchanged. The effect runs ONCE on mount —
  // we don't depend on handoffPhase or call setHandoffPhase mid-
  // effect, since that would tear down the cleanup (cancelled=true)
  // and the .then handler would skip the nav, leaving the user
  // stuck on the loading shell forever.
  const [handoffPhase, setHandoffPhase] = useState<
    "needed" | "ok" | "failed"
  >(() => {
    return readAnonStash() ? "needed" : "ok";
  });

  useEffect(() => {
    const stash = readAnonStash();
    if (!stash) return; // No stash → existing flow runs.
    let cancelled = false;
    api
      .postAnonHandoff({
        courseId: stash.courseId,
        lessonId: stash.lessonId,
        code: stash.code,
        name: stash.name,
        flags: stash.flags,
      })
      .then(() => {
        if (cancelled) return;
        clearAnonStash();
        // Patch the local preferences store BEFORE the nav so a
        // subsequent /start visit in the same session (e.g., via
        // LearningDashboardPage's ← Home) doesn't see stale
        // welcomeDone=false and bounce to /welcome — that would
        // resurrect the doubled-cinematic anti-experience the v1
        // audit BLOCK SHIP'd on. setState is sync; the next render
        // sees the new value.
        usePreferencesStore.setState({
          welcomeDone: stash.flags.welcomeDone,
          workspaceCoachDone: stash.flags.workspaceCoachDone,
        });
        // Phase 27-v2.2 Fix 6 — funnel telemetry: anon_lesson2_reached
        // fires on the success branch of the handoff. This is the
        // load-bearing conversion event — Maya signed up AND landed on
        // lesson 2 with state preserved. Before nav so even a slow
        // route transition doesn't lose the event. Fire-and-forget.
        api.postFunnelEvent("anon_lesson2_reached");
        // Lesson 2 of python-fundamentals is "variables".
        // replace:true so back-button doesn't re-summon /start
        // → handoff path again.
        nav(
          "/learn/course/python-fundamentals/lesson/variables",
          { replace: true },
        );
      })
      .catch(() => {
        // Phase 27-v2.2 audit fix B2 (fresh-eyes): handoff failure must
        // NOT fall through to /welcome (welcomeDone=false bounces there
        // via the standard auth flow). That replays the cinematic Maya
        // just dismissed on /try/, hitting the doubled-cinematic anti-
        // experience the v1 audit BLOCK SHIP'd on. Patch local prefs
        // optimistically (Maya already saw the cinematic + coach on
        // anon, so welcomeDone=true / workspaceCoachDone=true is what
        // her client-side state should be) and route directly to the
        // lesson she was on. Stash stays in sessionStorage so a refresh
        // can retry the handoff; the server PATCH eventually catches up
        // on next sign-in regardless. Worse case: Maya re-completes
        // lesson 1 — that's a much smaller surface than the cinematic
        // replay.
        if (cancelled) return;
        usePreferencesStore.setState({
          welcomeDone: true,
          workspaceCoachDone: true,
        });
        setHandoffPhase("failed");
        nav(
          "/learn/course/python-fundamentals/lesson/hello-world",
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
    // Empty deps: effect runs once per mount. The phase state
    // transitions are driven only by the success/failure callbacks
    // above, NOT by re-running the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hooks must run in stable order across every render — this entire
  // function does ALL hook calls before any of the conditional
  // returns below. The Day-4 handoff added a "carrying your work
  // over…" early-return that, paired with the existing welcomeDone
  // <Navigate>, used to skip the resume-card hooks on the first
  // render and run them on the second — a Rules-of-Hooks violation
  // that crashes "Rendered more hooks than during the previous
  // render" on the failure path. Hoisting all hooks here means
  // every render runs them, and the conditional returns at the end
  // of the function only switch which JSX comes back.
  const headerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLButtonElement>(null);
  const guidedRef = useRef<HTMLButtonElement>(null);

  // Pick the most-recently-updated in-progress course id from the
  // already-hydrated progress store. HydrationGate guarantees this map
  // is populated before StartPage renders.
  //
  // Critical: skip BOTH `completed` AND `not_started`. Per the comment
  // in LearningDashboardPage:58-66, `loadCourseProgress` writes a
  // fresh `updatedAt: now()` into the store even for not-started rows
  // — so without the not_started filter, a course the learner has
  // never touched but which simply hydrated more recently would win
  // the resume slot. The bug observable is "Resume Course X" showing
  // a course you've never started, with 0/N done.
  const resumeCourseId = useMemo(() => {
    let bestId: string | null = null;
    let bestTs = 0;
    for (const [id, p] of Object.entries(courseProgressMap)) {
      if (!p) continue;
      if (p.status === "completed" || p.status === "not_started") continue;
      if (!p.updatedAt) continue;
      const t = new Date(p.updatedAt).getTime();
      if (!Number.isFinite(t)) continue;
      if (t > bestTs) {
        bestTs = t;
        bestId = id;
      }
    }
    return bestId;
  }, [courseProgressMap]);

  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);
  useEffect(() => {
    if (!resumeCourseId) {
      setResumeTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [courses, lessons] = await Promise.all([
          listPublicCourses(),
          loadAllLessonMetas(resumeCourseId),
        ]);
        if (cancelled) return;
        const course = courses.find((c) => c.id === resumeCourseId);
        const progress = courseProgressMap[resumeCourseId];
        if (!course || !progress) {
          setResumeTarget(null);
          return;
        }
        const nextLesson =
          lessons.find((l) => !progress.completedLessonIds.includes(l.id)) ??
          null;
        setResumeTarget({
          course,
          progress,
          nextLesson,
          totalLessons: lessons.length,
        });
      } catch {
        if (!cancelled) setResumeTarget(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeCourseId, courseProgressMap]);

  // ───────────── Conditional returns (no hooks below this line) ─────────────

  // Phase 27-v2 Day 4a: while the anon→authed handoff is in flight,
  // hold ALL of StartPage's existing routing — including the
  // welcomeDone redirect to /welcome. The user sees a brief loading
  // shell so they don't catch a flash of the dashboard or the
  // cinematic mid-handoff. ~1 round-trip is typically sub-300ms on
  // dev/prod; the loading shell itself is cheap so the visible
  // delay is dominated by the network call. Copy reinforces the
  // "your work is being carried over" promise the celebration block
  // + wall just made.
  if (handoffPhase === "needed") {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-muted">
        <div className="text-[13px]">Carrying your work over…</div>
      </div>
    );
  }

  // Redirect any learner with welcomeDone=false into the /welcome
  // cinematic BEFORE StartPage's card grid paints. This must happen
  // synchronously during render — an earlier version ran the nav
  // inside a useEffect, which fired *after* commit, so the dashboard
  // briefly flashed between AuthLoader dissolving and the cinematic
  // mounting. `<Navigate>` resolves in the same render cycle: React
  // Router processes it before any DOM is committed, so StartPage
  // never paints for a first-run user.
  //
  // Wait for BOTH stores to hydrate first — a returning user on a
  // flaky connection whose welcomeDone is `true` server-side but
  // still `false` in the local default would otherwise get ambushed
  // by the cinematic for a frame before rehydration corrects the
  // flag.
  if (prefsHydrated && progressHydrated && !welcomeDone) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <div className="relative flex h-full flex-col bg-bg text-ink">
      <AmbientGlyphField />
      {/* Phase 21B (iter-3): top toolbar — streak chip absolute-anchored
          to viewport centre; Feedback + UserMenu cluster anchors right.
          Identical positioning to LessonPage / CourseOverview / EditorPage
          headers so the chip lands in the exact same screen position no
          matter which page the learner is on. */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10">
        <div className="absolute left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto"><StreakChip /></div>
        </div>
        <div className="pointer-events-auto absolute right-4 flex items-center gap-2">
          <FeedbackButton />
          <UserMenu />
        </div>
      </div>
      <StaggerReveal className="flex flex-1 flex-col items-center justify-center px-6">
        <StaggerItem>
          <div ref={headerRef} className="mb-10 flex flex-col items-center gap-4">
            <Wordmark size="hero" />
            <p className="max-w-lg text-center text-[15px] leading-relaxed text-muted">
              Learn to code with a tutor who has all day for you. Write real
              Python, JavaScript, or Go in your browser — run it in a sandbox,
              ask questions, build understanding.
            </p>
          </div>
        </StaggerItem>

        {resumeTarget && resumeTarget.nextLesson && (
          <StaggerItem className="mb-6 w-full max-w-2xl">
            <ResumeLearningCard
              courseTitle={resumeTarget.course.title}
              progress={resumeTarget.progress}
              nextLesson={resumeTarget.nextLesson}
              totalLessons={resumeTarget.totalLessons}
              onResume={() =>
                nav(
                  `/learn/course/${resumeTarget.course.id}/lesson/${resumeTarget.nextLesson!.id}`,
                )
              }
            />
          </StaggerItem>
        )}


        <StaggerItem className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <motion.button
            ref={editorRef}
            onClick={() => nav("/editor")}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left shadow-sm transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent transition group-hover:bg-accent/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Open Editor</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Free-form coding workspace with 9 languages, sandboxed
                execution, and AI-powered help.
              </p>
            </div>
            <span className="mt-auto text-[11px] font-medium text-accent transition sm:opacity-0 sm:group-hover:opacity-100">
              Launch editor →
            </span>
          </motion.button>

          <motion.button
            ref={guidedRef}
            onClick={() => nav("/learn")}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-panel p-6 text-left shadow-sm transition-[border-color,box-shadow] hover:border-violet/50 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/10 text-violet transition group-hover:bg-violet/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Guided Course</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Structured Python and JavaScript lessons for beginners. Track
                your progress and get lesson-aware AI guidance.
              </p>
            </div>
            <span className="mt-auto text-[11px] font-medium text-violet transition sm:opacity-0 sm:group-hover:opacity-100">
              Start learning →
            </span>
          </motion.button>
        </StaggerItem>
      </StaggerReveal>

      <footer className="border-t border-border bg-panel/60 px-4 py-2 text-center text-[10px] text-faint">
        CodeTutor AI © 2026 Mehul Srivastava — All rights reserved
      </footer>

    </div>
  );
}
