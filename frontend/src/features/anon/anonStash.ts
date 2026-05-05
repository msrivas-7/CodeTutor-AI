// Phase 27-v2 — sessionStorage stash for anon→authed handoff.
//
// When an anonymous learner finishes lesson 1 on /try/... and clicks
// "Sign up to keep going", the AnonLessonPage writes their working
// state to sessionStorage with `writeAnonStash()`. After auth, the
// SignupPage reads it with `readAnonStash()` and POSTs the contents
// to /api/anon-handoff so the now-authed user gets:
//   - lesson 1 marked complete
//   - their typed name persisted into user_metadata
//   - their code persisted into the project store
//   - first_run_done = true (cinematic + walkthrough already played)
//   - workspace_coach_done = true (coach already ran on anon)
//   - welcome_done = true (no /welcome replay)
// SignupPage then routes directly to lesson 2.
//
// Why sessionStorage and not localStorage:
//   - Privacy. Stash dies with the browser tab. If Maya signs up on
//     a shared phone and forgets, no one can revisit /try/ in a new
//     window and reach her unsubmitted answer.
//   - No "ghost stash" surfaces on a stale tab she opens 3 days
//     later — it would silently re-handoff over fresh state.
//   - User memory rule: "no localStorage → DB migration ever". The
//     stash IS a one-shot migration shape, but in sessionStorage
//     it's per-tab + ephemeral, not a long-lived shadow store.
//
// Schema is versioned (v: 1). If we ever change the shape, bump
// the version and the read path drops anything older — no crash on
// shape mismatch.

const STORAGE_KEY = "codetutor.anonRun";
const SCHEMA_VERSION = 1;

export interface AnonStashV1 {
  v: 1;
  /** UTC ISO timestamp the lesson completed at. */
  completedAt: string;
  /** The course this anon run belongs to. Always python-fundamentals today. */
  courseId: "python-fundamentals";
  /** The lesson the user just completed. Always hello-world today. */
  lessonId: "hello-world";
  /** The user's final main.py contents (with their typed name baked in). */
  code: string;
  /**
   * The literal name the user typed, parsed from `name = "..."` in their
   * code at lesson completion. Used to set user_metadata.first_name on
   * the handoff so lesson 2's tutor opens with "Hey Maya" not "Hey there".
   */
  name: string | null;
  /**
   * The flags the handoff endpoint flips on the user_preferences row
   * to suppress /welcome cinematic, ?firstRun=1 choreography, and
   * WorkspaceCoach on the post-signup landing.
   */
  flags: {
    welcomeDone: true;
    firstRunDone: true;
    workspaceCoachDone: true;
  };
}

/**
 * Write the stash. Called from AnonLessonPage right before opening the
 * SignupWallDialog at lesson completion, so a tab close at the wall
 * doesn't lose the artifact she earned.
 */
export function writeAnonStash(stash: Omit<AnonStashV1, "v" | "flags">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: AnonStashV1 = {
      v: SCHEMA_VERSION,
      flags: {
        welcomeDone: true,
        firstRunDone: true,
        workspaceCoachDone: true,
      },
      ...stash,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage can throw in private-mode Safari + quota-full.
    // Stash failure is non-fatal — Maya still signs up, she just
    // lands on /welcome + lesson 1 like a direct-signup user would.
    // Bounded downside vs the cost of a hard error at the wall.
  }
}

/**
 * Read the stash on the SignupPage. Returns null if missing,
 * unparsable, or schema-mismatched (so a stale stash from a future
 * version of the app doesn't crash the post-signup flow).
 */
export function readAnonStash(): AnonStashV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown };
    if (parsed.v !== SCHEMA_VERSION) return null;
    return parsed as AnonStashV1;
  } catch {
    return null;
  }
}

/**
 * Clear the stash. Called on the SignupPage AFTER a successful
 * /api/anon-handoff response so a refresh of the post-signup
 * landing page can't replay the handoff.
 */
export function clearAnonStash(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same fail-soft semantics as writeAnonStash.
  }
}

/**
 * Parse `name = "Maya"` (or single-quote, or whitespace variants) out
 * of the user's main.py. Returns the literal between the quotes if
 * exactly one match is found and it's not the unedited "YOUR_NAME"
 * sentinel; null otherwise. Used by AnonLessonPage at lesson
 * completion to populate the `name` field of the stash.
 *
 * Why server-side too? It isn't — this parser runs purely on the
 * client at stash-time. The handoff endpoint trusts whatever name
 * arrives in the body (length-bounded). If a user crafts a name in
 * their code that bypasses the parser, the worst case is that
 * `Hey there` shows on lesson 2 instead of `Hey Maya` — bounded.
 */
export function extractNameFromCode(code: string): string | null {
  // Anchored to `name = "..."` or `name = '...'`. We only consider the
  // first assignment — if the user reassigns later, that's beyond
  // first-run scope.
  const match = /\bname\s*=\s*['"]([^'"]{1,40})['"]/.exec(code);
  if (!match) return null;
  const candidate = match[1]!.trim();
  if (!candidate) return null;
  if (candidate.toUpperCase() === "YOUR_NAME") return null;
  return candidate;
}
