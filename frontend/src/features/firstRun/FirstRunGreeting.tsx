import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../auth/authStore";
import { markFirstRunComplete } from "../../state/preferencesStore";
import { resolveFirstName } from "./resolveFirstName";
import { CinematicGreeting } from "./CinematicGreeting";

// The first-run moment. Mounts from /welcome, plays the full 5.2 s
// cinematic, then navigates into the learner's first lesson (if truly
// brand-new) or back to /  (if this is a settings-triggered replay of
// the greeting by an existing learner).
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
  const user = useAuthStore((s) => s.user);

  const firstName = resolveFirstName(user);

  // The cinematic always hands off to the first lesson with
  // `firstRun=1` — even for replay users who already have progress.
  // The whole point of the cinematic is to demo the product by
  // running through lesson 1; dumping the learner on the dashboard
  // right after "Starting your first lesson…" is a promise-break.
  // If a replay learner already completed hello-world, the scripted
  // choreography still reads as a guided re-walk of the same lesson;
  // they can dismiss and navigate away the moment they want to.
  const target =
    "/learn/course/python-fundamentals/lesson/hello-world?firstRun=1";

  // Intentionally no `welcomeDone` guard — the earlier version
  // redirected to `/` when welcomeDone flipped true mid-cinematic,
  // which fought with handleComplete's own nav on every replay and
  // made the cinematic "vanish early" on subsequent "Show intro
  // again" clicks. The only ways to land here are (a) StartPage's
  // redirect for users with welcomeDone=false, (b) explicit nav from
  // "Show intro again," or (c) a user typing /welcome directly.
  // All three are legitimate — no guard needed.

  const handleComplete = () => {
    // The cinematic has finished its own dissolve; flip welcomeDone
    // now so a user who rode the whole arc doesn't get re-greeted on
    // the next StartPage visit, and nav to the target.
    markFirstRunComplete();
    nav(target, { replace: true });
  };

  const handleSkip = () => {
    markFirstRunComplete();
    nav("/", { replace: true });
  };

  // Subtitle + support line are the SAME regardless of whether this
  // is a brand-new learner or an existing user replaying via
  // "Show intro again." The branching I had earlier ("Welcome back,
  // let's pick up where we left off…") fought the first-run framing:
  // the hero line is "Hi, Name!" — a first-time greeting — and a
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
      heroLine={`Hi, ${firstName}!`}
      subtitle="Every lesson works like this. Write code, watch it answer."
      // Support line is the same for everyone — replay path gets the
      // same copy as the first-run path. The tiny incoherence for
      // replay users (who land on /, not a lesson) is fine; the
      // cinematic is the experience, not a status update.
      supportLine="Starting your first lesson…"
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  );
}
