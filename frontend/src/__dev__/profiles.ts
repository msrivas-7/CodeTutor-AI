// Dev-only profile seed definitions. Stripped from production by
// import.meta.env.DEV dead-code elimination.
//
// Each profile returns a map of localStorage key → serialized value. Applying
// the profile wipes all CodeTutor-owned keys (allow-list in applyProfile.ts)
// and writes the seed. Frozen profiles re-apply on every page load via the
// pre-hydration bootstrap; sandbox persists.

import type { CourseProgress, LearnerIdentity, LessonProgress } from "../features/learning/types";

export interface DevProfile {
  id: string;
  label: string;
  description: string;
  frozen: boolean;
  seedStorage(): Record<string, string>;
}

const COURSE_ID = "python-fundamentals";

const LESSONS = [
  "hello-world",
  "variables",
  "input-output",
  "conditionals",
  "loops",
  "functions",
  "lists",
  "dictionaries",
  "debugging-basics",
  "mini-project",
  "capstone-word-frequency",
  "capstone-task-tracker",
] as const;

function iso(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

function fakeLearner(): LearnerIdentity {
  return {
    learnerId: "dev-profile-learner",
    createdAt: iso(30),
    isAnonymous: true,
  };
}

function courseKey(): string {
  return `learner:v1:progress:${COURSE_ID}`;
}

function lessonKey(lessonId: string): string {
  return `learner:v1:lesson:${COURSE_ID}:${lessonId}`;
}

function baseLessonProgress(
  lessonId: string,
  overrides: Partial<LessonProgress> = {},
): LessonProgress {
  return {
    learnerId: "dev-profile-learner",
    courseId: COURSE_ID,
    lessonId,
    status: "not_started",
    startedAt: null,
    updatedAt: iso(0),
    completedAt: null,
    attemptCount: 0,
    runCount: 0,
    hintCount: 0,
    lastCode: null,
    lastOutput: null,
    ...overrides,
  };
}

function completedLesson(
  lessonId: string,
  overrides: Partial<LessonProgress> = {},
): LessonProgress {
  return baseLessonProgress(lessonId, {
    status: "completed",
    startedAt: iso(2),
    completedAt: iso(1),
    attemptCount: 1,
    runCount: 3,
    timeSpentMs: 8 * 60_000,
    ...overrides,
  });
}

function courseProgress(
  completedIds: string[],
  lastLessonId: string | null = null,
): CourseProgress {
  const total = LESSONS.length;
  const allDone = completedIds.length >= total;
  return {
    learnerId: "dev-profile-learner",
    courseId: COURSE_ID,
    status:
      completedIds.length === 0 ? "not_started" : allDone ? "completed" : "in_progress",
    startedAt: completedIds.length > 0 ? iso(7) : null,
    updatedAt: iso(0),
    completedAt: allDone ? iso(0) : null,
    lastLessonId,
    completedLessonIds: completedIds,
  };
}

function onboardingAllDone(): Record<string, string> {
  return {
    "onboarding:v1:welcome-done": "1",
    "onboarding:v1:workspace-done": "1",
    "onboarding:v1:editor-done": "1",
  };
}

// Known practice-exercise IDs per lesson. Used by the all-complete profile so
// the course-overview practice bar shows fully green. Keys omitted for lessons
// that don't have practice.
const PRACTICE_IDS: Record<string, string[]> = {
  "hello-world": ["rename-greeter", "two-lines", "exclamation"],
  "variables": ["swap-values", "area-of-rectangle", "celsius-to-fahrenheit"],
  "input-output": ["greet-by-name", "add-two-numbers", "echo-upper"],
  "conditionals": ["fizzbuzz-small", "sign-of-number", "leap-year"],
  "loops": ["countdown", "sum-to-n", "multiplication-table"],
  "functions": ["is-even", "square-area", "max-of-three"],
  "lists": ["reverse-list", "unique-items", "running-total"],
  "dictionaries": ["invert-dict", "letter-count", "merge-counts"],
  "debugging-basics": ["fix-off-by-one", "fix-type-error", "fix-name-error"],
  "mini-project": ["longest-word", "unique-words", "max-frequency"],
  "capstone-word-frequency": ["longest-word", "unique-words", "max-frequency"],
  "capstone-task-tracker": ["list-pending", "rename-task", "count-done"],
};

// Pre-seeded broken code for capstone-first-fail. tokenize is correct; but
// count_words returns a list of tuples instead of a dict — triggers a single
// visible test failure on the "count_words sums repeats" test, leaving the
// rest of the visible tests passing. Gives the learner a one-failure-at-a-time
// scenario to test FailedTestCallout + the 2nd-fail "Ask tutor why" gate.
const CAPSTONE_BROKEN_CODE = `# Capstone: Word Frequency Counter
import sys


def tokenize(text):
    out = []
    for w in text.lower().split():
        for ch in ".,!?;:":
            w = w.replace(ch, "")
        if w:
            out.append(w)
    return out


def count_words(words):
    # BUG: returns a list of tuples instead of a dict
    counts = []
    seen = set()
    for w in words:
        if w not in seen:
            counts.append((w, words.count(w)))
            seen.add(w)
    return counts


def top_n(counts, n):
    items = sorted(counts, key=lambda kv: (-kv[1], kv[0]))
    return items[:n]


text = sys.stdin.read()
words = tokenize(text)
counts = count_words(words)
top = top_n(counts, 3)

print(f"Total words: {len(words)}")
print(f"Unique words: {len(counts)}")
print("Top 3:")
for w, c in top:
    print(f"{w}: {c}")
`;

export const PROFILES: DevProfile[] = [
  {
    id: "fresh-install",
    label: "Fresh install",
    description:
      "Brand-new user. No identity, no onboarding flags, no progress. Welcome spotlight → dashboard banner → lesson 1 nudge → workspace tour all fire cold.",
    frozen: true,
    seedStorage: () => ({}),
  },
  {
    id: "welcomed-not-started",
    label: "Welcomed, not started",
    description:
      "Onboarding flags all dismissed, zero lessons touched. Dashboard should show the 'Ready to start coding?' banner on top.",
    frozen: true,
    seedStorage: () => ({
      "learner:v1:identity": JSON.stringify(fakeLearner()),
      ...onboardingAllDone(),
    }),
  },
  {
    id: "first-lesson-editing",
    label: "Editing lesson 1, never ran",
    description:
      "On hello-world with one edit saved, never ran it. Resume indicator should show; CoachRail edited-no-run fires after ~45s idle.",
    frozen: true,
    seedStorage: () => ({
      "learner:v1:identity": JSON.stringify(fakeLearner()),
      ...onboardingAllDone(),
      [courseKey()]: JSON.stringify(courseProgress([], "hello-world")),
      [lessonKey("hello-world")]: JSON.stringify(
        baseLessonProgress("hello-world", {
          status: "in_progress",
          startedAt: iso(0),
          attemptCount: 1,
          lastCode: { "main.py": "print('hello from dev profile')\n" },
        }),
      ),
    }),
  },
  {
    id: "mid-course-healthy",
    label: "Mid-course (5 done, on lesson 6)",
    description:
      "Lessons 1–5 complete cleanly with short times. Currently on functions. Dashboard shows happy progress + Next Up + recent activity.",
    frozen: true,
    seedStorage: () => {
      const completed = LESSONS.slice(0, 5);
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey()]: JSON.stringify(courseProgress([...completed], "functions")),
        [lessonKey("functions")]: JSON.stringify(
          baseLessonProgress("functions", {
            status: "in_progress",
            startedAt: iso(0),
            attemptCount: 1,
          }),
        ),
      };
      for (const id of completed) {
        entries[lessonKey(id)] = JSON.stringify(completedLesson(id));
      }
      return entries;
    },
  },
  {
    id: "stuck-on-lesson",
    label: "Stuck on lesson 4",
    description:
      "On conditionals with 5 attempts, 8 runs, some saved code. Opening the lesson + clicking Check a few times triggers the many-fails CoachRail nudge.",
    frozen: true,
    seedStorage: () => {
      const completed = ["hello-world", "variables", "input-output"];
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey()]: JSON.stringify(courseProgress(completed, "conditionals")),
        [lessonKey("conditionals")]: JSON.stringify(
          baseLessonProgress("conditionals", {
            status: "in_progress",
            startedAt: iso(0),
            attemptCount: 5,
            runCount: 8,
            hintCount: 1,
            lastCode: {
              "main.py":
                "# still figuring out conditionals\nage = int(input())\nif age > 0:\n  print('valid')\n",
            },
          }),
        ),
      };
      for (const id of completed) {
        entries[lessonKey(id)] = JSON.stringify(completedLesson(id));
      }
      return entries;
    },
  },
  {
    id: "needs-help-dashboard",
    label: "Needs help (shaky mastery)",
    description:
      "5 lessons completed — 3 of them with shaky metrics (high attempts, many hints, 2× time). Dashboard Review card should show exactly 3 entries with reason pills.",
    frozen: true,
    seedStorage: () => {
      // Shaky thresholds (from mastery.ts): attempts > 2, hints ≥ 3, time > 2× estimated.
      // hello-world est=10m → 2× = 20m. variables est=15m → 30m. input-output est=15m → 30m.
      const shaky: Record<string, LessonProgress> = {
        "hello-world": completedLesson("hello-world", {
          attemptCount: 4,
          hintCount: 4,
          runCount: 12,
          timeSpentMs: 25 * 60_000,
        }),
        variables: completedLesson("variables", {
          attemptCount: 3,
          hintCount: 5,
          runCount: 15,
          timeSpentMs: 42 * 60_000,
        }),
        "input-output": completedLesson("input-output", {
          attemptCount: 5,
          hintCount: 3,
          runCount: 18,
          timeSpentMs: 38 * 60_000,
        }),
      };
      const clean: Record<string, LessonProgress> = {
        conditionals: completedLesson("conditionals"),
        loops: completedLesson("loops"),
      };
      const completedIds = [...Object.keys(shaky), ...Object.keys(clean)];
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey()]: JSON.stringify(courseProgress(completedIds, "functions")),
      };
      for (const [id, lp] of Object.entries({ ...shaky, ...clean })) {
        entries[lessonKey(id)] = JSON.stringify(lp);
      }
      return entries;
    },
  },
  {
    id: "capstones-pending",
    label: "Capstones pending",
    description:
      "All 10 primary lessons done (through mini-project). Both capstones untouched. Land on capstone-word-frequency cold to test the Run examples flow.",
    frozen: true,
    seedStorage: () => {
      const completed = LESSONS.slice(0, 10);
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey()]: JSON.stringify(
          courseProgress([...completed], "capstone-word-frequency"),
        ),
      };
      for (const id of completed) {
        entries[lessonKey(id)] = JSON.stringify(completedLesson(id));
      }
      return entries;
    },
  },
  {
    id: "capstone-first-fail",
    label: "Capstone with one failing test",
    description:
      "On capstone-word-frequency with a partial solution pre-loaded. tokenize works; count_words returns a list of tuples instead of a dict — produces exactly one visible-test failure. Click Check My Work twice to test the 2nd-fail 'Ask tutor why' gate.",
    frozen: true,
    seedStorage: () => {
      const completed = LESSONS.slice(0, 10);
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey()]: JSON.stringify(
          courseProgress([...completed], "capstone-word-frequency"),
        ),
        [lessonKey("capstone-word-frequency")]: JSON.stringify(
          baseLessonProgress("capstone-word-frequency", {
            status: "in_progress",
            startedAt: iso(0),
            attemptCount: 2,
            runCount: 3,
            lastCode: { "main.py": CAPSTONE_BROKEN_CODE },
          }),
        ),
      };
      for (const id of completed) {
        entries[lessonKey(id)] = JSON.stringify(completedLesson(id));
      }
      return entries;
    },
  },
  {
    id: "all-complete",
    label: "All complete",
    description:
      "Every lesson + every practice exercise done. Dashboard all-green, celebration replay on revisit, LessonList shows all ✓.",
    frozen: true,
    seedStorage: () => {
      const completed = [...LESSONS];
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey()]: JSON.stringify(
          courseProgress(completed, completed[completed.length - 1]),
        ),
      };
      for (const id of completed) {
        entries[lessonKey(id)] = JSON.stringify(
          completedLesson(id, {
            practiceCompletedIds: PRACTICE_IDS[id] ?? [],
          }),
        );
      }
      return entries;
    },
  },
  {
    id: "sandbox",
    label: "Sandbox (persistent)",
    description:
      "Free-play mode. Starts clean; changes persist across reloads under a dedicated snapshot slot. Use this for multi-step walkthroughs that should accumulate real progress without being wiped.",
    frozen: false,
    seedStorage: () => ({
      "learner:v1:identity": JSON.stringify(fakeLearner()),
    }),
  },
];

export function profileById(id: string): DevProfile | null {
  return PROFILES.find((p) => p.id === id) ?? null;
}
