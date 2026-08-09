import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../../auth/authStore";
import {
  markFirstRunComplete,
  usePreferencesStore,
} from "../../state/preferencesStore";
import { resolveFirstName } from "./resolveFirstName";
import { CinematicGreeting } from "./CinematicGreeting";
import { normalizeReturnTarget } from "../../auth/returnTarget";

export function normalizeReplayReturnTarget(value: string | null): string {
  const target = normalizeReturnTarget(value, "/start");
  const pathname = new URL(target, "https://codetutor.invalid").pathname;
  return pathname === "/welcome" ? "/start" : target;
}

export function resolveWelcomeHandoff(
  explicitReplay: boolean,
  welcomeDone: boolean,
  requestedReturnTo: string | null = null,
): { replay: boolean; target: string } {
  const replay = explicitReplay || welcomeDone;
  return {
    replay,
    target: replay
      ? normalizeReplayReturnTarget(requestedReturnTo)
      : "/learn/course/python-fundamentals/lesson/hello-world?firstRun=1",
  };
}

// The first-run moment. Mounts from /welcome, plays the full 5.2 s
// cinematic, then navigates into the learner's first lesson (if truly
// brand-new) or back to the validated page that launched a replay.
//
// Copy here matters — this is the product thesis in language:
//   - hero is the user's name, set by the typewriter-into-stdout beat
//   - subtitle NAMES what they just watched + PROMISES more of it
//   - support line smooths the handoff to the lesson page
//
// Thin wrapper around <CinematicGreeting /> — all the choreography and
// reduced-motion handling lives there so first-run and welcome-back
// share exactly one implementation.

export function FirstRunGreeting() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const welcomeDone = usePreferencesStore((s) => s.welcomeDone);

  const firstName = resolveFirstName(user);

  // A replay is a read-only cinematic. It must never reuse the destructive
  // first-lesson onboarding route, because that route intentionally seeds a
  // starter and first-run state for brand-new learners. Existing learners go
  // back to a validated internal origin with every draft, completion, share,
  // and coach preference untouched. Direct /welcome visits after onboarding
  // are treated as replay too, even without the explicit query flag.
  const { replay, target } = resolveWelcomeHandoff(
    searchParams.get("replay") === "1",
    welcomeDone,
    searchParams.get("returnTo"),
  );

  // Intentionally no `welcomeDone` guard — the earlier version
  // redirected to `/` when welcomeDone flipped true mid-cinematic,
  // which fought with handleComplete's own nav on every replay and
  // made the cinematic "vanish early" on subsequent "Show intro
  // again" clicks. The only ways to land here are (a) StartPage's
  // redirect for users with welcomeDone=false, (b) explicit nav from
  // "Show intro again," or (c) a user typing /welcome directly.
  // All three are legitimate — no guard needed.

  // Race the pref patch against a short safety timeout. We prefer to
  // await the server write so a reload right after the cinematic
  // doesn't re-fire the welcome-back overlay (stale server state).
  // But hanging on a bad network would strand the learner watching
  // a completed cinematic forever. 2 s is comfortably longer than a
  // normal round-trip yet short enough the user doesn't notice.
  const PATCH_TIMEOUT_MS = 2_000;
  const persistOrTimeout = () =>
    Promise.race([
      markFirstRunComplete(),
      new Promise<void>((resolve) =>
        window.setTimeout(resolve, PATCH_TIMEOUT_MS),
      ),
    ]);

  const handleComplete = async () => {
    // Brand-new learners stamp welcomeDone before entering lesson 1. Replay
    // is read-only and returns existing learners to their validated origin
    // without preference or progress writes.
    if (!replay) await persistOrTimeout();
    const returnsToStart =
      new URL(target, window.location.origin).pathname === "/start";
    nav(target, {
      replace: true,
      state: replay
        ? returnsToStart
          ? { focusStartHeading: true }
          : { focusAfterReplay: true }
        : undefined,
    });
  };

  const handleSkip = async () => {
    if (!replay) await persistOrTimeout();
    // Skip changes only the duration: new learners still enter lesson 1,
    // while replay learners return to the same validated origin.
    const returnsToStart =
      new URL(target, window.location.origin).pathname === "/start";
    nav(target, {
      replace: true,
      state: replay
        ? returnsToStart
          ? { focusStartHeading: true }
          : { focusAfterReplay: true }
        : undefined,
    });
  };

  // Subtitle + support line are the SAME regardless of whether this
  // is a brand-new learner or an existing user replaying via
  // "Show intro again." The branching I had earlier ("Welcome back,
  // let's pick up where we left off…") fought the first-run framing:
  // the hero line is "Hello, Name!" — a first-time greeting — and a
  // returning-user subtitle underneath it reads as an identity
  // conflict. The first-run cinematic IS the first-run cinematic;
  // returning users opting to replay it want to see the original
  // moment, not a hybrid. Welcome-back has its own overlay with
  // its own copy (WelcomeBackOverlay / resolveWelcomeBackCopy).
  //
  // Copy echoes what the user just watched on screen — the code
  // executing and producing their name — so the line of Python is
  // recontextualized as the product's core loop, not just a demo.
  return (
    <CinematicGreeting
      mode="full"
      firstName={firstName}
      heroLine={`Hello, ${firstName}!`}
      subtitle="Every lesson works like this. Write code, watch it answer."
      supportLine={
        replay
          ? "Taking you back to where you left off…"
          : "Starting your first lesson…"
      }
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  );
}
