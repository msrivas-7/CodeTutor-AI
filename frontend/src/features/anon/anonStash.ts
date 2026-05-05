// Phase 27-v2 — sessionStorage stash for anon→authed handoff.
//
// When an anonymous learner finishes lesson 1 on /try/... and clicks
// "Sign up to keep going", the AnonLessonPage writes their working
// state to sessionStorage with `writeAnonStash()`. After auth, the
// freshly-signed-up user lands at /start; StartPage reads the stash
// with `readAnonStash()` and POSTs the contents to /api/anon-handoff
// so the now-authed user gets:
//   - lesson 1 marked complete in lesson_progress with
//     last_code = {"main.py": user's code}
//   - course_progress upserted (in_progress, completedLessonIds
//     includes hello-world)
//   - welcome_done set per stash.flags.welcomeDone (true post-Day-2
//     since the cinematic actually fired on anon)
//   - workspace_coach_done set per stash.flags.workspaceCoachDone
//     (false today; Day 6 will mount the coach on anon and start
//     setting it true)
// stash.name is INFORMATIONAL — not persisted server-side. Maya's
// firstName for the lesson-2 tutor's "Hey Maya" comes from the
// signup form's user_metadata, not from this field. The name in the
// stash is consumed by AnonLessonPage's celebration ("You did it,
// Maya.") and could power lesson-2 personalization in a future
// admin-API write, but Day 4 doesn't do that.
// StartPage then routes directly to lesson 2.
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

// Phase 27-v2 Day 2: separate one-shot flag tracking whether the
// /try/... cinematic has already played for this tab. Lives next to
// the stash so all anon-flow state is in one place. sessionStorage
// (not localStorage) so a brand-new browser tab — including a new
// device or private window — gets a fresh cinematic. A reload in
// the same tab AFTER the cinematic has dismissed does NOT replay.
// A reload BEFORE the cinematic dismissed (mid-arc) does replay,
// because the flag is only stamped on onComplete/onSkip.
const CINEMATIC_SEEN_KEY = "codetutor.anonCinematicSeen";

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
   * Honest record of which orientation surfaces actually fired on the
   * anon path before signup. Mirrored into user_preferences columns
   * (welcome_done, workspace_coach_done) by the handoff endpoint so
   * post-signup ONLY suppresses what the user genuinely already saw.
   * Day 6 will mount WorkspaceCoach on anon and start setting
   * workspaceCoachDone=true; pre-Day-6 stash writers MUST pass false
   * to avoid silently skipping a feature Maya never saw. There is
   * no DB column for "first run done" — it's the same flag as
   * welcomeDone in this codebase (markFirstRunComplete just sets
   * welcome_done=true), so we don't carry a separate field.
   */
  flags: {
    welcomeDone: boolean;
    workspaceCoachDone: boolean;
  };
}

/**
 * Write the stash. Called from AnonLessonPage right before opening the
 * SignupWallDialog at lesson completion, so a tab close at the wall
 * doesn't lose the artifact she earned. The caller passes `flags`
 * reflecting what actually fired on anon — never auto-true a flag for
 * a surface that hasn't shipped on the anon path yet.
 */
export function writeAnonStash(stash: Omit<AnonStashV1, "v">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: AnonStashV1 = {
      v: SCHEMA_VERSION,
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
 * Read the stash on StartPage. Returns null if missing,
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
 * Clear the stash. Called on StartPage AFTER a successful
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
 * Has the /try/... cinematic already played for this tab? Returns
 * false on first call (cinematic should play); the consumer flips it
 * by calling markCinematicSeen() on cinematic complete or skip.
 */
export function hasCinematicSeen(): boolean {
  if (typeof window === "undefined") return true; // SSR: assume seen so we don't render the cinematic on a node render path.
  try {
    return window.sessionStorage.getItem(CINEMATIC_SEEN_KEY) === "1";
  } catch {
    return true; // private-mode storage error: don't replay on every nav.
  }
}

export function markCinematicSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CINEMATIC_SEEN_KEY, "1");
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
