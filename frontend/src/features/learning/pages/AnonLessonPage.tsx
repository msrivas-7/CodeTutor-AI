import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import LessonPage, { type AnonSharePayload } from "./LessonPage";
import { CinematicGreeting } from "../../firstRun/CinematicGreeting";
import { SignupWallDialog, type SignupWallReason } from "../components/SignupWallDialog";
import { PhoneGraduationDialog } from "../components/PhoneGraduationDialog";
import { AnonShareDialog } from "../components/AnonShareDialog";
import { useProjectStore } from "../../../state/projectStore";
import { useAuthStore } from "../../../auth/authStore";
import { api } from "../../../api/client";
import { usePhoneFormFactor } from "../../../util/layoutPrefs";
import {
  extractNameFromCode,
  hasCinematicSeen,
  markCinematicSeen,
  readAnonWorkspace,
  readAnonStash,
  writeAnonStash,
} from "../../anon/anonStash";

// Phase 27-v2.1 Part 3 — anonymous lesson 1 page becomes a thin wrapper.
//
// Loaded at /try/lesson/:courseId/:lessonId, OUTSIDE the AuthedLayout
// guard. Hard-locked to python-fundamentals/hello-world via the
// allowlist below — any other (courseId, lessonId) pair redirects
// home so a future signed-out marketing post-Maya audience can't
// stumble into a lesson the backend allowlist would 403 anyway.
//
// What this wrapper owns:
//   - Allowlist guard (redirect to / if not python-fundamentals/hello-world)
//   - First-run CinematicGreeting (anon variant — "Your turn." hero,
//     output-preview placeholder pulse, left-aligned, cursor-into-slot,
//     no support line). Same component the authed /welcome page uses;
//     just different prop strings. sessionStorage flag prevents replay.
//   - SignupWallDialog mount + state (open/reason). Opened by the
//     onAnonSave / onAnonNext callbacks LessonPage(mode="anon") fires.
//   - sessionStorage stash on Next-lesson click. Carries (code, name,
//     completion flags) into the post-signup handoff endpoint so the
//     user lands on lesson 2 with state preserved.
// What LessonPage(mode="anon") owns (the entire visible workspace):
//   - Lesson load (loadFullLesson into projectStore)
//   - Monaco editor + Run button + output panel + Check button
//   - GuidedTutorPanel (routes AI stream to /api/anon/ai/ask/stream)
//   - useFirstRunChoreography scripted walkthrough (greet → awaitRun →
//     celebrateRun → awaitEdit → praiseEditRun → awaitCheck → seed)
//   - LessonCompletePanel celebration on Check pass (confetti + share +
//     mastery + practice + Next CTA — "Sign up to keep going" via the
//     onAnonNext callback we provide here)
//   - FirstRunHandoffReveal iris reveal ("circle opening up") triggered
//     by the cinematic's exit flag (Welcome-scene parity Fix B)
//   - Anon header bar ("Try it — no signup" badge + "Sign up to save"
//     button calling onAnonSave) replacing UserMenu + StreakChip
//
// The visible chrome below the header bar is pixel-identical to the
// authed lesson page — that's the v2.1 invariant. Maya's trial IS the
// product, not a lookalike.

const ANON_ALLOWED = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
} as const;

export default function AnonLessonPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const authLoading = useAuthStore((state) => state.loading);
  const user = useAuthStore((state) => state.user);
  const allowed =
    courseId === ANON_ALLOWED.courseId && lessonId === ANON_ALLOWED.lessonId;
  const initialWorkspaceRef = useRef(readAnonWorkspace());
  const blockedTitleRef = useRef<HTMLHeadingElement>(null);

  // Cinematic — anon variant. Plays once per browser tab; reload mid-
  // lesson does NOT replay (sessionStorage flag).
  const [showCinematic, setShowCinematic] = useState(() => !hasCinematicSeen());
  const dismissCinematic = () => {
    markCinematicSeen();
    setShowCinematic(false);
    // DO NOT clear cinematicExitingAt — the underlying LessonPage
    // (mode="anon") needs the flag to fire its iris reveal ("circle
    // opening up") via the reactive useEffect subscriber. Welcome-scene
    // parity Fix C from v2.1: the v2 Day 2 defensive clear was over-
    // cautious AND it broke the anon iris-reveal continuity. The 1.5s
    // freshness window in LessonPage's inHandoff useEffect is the
    // load-bearing defense against any post-signup leak.
  };

  // SignupWallDialog state. LessonPage(mode="anon") fires the open via
  // onAnonSave (header "Sign up to save" pill, hint exhaustion) and
  // onAnonNext (LessonCompletePanel "Next lesson" CTA after Check pass).
  const [wall, setWall] = useState<{
    open: boolean;
    reason: SignupWallReason;
    initialFirstName?: string;
  }>({
    open: false,
    reason: "save",
  });

  // Phase A — A2 (device contract): on phone form-factor, the Next-Lesson
  // CTA opens the warm graduation handoff dialog INSTEAD of the wall —
  // the honest answer to "lesson 2 needs more screen" is "let's get
  // you to a laptop", not "sign up." Save / exhausted / share / trial-
  // paused all stay on the wall path on phone (those are conversion
  // asks, not continuity bridges). On desktop, every path stays on
  // the wall — the device-contract dialog is phone-only.
  const isPhone = usePhoneFormFactor();
  const [graduation, setGraduation] = useState<{
    open: boolean;
    code: string;
    name: string | null;
  }>({ open: false, code: "", name: null });

  // Phase A — A3 (anon-share unlock): the dialog renders the public
  // /s/:token URL the server returned. Closing it returns to the
  // celebration; the wall opens only from the dialog's explicit save action.
  const [anonShare, setAnonShare] = useState<{
    open: boolean;
    url: string;
  }>({ open: false, url: "" });
  const anonShareTriggerRef = useRef<HTMLElement | null>(null);
  const anonShareDismissCompletionRef = useRef<(() => void) | null>(null);
  const wallTriggerRef = useRef<HTMLElement | null>(null);
  const anonShareDismissFocusPendingRef = useRef(false);
  const wallDismissFocusPendingRef = useRef(false);

  // Restore stacked-dialog focus only after React has committed the upper
  // layer's removal and Modal has released `inert` from the celebration below.
  // Scheduling from the click/Escape handler itself races that cleanup in
  // Firefox; this effect runs in the post-commit phase across engines.
  useEffect(() => {
    if (anonShare.open || !anonShareDismissFocusPendingRef.current) return;
    anonShareDismissFocusPendingRef.current = false;
    const target = anonShareTriggerRef.current;
    if (!target?.isConnected) return;
    target.focus({ preventScroll: true });
  }, [anonShare.open]);

  useEffect(() => {
    if (wall.open || !wallDismissFocusPendingRef.current) return;
    wallDismissFocusPendingRef.current = false;
    const explicitTrigger = wallTriggerRef.current;
    const shareTrigger = anonShareTriggerRef.current;
    const target = explicitTrigger?.isConnected
      ? explicitTrigger
      : shareTrigger?.isConnected
        ? shareTrigger
        : document.querySelector<HTMLElement>("[data-anon-signup-trigger]");
    if (!target) return;
    target.focus({ preventScroll: true });
    wallTriggerRef.current = null;
    anonShareTriggerRef.current = null;
  }, [wall.open]);

  // Phase 27-v2.2 Fix 6 — funnel telemetry: anon_page_view fires at
  // most once per browser session per /try/ visit. Backend hashes the
  // IP and writes a row to phase27_funnel_events. Fire-and-forget —
  // telemetry never breaks the UX.
  //
  // Phase 27-v2.2 audit fix A2 (staff-pm + staff-ux convergence):
  // sessionStorage dedup so a refresh / back-button / same-tab nav
  // back to /try/ doesn't inflate the page-view count and depress
  // the apparent wall→signup conversion ratio. ip-hash-side dedup
  // would be perfect but requires server-side cooperation; this
  // client-side guard catches the common case (one Maya, one tab)
  // for free. StrictMode dev double-mount is also covered.
  useEffect(() => {
    if (!allowed) return;
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem("codetutor.anonPageViewLogged") === "1") {
        return;
      }
      window.sessionStorage.setItem("codetutor.anonPageViewLogged", "1");
    } catch {
      // sessionStorage can throw in private-mode Safari etc — fall
      // through and fire (worse to undercount than to dedup).
    }
    api.postFunnelEvent("anon_page_view");
  }, [allowed]);

  useEffect(() => {
    if (authLoading || user || allowed) return;
    let userInteracted = false;
    const timers: number[] = [];
    const markInteraction = () => {
      userInteracted = true;
    };
    const focusBlockedTitle = () => {
      if (userInteracted) return;
      const active = document.activeElement;
      if (active !== document.body && active?.isConnected) return;
      blockedTitleRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", markInteraction, { capture: true });
    window.addEventListener("keydown", markInteraction, { capture: true });
    for (const delay of [0, 150, 500]) {
      timers.push(window.setTimeout(focusBlockedTitle, delay));
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", markInteraction, { capture: true });
      window.removeEventListener("keydown", markInteraction, { capture: true });
    };
  }, [allowed, authLoading, courseId, lessonId, user]);

  // Resolve the existing browser session before choosing the public trial.
  // Signed-in learners belong in the authenticated lesson, never in a hybrid
  // anonymous shell with saved progress and first-run narration mixed in.
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted" role="status">
        Preparing your lesson…
      </div>
    );
  }
  if (user && courseId && lessonId) {
    return <Navigate to={`/learn/course/${courseId}/lesson/${lessonId}`} replace />;
  }

  // Keep the lesson-1-only anonymous boundary, but explain it and preserve the
  // requested destination through sign-in instead of silently going home.
  if (!allowed) {
    const requestedLesson = lessonId
      ? lessonId.replaceAll("-", " ")
      : "this lesson";
    const returnTo = courseId && lessonId
      ? `/learn/course/${courseId}/lesson/${lessonId}`
      : "/start";
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-5 text-ink">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-panel p-6 shadow-2xl sm:p-8" aria-labelledby="anon-access-title">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Continue learning</p>
          <h1
            ref={blockedTitleRef}
            id="anon-access-title"
            tabIndex={-1}
            className="mt-3 font-display text-3xl font-semibold capitalize focus:outline-none"
          >
            {requestedLesson} comes after lesson 1
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            The first Python lesson is available without an account. Sign in to open this lesson, or start with lesson 1 now.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/try/lesson/python-fundamentals/hello-world"
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Start lesson 1
            </Link>
            <Link
              to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign in to continue
            </Link>
          </div>
        </section>
      </main>
    );
  }

  // Phase 27-v2.2 Fix 6 — every wall-open path also emits a funnel
  // event tagged with the reason so the admin dashboard can split
  // "save" vs "next-lesson" vs "exhausted" vs "share" conversion
  // pressure. openWall is the single point that does both — keeps the
  // setWall + telemetry pair atomic.
  const openWall = (reason: SignupWallReason, trigger?: HTMLElement | null) => {
    wallTriggerRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    const files = useProjectStore.getState().snapshot();
    const main = files.find((file) => file.path === "main.py") ?? files[0];
    const liveName = extractNameFromCode(main?.content ?? "");
    setWall({
      open: true,
      reason,
      initialFirstName: readAnonStash()?.name ?? liveName ?? undefined,
    });
    api.postFunnelEvent("anon_wall_opened", reason);
  };
  const onAnonSave = (trigger?: HTMLElement | null) => openWall("save", trigger);
  // Phase 27-v2.1 audit pass 1 fix #5: GuidedTutorPanel calls this when
  // /api/anon/ai/ask/stream returns 429 ANON_EXHAUSTED (the L_anon
  // per-IP daily cap). Same wall surface as save/next-lesson, different
  // framing — SignupWallDialog has copy for reason="exhausted".
  const onAnonExhausted = () => openWall("exhausted");
  // Phase A — A3 (anon-share unlock): create a real public artifact
  // BEFORE the wall opens. The share button on the celebration was
  // pivoting straight to the wall (reason="share") — so every share
  // click ate the K-factor moment at peak intent. Now the click
    // creates a `/s/:token` row and the AnonShareDialog renders the URL
    // (copy, native share, done). Signup remains an explicit choice.
  //
  // Failure modes (rate-limit, kill switch, 503): fall back to the
  // wall path silently — same medium-lock as before, no regression.
  // Note: the share gate in LessonPage still hides on practice mode
  // for both authed and anon — this callback only fires for non-
  // practice celebrations.
  const onAnonShare = (
    payload: AnonSharePayload,
    trigger: HTMLButtonElement,
    dismissCompletion: () => void,
  ) => {
    // Safari/WebKit does not consistently move DOM focus to a button when it
    // is clicked. Carry the concrete opener through the callback so closing
    // the stacked dialog always has a durable, cross-browser restore target.
    anonShareTriggerRef.current = trigger;
    anonShareDismissCompletionRef.current = dismissCompletion;
    if (!payload.codeSnippet.trim()) {
      // No code typed — shouldn't happen post-celebration, but if it
      // does, fall back to the wall instead of sending a 400.
      openWall("share");
      return;
    }
    api
      .createAnonShare({
        courseId: ANON_ALLOWED.courseId,
        lessonId: ANON_ALLOWED.lessonId,
        ...payload,
      })
      .then(({ url }) => {
        setAnonShare({ open: true, url });
      })
      .catch(() => {
        // Rate-limit / kill-switch / network: silent fallback to wall
        // so the funnel still has a conversion lever. Console-error
        // the boundary in dev devtools but don't surface to the user
        // — wall reframes the moment as "sign up to keep going".
        openWall("share");
      });
  };
  // Phase 27-v2.2 audit fix E1: kill-switch flipped path. The tutor
  // ask returns 503 ANON_LESSON_DISABLED; instead of leaving Maya
  // staring at "Request failed", route to the wall with the trial-
  // paused framing.
  const onAnonTrialPaused = () => openWall("trial-paused");

  const stashCompletedLesson = () => {
    // Read the live code out of the project store at the moment of
    // click — Monaco edits flow through setContent, so this captures
    // whatever the user just had on screen at the celebration moment.
    const files = useProjectStore.getState().snapshot();
    const main = files.find((f) => f.path === "main.py") ?? files[0];
    const code = main?.content ?? "";
    const parsedName = extractNameFromCode(code);
    writeAnonStash({
      completedAt: new Date().toISOString(),
      courseId: ANON_ALLOWED.courseId,
      lessonId: ANON_ALLOWED.lessonId,
      code,
      name: parsedName,
      flags: {
        welcomeDone: true,
        // Phase A-Q removed the stacked workspace tour from lessons.
        // Keep the persisted flag true so post-signup lesson 2 and the
        // free editor do not resurrect obsolete onboarding.
        workspaceCoachDone: true,
      },
    });
    return { code, parsedName };
  };

  const onAnonNext = (trigger: HTMLButtonElement) => {
    const { code, parsedName } = stashCompletedLesson();
    wallTriggerRef.current = trigger;
    if (isPhone) {
      // Phase A — A2 device contract: phone learners see the
      // graduation handoff dialog instead of the wall. Its dismiss action
      // returns to the completed lesson; signup is separately labelled.
      setGraduation({ open: true, code, name: parsedName });
      api.postFunnelEvent("anon_wall_opened", "next-lesson");
      return;
    }
    openWall("next-lesson", trigger);
  };

  return (
    <>
      {showCinematic && (
        <CinematicGreeting
          mode="full"
          firstName="there"
          exampleName="Maya"
          heroLine="Your turn."
          // Phase 27-v2.2 audit fix (product-owner P2-1): the prior
          // subtitle "Make it say your name." re-stated what the
          // pulsing `Hello, ____!` slot already telegraphs. Three
          // signals (hero, slot, subtitle) for one beat read as
          // instruction-overload. Subtitle now carries the product
          // thesis (the loop name), matching authed cinematic's
          // "every lesson works like this" framing.
          subtitle="Every lesson is like this — code, run, see it answer."
          outputPreview={{
            // Plain blanks ("Hello, ____!") signal "fillable slot"
            // without telegraphing what the lesson auto-Run will
            // produce. Phase A — A1: the starter is comment-only and
            // the auto-Run prints nothing — so the fillable-slot
            // metaphor here pre-stages the empty-state the learner
            // will see, then asks them to type the print() line that
            // fills it.
            template: "Hello, ____!",
            placeholder: "____",
          }}
          heroAlign="left"
          cursorIntoSlot
          onComplete={dismissCinematic}
          onSkip={dismissCinematic}
        />
      )}
      <LessonPage
        mode="anon"
        openingBlocked={showCinematic}
        courseId={ANON_ALLOWED.courseId}
        lessonId={ANON_ALLOWED.lessonId}
        anonResumeSnapshot={initialWorkspaceRef.current}
        onAnonSave={onAnonSave}
        onAnonNext={onAnonNext}
        onAnonExhausted={onAnonExhausted}
        onAnonShare={onAnonShare}
        onAnonTrialPaused={onAnonTrialPaused}
        onAnonFirstRun={() => api.postFunnelEvent("anon_first_run")}
        onAnonComplete={() => {
          // Phase A — A6: fire-and-forget concept-tag write on the
          // anon-completion beat. The authed-side write at handoff
          // time covers the gap if this fails (network blip,
          // backend down) — the ledger is the data substrate, not a
          // critical path for the user's experience.
          void api.postAnonConceptTag({
            courseId: ANON_ALLOWED.courseId,
            lessonId: ANON_ALLOWED.lessonId,
          });
          api.postFunnelEvent("anon_lesson_completed");
        }}
      />
      <SignupWallDialog
        open={wall.open}
        reason={wall.reason}
        initialFirstName={wall.initialFirstName}
        onDismiss={() => {
          // Every wall close must restore its concrete opener. Relying on the
          // generic modal snapshot is not enough for stacked dialogs because
          // the completion layer becomes inert while this wall mounts, and
          // some browsers move focus to body before passive effects capture
          // it. The wrapper already owns the durable trigger for every reason.
          wallDismissFocusPendingRef.current = true;
          if (wall.reason === "share" && anonShareTriggerRef.current) {
            anonShareDismissCompletionRef.current = null;
          }
          setWall((current) => ({ ...current, open: false }));
        }}
      />
      {graduation.open && (
        <PhoneGraduationDialog
          code={graduation.code}
          name={graduation.name}
          onDismiss={() => setGraduation((g) => ({ ...g, open: false }))}
          onFallbackToWall={() => openWall("next-lesson")}
        />
      )}
      {anonShare.open && (
        <AnonShareDialog
          url={anonShare.url}
          onDismiss={() => {
            anonShareDismissFocusPendingRef.current = true;
            anonShareDismissCompletionRef.current = null;
            setAnonShare((s) => ({ ...s, open: false }));
          }}
          onSaveProgress={() => {
            setAnonShare((s) => ({ ...s, open: false }));
            anonShareDismissCompletionRef.current?.();
            anonShareDismissCompletionRef.current = null;
            stashCompletedLesson();
            openWall("share");
          }}
        />
      )}
    </>
  );
}
