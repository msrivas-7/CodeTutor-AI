// Canned tutor speech for the first-run cinematic. The voice is a
// specific person — patient, warm, a touch playful, never condescending.
// Uses the learner's name only at high-stakes beats (greeting +
// celebration); overuse reads as a sales call, not a conversation.
//
// Written longhand rather than template-string-concatenated so the
// tone checks are diff-reviewable:
//   - "Hey" opens like a person, not a corporate greeting.
//   - No "I'm your tutor" — the tutor's role is implied by the setting.
//   - Single exclamation point per turn at most.
//   - No "Let's" as a verbal tic — reserved for the real transition.
//   - Backtick inline code refs so `TutorResponseView` renders them as
//     monospace tokens, matching how real tutor turns format code.
//
// Phase A — A1 (funnel-edge pedagogy): lesson 1 starter is now an
// empty shell — the only thing in the file is a comment hinting
// `print("Hello, …!")`. The cinematic's job is to walk the learner
// from "the screen is empty — you have to type something" to
// "computer says hi to me, by name." Concretely:
//   1. GREET (scripted) — set the scene.
//   2. Auto-Run fires the empty file → produces no stdout.
//   3. CELEBRATE_RUN narrates the empty output and hands over.
//   4. Learner types a print() line and runs.
//   5. Success heuristic checks stdout includes "Hello, " AND is not
//      the literal example "Hello, World!" — same contract as the
//      lesson's expected_stdout + forbidden_in_stdout pair, so the
//      cinematic and the validator agree on what "done" means.
//
// Phase 27-v2.2 audit fix (product-owner P2-2): anon path passes
// firstName="there" by design — so the prior `Hey there` opener was
// the customer-service-email beat. The PRAISE turn at the end IS
// personalized (resolvePraiseName extracts from the typed code), so
// the arc was generic-open / intimate-close. Detect the placeholder
// name and skip the salutation entirely on anon — the rest of the
// scripted opener carries the same warmth without the awkward "there"
// stand-in. Authed path keeps `Hey ${firstName}` since it has a real
// name to use.
export const GREET = (name: string): string => {
  const opener =
    name === "there"
      ? "Good to meet you."
      : `Hey ${name} — good to meet you.`;
  return (
    `${opener} That little file on your screen? ` +
    `It's where you write code. Right now it's empty — just hint comments. ` +
    `Let me run it for you so you can see what "running" actually does.`
  );
};

export const CELEBRATE_RUN = (): string =>
  "And… nothing happened. That's right — the file has no real code yet, " +
  "just `#` comments (Python ignores those). Your turn: type a `print(\"Hello, …!\")` " +
  "line under the comments, swap in your own name, and click Run. " +
  "You'll see your computer say hi to you, by name.";

export const PRAISE_EDIT_RUN_AND_SEED = (name: string): string =>
  `Perfect, ${name} — your computer just said hi to you, by name. ` +
  "Every lesson from here works the same: read the idea, tweak the code, " +
  "run it, check your work, ask me anything. " +
  "For now, one last step: click Check my work to finish the lesson.";

// Fallback copy for the edge case where `runner.canRun` never becomes
// true (backend down, session start failed). We don't let the
// cinematic stall — just shift the narration to "you drive" and wait
// for the user's click instead of auto-pressing Run.
export const GREET_USER_DRIVEN = (name: string): string =>
  `Hey ${name} — good to meet you. That little file on your screen? ` +
  `It's empty — just hint comments. Type a `+
  `\`print("Hello, …!")\` line and click the green Run button when you're ready.`;

// Soft-correction turns fired when the learner's edit produces the
// wrong output on their first try. Each is keyed to a specific kind
// of mistake so the tutor reads like a person who actually looked
// at what they wrote — not a form-letter "try again." The
// observer picks one based on the stdout/exitCode shape; see
// useFirstRunChoreography's correctEdit branch.
//
// Deliberately kept short (a sentence or two). The learner is
// looking at their code right now, not at the panel — long
// explanations break the loop.

// Lesson 1's lenient `expected_stdout: "Hello, "` is paired with a
// `forbidden_in_stdout: "Hello, World!"` to reject literal copies of
// the starter's example. This soft-correction matches that contract
// so the cinematic catches the lazy-pass before the validator does.
export const WRONG_EDIT_LITERAL_EXAMPLE = (): string =>
  "Almost — that's the literal example I gave you, not your name. " +
  "Swap `World` for what people actually call you (keep the quotes), then run again.";

export const WRONG_EDIT_EMPTY = (): string =>
  "Hmm — nothing printed. Make sure you've added a " +
  "`print(\"Hello, …!\")` line outside the comments. Tweak and run again.";

export const WRONG_EDIT_ERROR = (): string =>
  "Something errored out — have a look at the red text in the output panel. " +
  "Most common cause here: missing quotes around your name. It needs to be " +
  "in quotes, like `\"Maya\"`.";

export const WRONG_EDIT_GENERIC = (): string =>
  "Close, but the output should look like `Hello, YourName!`. " +
  "Check that your line starts with `print(`, ends with `)`, and keeps the " +
  "whole greeting inside quotes. Then run it again.";

// Second-attempt rescue. It points to the structure and evidence without
// supplying a pasteable solution: the learner still authors the greeting.
export const STRONGER_HINT = (): string =>
  "Let's check it piece by piece: use the lowercase word `print`, put one " +
  "opening and one closing parenthesis around your greeting, and keep the " +
  "greeting — including your own name — between matching quotes. Then click Run.";
