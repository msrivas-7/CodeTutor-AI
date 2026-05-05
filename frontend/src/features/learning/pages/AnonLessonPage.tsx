import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import LessonPage from "./LessonPage";
import { CinematicGreeting } from "../../firstRun/CinematicGreeting";
import { SignupWallDialog, type SignupWallReason } from "../components/SignupWallDialog";
import { useProjectStore } from "../../../state/projectStore";
import { usePreferencesStore } from "../../../state/preferencesStore";
import {
  extractNameFromCode,
  hasCinematicSeen,
  hasCoachSeenAnon,
  markCinematicSeen,
  markCoachSeenAnon,
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
//   - hasCoachSeenAnon ↔ preferencesStore.workspaceCoachDone bridge so
//     a same-tab reload after coach dismissal doesn't replay the tour.
//
// What LessonPage(mode="anon") owns (the entire visible workspace):
//   - Lesson load (loadFullLesson into projectStore)
//   - Monaco editor + Run button + output panel + Check button
//   - GuidedTutorPanel (routes AI stream to /api/anon/ai/ask/stream)
//   - WorkspaceCoach 6-step tour (persistDone={false} on anon, but
//     locally flips workspaceCoachDone so choreography enable kicks in)
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
  const allowed =
    courseId === ANON_ALLOWED.courseId && lessonId === ANON_ALLOWED.lessonId;

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
  const [wall, setWall] = useState<{ open: boolean; reason: SignupWallReason }>({
    open: false,
    reason: "save",
  });

  // Bridge sessionStorage anon-coach flag → preferencesStore SYNCHRONOUSLY
  // on first render. WorkspaceCoach inside LessonPage(mode="anon") flips
  // workspaceCoachDone locally on dismissal (no PATCH); we mirror that
  // flip back into sessionStorage so a reload doesn't re-show the
  // 6-step tour.
  //
  // CRITICAL: this must run BEFORE LessonPage's first render commits.
  // useEffect runs AFTER first commit — by which time useLessonLayout
  // has already read workspaceCoachDone=false and scheduled the
  // COACH_AUTO_OPEN_MS=600ms timer. Even though a follow-up effect
  // would clear that timer, there's a window where the user can see
  // a flicker if the workspaceCoachDone update lands too late.
  // useState's lazy initializer runs DURING render, before any child
  // mounts, so by the time LessonPage reads workspaceCoachDone via
  // its preferencesStore selector, the value is already true.
  // (Side-effect-in-initializer pattern: idempotent setState, runs
  // exactly once thanks to useState's contract.)
  useState(() => {
    if (hasCoachSeenAnon()) {
      usePreferencesStore.setState({ workspaceCoachDone: true });
    }
    return true;
  });

  // Subscribe to coach-completion → mirror back into sessionStorage.
  // Subscribe is registered post-mount (useEffect) but the false→true
  // transition only fires AFTER the user actually completes the coach
  // in this tab, well after mount. The seed-via-useState above covers
  // the reload-replay case independently.
  useEffect(() => {
    const unsub = usePreferencesStore.subscribe((state, prev) => {
      if (state.workspaceCoachDone && !prev.workspaceCoachDone) {
        markCoachSeenAnon();
      }
    });
    return unsub;
  }, []);

  // Allowlist guard — any other (courseId, lessonId) redirects home.
  if (!allowed) return <Navigate to="/" replace />;

  const onAnonSave = () => setWall({ open: true, reason: "save" });
  // Phase 27-v2.1 audit pass 1 fix #5: GuidedTutorPanel calls this when
  // /api/anon/ai/ask/stream returns 429 ANON_EXHAUSTED (the L_anon
  // per-IP daily cap). Same wall surface as save/next-lesson, different
  // framing — SignupWallDialog has copy for reason="exhausted".
  const onAnonExhausted = () => setWall({ open: true, reason: "exhausted" });
  // Phase 27-v2.2 Fix 1 — anon share lever. The LessonCompletePanel
  // "Your first one — Share it" card on /try/ no longer hides; click
  // pivots to the wall (reason="share") instead of opening the
  // auth-required ShareDialog (which would 401-cascade). Same medium-
  // lock pattern as save/next-lesson — wall is dismissable, lesson
  // chrome stays interactive, no re-trap loop. Note: the share gate
  // in LessonPage still hides on practice-mode for both authed and
  // anon — this callback only fires for non-practice celebrations.
  const onAnonShare = () => setWall({ open: true, reason: "share" });

  const onAnonNext = () => {
    // Read the live code out of the project store at the moment of
    // click — Monaco edits flow through setContent, so this captures
    // whatever the user just had on screen at the celebration moment.
    const files = useProjectStore.getState().snapshot();
    const main = files.find((f) => f.path === "main.py") ?? files[0];
    const code = main?.content ?? "";
    writeAnonStash({
      completedAt: new Date().toISOString(),
      courseId: ANON_ALLOWED.courseId,
      lessonId: ANON_ALLOWED.lessonId,
      code,
      name: extractNameFromCode(code),
      // workspaceCoachDone reflects the local truth: coach was either
      // dismissed in this tab or skipped because hasCoachSeenAnon was
      // already true on mount. Either way, the post-signup handoff
      // flips the persistent flag so lesson 2 doesn't re-show the tour.
      flags: {
        welcomeDone: true,
        workspaceCoachDone: hasCoachSeenAnon(),
      },
    });
    setWall({ open: true, reason: "next-lesson" });
  };

  return (
    <>
      {showCinematic && (
        <CinematicGreeting
          mode="full"
          firstName="there"
          heroLine="Your turn."
          subtitle="Make it say your name."
          outputPreview={{
            template: "Hello, YOUR_NAME!",
            placeholder: "YOUR_NAME",
          }}
          heroAlign="left"
          cursorIntoSlot
          onComplete={dismissCinematic}
          onSkip={dismissCinematic}
        />
      )}
      <LessonPage
        mode="anon"
        courseId={ANON_ALLOWED.courseId}
        lessonId={ANON_ALLOWED.lessonId}
        onAnonSave={onAnonSave}
        onAnonNext={onAnonNext}
        onAnonExhausted={onAnonExhausted}
        onAnonShare={onAnonShare}
      />
      <SignupWallDialog
        open={wall.open}
        reason={wall.reason}
        onDismiss={() => setWall({ open: false, reason: wall.reason })}
      />
    </>
  );
}
