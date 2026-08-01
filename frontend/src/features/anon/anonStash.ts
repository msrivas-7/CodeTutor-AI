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
const WORKSPACE_KEY = "codetutor.anonWorkspace";
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

// Phase 27-v2 Day 6: parallel flag for the WorkspaceCoach 6-step
// tour. Same sessionStorage scope/semantics as the cinematic flag.
// On dismiss, AnonLessonPage flips this AND propagates the truth
// into the stash's flags.workspaceCoachDone so post-signup lesson
// 2 doesn't re-fire the tour.
const COACH_SEEN_KEY = "codetutor.anonCoachSeen";

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

export interface AnonWorkspaceV1 {
  v: 1;
  courseId: "python-fundamentals";
  lessonId: "hello-world";
  files: Record<string, string>;
  stdin: string;
  result: import("../../types").RunResult | null;
  runError: string | null;
  completed: boolean;
  updatedAt: string;
}

export function writeAnonWorkspace(
  workspace: Omit<AnonWorkspaceV1, "v" | "updatedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({
        v: SCHEMA_VERSION,
        ...workspace,
        updatedAt: new Date().toISOString(),
      } satisfies AnonWorkspaceV1),
    );
  } catch {
    // The live workspace remains authoritative when storage is unavailable.
  }
}

export function readAnonWorkspace(): AnonWorkspaceV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnonWorkspaceV1>;
    if (
      parsed.v !== SCHEMA_VERSION ||
      parsed.courseId !== "python-fundamentals" ||
      parsed.lessonId !== "hello-world" ||
      !parsed.files ||
      typeof parsed.files !== "object" ||
      Object.values(parsed.files).some((value) => typeof value !== "string") ||
      typeof parsed.stdin !== "string" ||
      (parsed.runError !== null && typeof parsed.runError !== "string") ||
      (parsed.result !== null &&
        (typeof parsed.result !== "object" ||
          typeof parsed.result.stdout !== "string" ||
          typeof parsed.result.stderr !== "string" ||
          typeof parsed.result.exitCode !== "number" ||
          typeof parsed.result.durationMs !== "number" ||
          !["none", "compile", "runtime", "timeout", "system"].includes(
            String(parsed.result.errorType),
          ) ||
          !["compile", "run", "setup"].includes(String(parsed.result.stage)))) ||
      typeof parsed.completed !== "boolean" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed as AnonWorkspaceV1;
  } catch {
    return null;
  }
}

export function clearAnonWorkspace(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WORKSPACE_KEY);
  } catch {
    // Fail-soft, matching the one-shot handoff stash.
  }
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
 * Has the WorkspaceCoach 6-step tour already played for this tab?
 * Same semantics as hasCinematicSeen — false on first call (coach
 * should mount); flipped to true by markCoachSeenAnon() on dismiss.
 */
export function hasCoachSeenAnon(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(COACH_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markCoachSeenAnon(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(COACH_SEEN_KEY, "1");
  } catch {
    // Fail-soft.
  }
}

const CHOREOGRAPHY_DONE_KEY = "codetutor.anonChoreographyDone";

/**
 * Has the scripted Socratic walkthrough already played (greet → awaitRun →
 * celebrateRun → awaitEdit → praiseEditRun → awaitCheck → seed) for this
 * tab? Mirrors the cinematic + coach flag pattern. Phase 27-v2.1 Part 3
 * audit pass 1 found that without this flag, a /try/ reload mid-lesson
 * (or post-lesson, pre-signup) re-fires the choreography from "greet" —
 * wiping Maya's tutor history via clearConversation() and replaying the
 * auto-Run. This flag is set when the choreography reaches the "seed"
 * step (the natural end of the walkthrough); the post-signup handoff
 * stash carries `welcomeDone=true` independently to suppress the
 * choreography on lesson 2.
 */
export function hasChoreographyDoneAnon(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(CHOREOGRAPHY_DONE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markChoreographyDoneAnon(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CHOREOGRAPHY_DONE_KEY, "1");
  } catch {
    // Fail-soft.
  }
}

/**
 * Parse the learner's name out of their main.py. Returns the literal
 * between the quotes if a match is found and it's not a known
 * placeholder sentinel; null otherwise. Used by AnonLessonPage at
 * lesson completion to populate the `name` field of the stash, and
 * by useFirstRunChoreography to personalize the praise turn.
 *
 * Two patterns are supported, in priority order:
 *   1. Phase A — A1 starter shape: `print("Hello, NAME!")` (the new
 *      empty-shell starter pushes the learner directly to a print
 *      call — no intermediate variable).
 *   2. Pre-Phase-A starter shape: `name = "NAME"` (kept for learners
 *      who happen to introduce a variable first, and as a fallback
 *      for any other lesson that follows the variable convention).
 *
 * Why server-side too? It isn't — this parser runs purely on the
 * client at stash-time. The handoff endpoint trusts whatever name
 * arrives in the body (length-bounded). If a user crafts a name in
 * their code that bypasses the parser, the worst case is that
 * `Hey there` shows on lesson 2 instead of `Hey Maya` — bounded.
 */
export function extractNameFromCode(code: string): string | null {
  // Strip Python line comments before matching — the lesson 1 starter
  // comments out a `print("Hello, Maya!")` example, and a naive regex
  // would find that example before the learner's actual code. Splitting
  // on lines and keeping only the part before the first `#` is enough
  // here (we don't need to handle # inside strings — the lesson 1
  // teaching shape doesn't use that).
  const stripped = code
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return hash >= 0 ? line.slice(0, hash) : line;
    })
    .join("\n");

  // Try the Phase A starter shape first — `print("Hello, X!")`.
  // Whitespace variants and either quote style. Captures everything
  // between "Hello, " and "!" (1–40 chars, no newlines/quotes).
  const printMatch =
    /\bprint\s*\(\s*['"]\s*Hello,\s*([^'"\n!]{1,40})\s*!\s*['"]/.exec(stripped);
  if (printMatch) {
    const candidate = printMatch[1]!.trim();
    if (candidate && !isPlaceholderName(candidate)) return candidate;
  }

  // Fall back to the variable-assignment shape — `name = "X"`. We only
  // consider the first assignment — if the user reassigns later,
  // that's beyond first-run scope.
  const varMatch = /\bname\s*=\s*['"]([^'"]{1,40})['"]/.exec(stripped);
  if (varMatch) {
    const candidate = varMatch[1]!.trim();
    if (candidate && !isPlaceholderName(candidate)) return candidate;
  }

  return null;
}

// Names that signal "the learner did not actually personalize." YOUR_NAME
// is the historical placeholder sentinel from the pre-Phase-A starter.
// World is rejected because the lesson's `forbidden_in_stdout` rule
// would also reject it — keeping the praise-turn extractor and the
// validator in sync. Maya is the placeholder name shown in the new
// starter's comment example, but a learner whose actual name is Maya
// is reasonably common; we trust it through and accept the rare case
// where a copy-the-example learner gets a personalized "Perfect, Maya."
function isPlaceholderName(candidate: string): boolean {
  const upper = candidate.toUpperCase();
  return upper === "YOUR_NAME" || upper === "WORLD";
}
