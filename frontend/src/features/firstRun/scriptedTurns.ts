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
// Phase 27 — lesson 1 personalized. Starter has a `YOUR_NAME` placeholder;
// the cinematic's job is to walk the learner from "computer says
// `Hello, YOUR_NAME!`" to "computer says hi to me, by name."

export const GREET = (name: string): string =>
  `Hey ${name} — good to meet you. That little program on your screen? ` +
  `It's a Python program that prints a greeting — but it has a placeholder. ` +
  `Let me run it for you and you'll see what I mean.`;

export const CELEBRATE_RUN = (): string =>
  "There — `Hello, YOUR_NAME!` just printed. That's the placeholder. " +
  "Your turn now. In the first line of code, replace `YOUR_NAME` with your actual " +
  "name (keep the quotes!), then click Run again. See your computer say hi to you, by name.";

export const PRAISE_EDIT_RUN_AND_SEED = (name: string): string =>
  `Perfect, ${name} — your computer just said hi to you, by name. ` +
  "Every lesson from here works the same: read the idea, tweak the code, " +
  "run it, check your work, ask me anything. " +
  "For now, one last step: click **Check my work** to finish the lesson.";

// Fallback copy for the edge case where `runner.canRun` never becomes
// true (backend down, session start failed). We don't let the
// cinematic stall — just shift the narration to "you drive" and wait
// for the user's click instead of auto-pressing Run.
export const GREET_USER_DRIVEN = (name: string): string =>
  `Hey ${name} — good to meet you. That little program on your screen? ` +
  `It's a Python program that prints a greeting — but it has a placeholder. ` +
  `Click the green Run button when you're ready — I'll wait.`;

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

export const WRONG_EDIT_PLACEHOLDER = (): string =>
  "Almost — you still have `YOUR_NAME` in there. Replace it with your actual " +
  "name (keep the quotes around it), then run again.";

export const WRONG_EDIT_EMPTY = (): string =>
  "Hmm — nothing printed. Make sure you still have a " +
  "`print(...)` call in the file. Tweak and run again.";

export const WRONG_EDIT_ERROR = (): string =>
  "Something errored out — have a look at the red text in the output panel. " +
  "Most common cause here: missing quotes around your name. It needs to be " +
  "in quotes, like `\"Maya\"`.";

export const WRONG_EDIT_GENERIC = (): string =>
  "Close, but the output should look like `Hello, YourName!`. " +
  "On the first line, change `name = \"YOUR_NAME\"` so the quotes wrap your " +
  "real name, then run again.";

// Second-attempt rescue. The learner has guessed twice and the
// output still doesn't match; give them the answer directly so
// they don't end up stranded watching a cinematic that never
// advances. Same spirit as a real tutor walking you through it.
export const STRONGER_HINT = (): string =>
  "Here it is line-for-line — change the first line to " +
  "`name = \"Your Name\"` (with your actual name in the quotes), " +
  "then click Run.";
