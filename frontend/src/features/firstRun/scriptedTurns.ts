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

export const GREET = (name: string): string =>
  `Hey ${name} — good to meet you. That little program on your screen? ` +
  `It's the simplest thing Python can do: print a message. ` +
  `Let me run it for you — watch the bottom of the screen.`;

export const CELEBRATE_RUN = (): string =>
  "There — `Hello, Python!` just printed to your output. " +
  "Your turn now. Change `'Hello, Python!'` to `'Hello, World!'` — " +
  "one word, any way you like. Run it again.";

export const PRAISE_EDIT_RUN_AND_SEED = (name: string): string =>
  `Perfect, ${name} — \`Hello, World!\` is in your output. ` +
  "Every lesson from here works the same: read the idea, tweak the code, " +
  "run it, check your work, ask me anything. Try printing your own name " +
  "next time, or ping me with a question. " +
  "For now, one last step: click **Check my work** to finish the lesson.";

// Fallback copy for the edge case where `runner.canRun` never becomes
// true (backend down, session start failed). We don't let the
// cinematic stall — just shift the narration to "you drive" and wait
// for the user's click instead of auto-pressing Run.
export const GREET_USER_DRIVEN = (name: string): string =>
  `Hey ${name} — good to meet you. That little program on your screen? ` +
  `It's the simplest thing Python can do: print a message. ` +
  `Click the green Run button when you're ready — I'll wait.`;
