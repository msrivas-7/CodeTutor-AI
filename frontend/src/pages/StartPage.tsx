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
import {
  clearAnonStash,
  clearAnonWorkspace,
  readAnonStash,
  writeAnonStash,
} from "../features/anon/anonStash";
import { PENDING_INVITE_KEY } from "../features/anon/InviteCapture";
import { evalSamplingSubjectTokenForHandoff } from "../features/anon/evalSamplingConsent";
import { api } from "../api/client";

// Phase A — A2 (device contract): module-level cache to dedupe magic-link
// redemption across React 18 StrictMode's intentional double-mount in dev.
// The redeem call is single-use atomic on the server; without dedupe, the
// first mount's call returns 200 (and the row is consumed) while the
// second mount's call returns 410 INVITE_USED — clobbering the success
// path. Module-level Map keyed by token: both mounts call the same Promise,
// both .then receive the same response, the stash gets written twice (a
// no-op overwrite), and the handoff endpoint is itself idempotent (upserts
// lesson_progress). Bonus: a rapid back-button → forward sequence within
// the same tab also benefits from cache reuse.
const REDEMPTION_CACHE = new Map<
  string,
  Promise<{ code: string; name: string | null }>
>();
// Phase A — A2: read the pending invite token from sessionStorage,
// falling back to the `?invite=` URL param.
//
// The fallback matters in storage-restricted contexts (private-mode
// Safari, blocked third-party storage): InviteCapture can't persist the
// token there, so it deliberately leaves the param in the URL rather
// than stripping it. Without this fallback the only copy of a
// single-use, emailed token would be discarded and the phone→laptop
// handoff could never be redeemed.
function readPendingInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (stored) return stored;
  } catch {
    // Storage blocked — fall through to the URL.
  }
  try {
    return new URLSearchParams(window.location.search).get("invite");
  } catch {
    return null;
  }
}

function redeemOnce(token: string) {
  let p = REDEMPTION_CACHE.get(token);
  if (!p) {
    p = api.redeemAnonLaptopInvite(token);
    REDEMPTION_CACHE.set(token, p);
  }
  return p;
}

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
    // Phase A — A2: a pending laptop-invite token is also "handoff
    // needed" — the InviteCapture wrapper has stashed it in
    // sessionStorage; we must redeem it BEFORE letting the existing
    // welcomeDone gate bounce the user to /welcome (otherwise the
    // freshly-signed-up laptop learner replays the cinematic and
    // loses the lesson-1 carry-over). The pre-existing readAnonStash
    // path covers anon→authed signup; the new branch covers
    // phone→laptop graduation.
    if (readAnonStash()) return "needed";
    if (readPendingInvite()) return "needed";
    return "ok";
  });

  // Phase A — A2: invite redemption. Runs on mount when a token sits
  // in sessionStorage (placed there by InviteCapture). The redeem call
  // goes through `redeemOnce` (a module-level Promise cache keyed by
  // token), so React 18 StrictMode's intentional double-mount in dev
  // doesn't fire two redeem requests against a single-use server-side
  // token (the second would 410 INVITE_USED and strand the user).
  // Both mounts await the SAME Promise; both .then receive the same
  // response; both attempt the stash write + handoff (idempotent on
  // the server); both nav to lesson 2 (replace: true → second is a
  // no-op).
  //
  // The redeem .then drives postAnonHandoff inline (same shape as the
  // existing handoff effect below: timeout-raced call, optimistic
  // preferences-store patch, telemetry, nav). The two effects handle
  // disjoint cases:
  //  - this effect (token-in-sessionStorage): magic-link redemption →
  //    stash → handoff → nav.
  //  - existing effect (stash-but-no-token): pre-existing stash from
  //    the anon signup path → handoff → nav.
  // A single mount fires AT MOST ONE of the two paths; the other
  // bails at its synchronous early-out.
  //
  // Unauthed path: when an unauthenticated user opens the magic link,
  // RequireAuth redirects to /login BEFORE this page mounts (StartPage
  // is gated by AuthedLayout). So the redeem effect only fires once
  // the user is authed. The token survives the auth round-trip via
  // sessionStorage (InviteCapture stripped it from the URL on the
  // unauthed first visit, before RequireAuth's redirect). After
  // signup the user lands here authed, the token is still in
  // sessionStorage, this effect fires for the first time with a
  // valid session, and the chain completes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = readPendingInvite();
    if (!token) return;
    let cancelled = false;

    function clearPending() {
      try {
        window.sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        // Private-mode failure — fail-soft.
      }
      // Also strip `?invite=` when the token came from the URL (the
      // storage-blocked path), so a refresh doesn't retry a token the
      // server has already consumed and 410 the learner.
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has("invite")) {
          url.searchParams.delete("invite");
          window.history.replaceState({}, "", url.toString());
        }
      } catch {
        // Non-fatal — redemption already succeeded.
      }
    }

    redeemOnce(token)
      .then(async (res) => {
        // Write the stash UNCONDITIONALLY (do NOT gate on `cancelled`)
        // — the server has consumed the token; we must persist what
        // we got so a follow-up mount or refresh can finish the
        // chain. The cancel flag below only suppresses navigation
        // and the inline handoff call (those are React-lifecycle-
        // tied operations).
        clearPending();
        const flags = {
          // The phone learner already saw the cinematic + coach on
          // /try/. A returning laptop user shouldn't replay either.
          welcomeDone: true,
          workspaceCoachDone: true,
        };
        writeAnonStash({
          completedAt: new Date().toISOString(),
          courseId: "python-fundamentals",
          lessonId: "hello-world",
          code: res.code,
          name: res.name,
          flags,
        });

        if (cancelled) return;

        // Bridge the redeem into the handoff. If the handoff fails,
        // fall through to lesson 1 (same medium-lock as the anon-
        // signup handoff failure path) so the user is never stranded
        // on the loading shell.
        const timeoutMs = 8_000;
        const timeoutPromise = new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("handoff_timeout")), timeoutMs),
        );
        try {
          await Promise.race([
            api.postAnonHandoff({
              courseId: "python-fundamentals",
              lessonId: "hello-world",
              code: res.code,
              name: res.name,
              flags,
              evalSamplingSubjectToken: evalSamplingSubjectTokenForHandoff(),
            }),
            timeoutPromise,
          ]);
          if (cancelled) return;
          clearAnonStash();
          clearAnonWorkspace();
          usePreferencesStore.setState({
            welcomeDone: flags.welcomeDone,
            workspaceCoachDone: flags.workspaceCoachDone,
          });
          api.postFunnelEvent("anon_lesson2_reached");
          nav("/learn/course/python-fundamentals/lesson/variables", {
            replace: true,
          });
        } catch (err) {
          if (cancelled) return;
          // For ALL handoff failure modes — 401, timeout, 5xx — fall
          // back to lesson 1 with optimistic preferences-store patch.
          // Patching `welcomeDone: true` is essential — without it,
          // the StartPage `<Navigate to="/welcome" replace />` below
          // fires (welcomeDone=false bounces there) and Maya replays
          // the cinematic she just saw on /try/. The v1 audit
          // BLOCK SHIP'd on exactly that doubled-cinematic anti-
          // experience, so we patch unconditionally here. Worse case
          // on a 401 (already-signed-in race condition): Maya re-
          // completes lesson 1 — much smaller surface than the
          // cinematic replay. Note: we read err.status defensively
          // to catch the 401 case but treat all failures uniformly
          // for the preferences patch + nav.
          void (err as { status?: number })?.status;
          usePreferencesStore.setState({
            welcomeDone: true,
            workspaceCoachDone: true,
          });
          setHandoffPhase("failed");
          nav("/learn/course/python-fundamentals/lesson/hello-world", {
            replace: true,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Token was invalid / expired / already used. Clear the
        // sessionStorage entry so future visits don't keep retrying,
        // and unblock the loading shell — the user just sees the
        // dashboard rather than a graduation continuation.
        clearPending();
        if (!readAnonStash()) setHandoffPhase("ok");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stash = readAnonStash();
    if (!stash) return; // No stash → existing flow runs.
    let cancelled = false;
    // Phase 27-v2.2 audit fix (bug-hunter P2): timeout the handoff.
    // Pre-fix, /api/anon-handoff with a hung connection (slow proxy,
    // backgrounded mobile tab, dead-air CDN) left Maya stuck on the
    // "Carrying your work over…" loading shell indefinitely with no
    // recovery path. 8s is generous for a single-row UPSERT roundtrip
    // and well below user patience.
    const timeoutMs = 8_000;
    const timeoutPromise = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("handoff_timeout")), timeoutMs),
    );
    Promise.race([
      api.postAnonHandoff({
        courseId: stash.courseId,
        lessonId: stash.lessonId,
        code: stash.code,
        name: stash.name,
        flags: stash.flags,
        evalSamplingSubjectToken: evalSamplingSubjectTokenForHandoff(),
      }),
      timeoutPromise,
    ])
      .then(() => {
        if (cancelled) return;
        clearAnonStash();
        clearAnonWorkspace();
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
    // Phase 27-v2.2 audit fix (product-owner P2-3): the loading shell
    // is the first thing Maya sees as a signed-up user. The wall's
    // promise ("Your code, your name, and the lesson you just
    // finished come with you") deserves a continuation here, not a
    // bare label. Two-line shell: action ("Carrying…") + named
    // continuity ("your code, your name, lesson 1").
    return (
      <div className="flex h-full items-center justify-center bg-bg text-muted">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-base text-ink">Carrying your work over…</div>
          <div className="text-sm text-faint">
            Your code, your name, and lesson 1 are coming with you.
          </div>
        </div>
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
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10">
        <div className="absolute left-4 sm:left-1/2 sm:-translate-x-1/2">
          <div className="pointer-events-auto"><StreakChip /></div>
        </div>
        <div className="pointer-events-auto absolute right-4 flex items-center gap-2">
          <span className="hidden sm:inline-flex"><FeedbackButton /></span>
          <UserMenu />
        </div>
      </div>
      <StaggerReveal className="flex flex-1 flex-col items-center justify-center px-5 pb-8 pt-20 sm:px-6 sm:pt-0">
        <StaggerItem>
          <div ref={headerRef} className="mb-10 flex flex-col items-center gap-4">
            <Wordmark size="hero" className="text-[38px] sm:text-[48px]" />
            <p className="max-w-lg text-center text-base leading-relaxed text-muted sm:text-[15px]">
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


        <StaggerItem className="grid w-full max-w-2xl gap-4">
          <motion.button
            ref={guidedRef}
            onClick={() => nav("/learn")}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group relative flex min-h-44 flex-col items-start gap-4 overflow-hidden rounded-2xl border border-violet/45 bg-gradient-to-br from-violet/15 via-panel to-accent/10 p-6 text-left shadow-soft transition-[border-color,box-shadow] hover:border-violet/70 hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-violet sm:p-8"
          >
            <div className="absolute right-5 top-5 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-meta font-semibold uppercase tracking-wider text-violet">
              Recommended
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet/15 text-violet transition group-hover:bg-violet/25">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">Continue learning</h2>
              <p className="mt-2 max-w-xl text-base leading-relaxed text-muted sm:text-body">
                Follow a structured path, write real code, and get lesson-aware guidance that
                helps you understand each step.
              </p>
            </div>
            <span className="mt-auto text-sm font-semibold text-violet">
              View guided courses →
            </span>
          </motion.button>

          <motion.button
            ref={editorRef}
            onClick={() => nav("/editor")}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="group flex min-h-24 items-center gap-4 rounded-xl border border-border bg-panel/75 p-5 text-left shadow-sm transition-[border-color,background-color] hover:border-accent/45 hover:bg-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Open the playground</h2>
              <p className="mt-1 text-base leading-relaxed text-muted sm:text-body">
                Use the free-form nine-language editor when you already know what you want to build.
              </p>
            </div>
            <span className="shrink-0 text-lg text-accent" aria-hidden="true">→</span>
          </motion.button>
        </StaggerItem>
      </StaggerReveal>

      <footer className="border-t border-border bg-panel/60 px-4 py-2 text-center text-[10px] text-faint">
        CodeTutor AI © 2026 Mehul Srivastava — All rights reserved
      </footer>

    </div>
  );
}
