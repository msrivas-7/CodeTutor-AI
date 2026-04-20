// Dev-only profile seed definitions. Stripped from production by
// import.meta.env.DEV dead-code elimination.
//
// Each profile returns a map of localStorage key → serialized value. Applying
// the profile wipes all CodeTutor-owned keys (allow-list in applyProfile.ts)
// and writes the seed. Frozen profiles re-apply on every page load via the
// pre-hydration bootstrap; sandbox persists.
//
// Polyglot seeding: aggregate-state profiles (mid-course, needs-help,
// capstones-pending, all-complete) seed state for BOTH Python and JavaScript
// courses so the dashboard, review card, and celebration replay all exercise
// multi-course rendering. Narrative-specific profiles (first-lesson-editing,
// stuck-on-lesson, capstone-first-fail) remain Python-only because their
// stories are tied to a specific Python lesson — that's called out in each
// label/description so screenshot authors pick the right profile.

import type { CourseProgress, LearnerIdentity, LessonProgress } from "../features/learning/types";

export interface DevProfile {
  id: string;
  label: string;
  description: string;
  frozen: boolean;
  seedStorage(): Record<string, string>;
}

const PYTHON_COURSE_ID = "python-fundamentals";
const JS_COURSE_ID = "javascript-fundamentals";

const PYTHON_LESSONS = [
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

const JS_LESSONS = [
  "hello-print",
  "variables-and-strings",
  "conditionals",
  "loops",
  "functions-basics",
  "arrays-basics",
  "objects-basics",
  "mini-project",
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

function courseKey(courseId: string): string {
  return `learner:v1:progress:${courseId}`;
}

function lessonKey(courseId: string, lessonId: string): string {
  return `learner:v1:lesson:${courseId}:${lessonId}`;
}

function baseLessonProgress(
  courseId: string,
  lessonId: string,
  overrides: Partial<LessonProgress> = {},
): LessonProgress {
  return {
    learnerId: "dev-profile-learner",
    courseId,
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
  courseId: string,
  lessonId: string,
  overrides: Partial<LessonProgress> = {},
): LessonProgress {
  return baseLessonProgress(courseId, lessonId, {
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
  courseId: string,
  totalLessons: number,
  completedIds: string[],
  lastLessonId: string | null = null,
): CourseProgress {
  const allDone = completedIds.length >= totalLessons;
  return {
    learnerId: "dev-profile-learner",
    courseId,
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
// that don't have practice (capstones + mini-project in JS).
const PYTHON_PRACTICE_IDS: Record<string, string[]> = {
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

const JS_PRACTICE_IDS: Record<string, string[]> = {
  "hello-print": ["two-lines", "quotes-inside", "ascii-art"],
  "variables-and-strings": ["full-name", "two-times-price", "counter-step"],
  "conditionals": ["sign-of-number", "leap-year", "fizzbuzz-one"],
  "loops": ["sum-to-ten", "evens-one-to-twenty", "countdown"],
  "functions-basics": ["square-function", "max-of-two", "is-even"],
  "arrays-basics": ["positives-only", "count-starts-with-a", "max-in-array"],
  "objects-basics": ["word-count", "price-sum", "has-key"],
  // mini-project has no practice exercises.
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
    label: "Editing Python lesson 1 (hello-world)",
    description:
      "Python-course narrative: on hello-world with one edit saved, never ran it. Resume indicator should show; CoachRail edited-no-run fires after ~45s idle.",
    frozen: true,
    seedStorage: () => ({
      "learner:v1:identity": JSON.stringify(fakeLearner()),
      ...onboardingAllDone(),
      [courseKey(PYTHON_COURSE_ID)]: JSON.stringify(
        courseProgress(PYTHON_COURSE_ID, PYTHON_LESSONS.length, [], "hello-world"),
      ),
      [lessonKey(PYTHON_COURSE_ID, "hello-world")]: JSON.stringify(
        baseLessonProgress(PYTHON_COURSE_ID, "hello-world", {
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
    label: "Mid-course in both Python & JS",
    description:
      "Python 1–5 + JS 1–3 complete cleanly. Currently on Python `functions` and JS `loops`. Dashboard shows two in-progress courses with happy progress bars + Next Up + recent activity.",
    frozen: true,
    seedStorage: () => {
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
      };

      // Python — lessons 1-5 complete, on lesson 6 (functions).
      const pyCompleted = PYTHON_LESSONS.slice(0, 5);
      entries[courseKey(PYTHON_COURSE_ID)] = JSON.stringify(
        courseProgress(PYTHON_COURSE_ID, PYTHON_LESSONS.length, [...pyCompleted], "functions"),
      );
      entries[lessonKey(PYTHON_COURSE_ID, "functions")] = JSON.stringify(
        baseLessonProgress(PYTHON_COURSE_ID, "functions", {
          status: "in_progress",
          startedAt: iso(0),
          attemptCount: 1,
        }),
      );
      for (const id of pyCompleted) {
        entries[lessonKey(PYTHON_COURSE_ID, id)] = JSON.stringify(
          completedLesson(PYTHON_COURSE_ID, id),
        );
      }

      // JS — lessons 1-3 complete, on lesson 4 (loops).
      const jsCompleted = JS_LESSONS.slice(0, 3);
      entries[courseKey(JS_COURSE_ID)] = JSON.stringify(
        courseProgress(JS_COURSE_ID, JS_LESSONS.length, [...jsCompleted], "loops"),
      );
      entries[lessonKey(JS_COURSE_ID, "loops")] = JSON.stringify(
        baseLessonProgress(JS_COURSE_ID, "loops", {
          status: "in_progress",
          startedAt: iso(0),
          attemptCount: 1,
        }),
      );
      for (const id of jsCompleted) {
        entries[lessonKey(JS_COURSE_ID, id)] = JSON.stringify(
          completedLesson(JS_COURSE_ID, id),
        );
      }

      return entries;
    },
  },
  {
    id: "stuck-on-lesson",
    label: "Stuck on Python lesson 4 (conditionals)",
    description:
      "Python-course narrative: on conditionals with 5 attempts, 8 runs, some saved code. Opening the lesson + clicking Check a few times triggers the many-fails CoachRail nudge.",
    frozen: true,
    seedStorage: () => {
      const completed = ["hello-world", "variables", "input-output"];
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey(PYTHON_COURSE_ID)]: JSON.stringify(
          courseProgress(PYTHON_COURSE_ID, PYTHON_LESSONS.length, completed, "conditionals"),
        ),
        [lessonKey(PYTHON_COURSE_ID, "conditionals")]: JSON.stringify(
          baseLessonProgress(PYTHON_COURSE_ID, "conditionals", {
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
        entries[lessonKey(PYTHON_COURSE_ID, id)] = JSON.stringify(
          completedLesson(PYTHON_COURSE_ID, id),
        );
      }
      return entries;
    },
  },
  {
    id: "needs-help-dashboard",
    label: "Needs help (shaky mastery)",
    description:
      "Python: 5 lessons done — 3 shaky (high attempts, many hints, 2× time). JS: 2 early lessons cleanly done. Dashboard Review card should show exactly 3 entries (all Python) with reason pills.",
    frozen: true,
    seedStorage: () => {
      // Shaky thresholds (from mastery.ts): attempts > 2, hints ≥ 3, time > 2× estimated.
      // hello-world est=10m → 2× = 20m. variables est=15m → 30m. input-output est=15m → 30m.
      const pyShaky: Record<string, LessonProgress> = {
        "hello-world": completedLesson(PYTHON_COURSE_ID, "hello-world", {
          attemptCount: 4,
          hintCount: 4,
          runCount: 12,
          timeSpentMs: 25 * 60_000,
        }),
        variables: completedLesson(PYTHON_COURSE_ID, "variables", {
          attemptCount: 3,
          hintCount: 5,
          runCount: 15,
          timeSpentMs: 42 * 60_000,
        }),
        "input-output": completedLesson(PYTHON_COURSE_ID, "input-output", {
          attemptCount: 5,
          hintCount: 3,
          runCount: 18,
          timeSpentMs: 38 * 60_000,
        }),
      };
      const pyClean: Record<string, LessonProgress> = {
        conditionals: completedLesson(PYTHON_COURSE_ID, "conditionals"),
        loops: completedLesson(PYTHON_COURSE_ID, "loops"),
      };
      const pyCompletedIds = [...Object.keys(pyShaky), ...Object.keys(pyClean)];
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey(PYTHON_COURSE_ID)]: JSON.stringify(
          courseProgress(PYTHON_COURSE_ID, PYTHON_LESSONS.length, pyCompletedIds, "functions"),
        ),
      };
      for (const [id, lp] of Object.entries({ ...pyShaky, ...pyClean })) {
        entries[lessonKey(PYTHON_COURSE_ID, id)] = JSON.stringify(lp);
      }

      // JS — two clean early lessons so the multi-course dashboard isn't empty
      // on the JS side, but no JS lesson hits the shaky thresholds (keeps the
      // review card's "exactly 3 Python lessons" expectation stable).
      const jsCompleted = ["hello-print", "variables-and-strings"];
      entries[courseKey(JS_COURSE_ID)] = JSON.stringify(
        courseProgress(JS_COURSE_ID, JS_LESSONS.length, jsCompleted, "conditionals"),
      );
      for (const id of jsCompleted) {
        entries[lessonKey(JS_COURSE_ID, id)] = JSON.stringify(
          completedLesson(JS_COURSE_ID, id),
        );
      }

      return entries;
    },
  },
  {
    id: "capstones-pending",
    label: "Capstones pending (JS finished)",
    description:
      "Python: all 10 primary lessons done (through mini-project), both capstones untouched — land on capstone-word-frequency cold to test Run examples. JS: fully complete (all 8 lessons) so the dashboard shows one complete + one in-progress course side by side.",
    frozen: true,
    seedStorage: () => {
      const pyCompleted = PYTHON_LESSONS.slice(0, 10);
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey(PYTHON_COURSE_ID)]: JSON.stringify(
          courseProgress(
            PYTHON_COURSE_ID,
            PYTHON_LESSONS.length,
            [...pyCompleted],
            "capstone-word-frequency",
          ),
        ),
      };
      for (const id of pyCompleted) {
        entries[lessonKey(PYTHON_COURSE_ID, id)] = JSON.stringify(
          completedLesson(PYTHON_COURSE_ID, id),
        );
      }

      // JS course fully complete.
      const jsCompleted = [...JS_LESSONS];
      entries[courseKey(JS_COURSE_ID)] = JSON.stringify(
        courseProgress(
          JS_COURSE_ID,
          JS_LESSONS.length,
          jsCompleted,
          jsCompleted[jsCompleted.length - 1],
        ),
      );
      for (const id of jsCompleted) {
        entries[lessonKey(JS_COURSE_ID, id)] = JSON.stringify(
          completedLesson(JS_COURSE_ID, id),
        );
      }

      return entries;
    },
  },
  {
    id: "capstone-first-fail",
    label: "Python capstone with one failing test",
    description:
      "Python-course narrative: on capstone-word-frequency with a partial solution pre-loaded. tokenize works; count_words returns a list of tuples instead of a dict — produces exactly one visible-test failure. Click Check My Work twice to test the 2nd-fail 'Ask tutor why' gate.",
    frozen: true,
    seedStorage: () => {
      const completed = PYTHON_LESSONS.slice(0, 10);
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
        [courseKey(PYTHON_COURSE_ID)]: JSON.stringify(
          courseProgress(
            PYTHON_COURSE_ID,
            PYTHON_LESSONS.length,
            [...completed],
            "capstone-word-frequency",
          ),
        ),
        [lessonKey(PYTHON_COURSE_ID, "capstone-word-frequency")]: JSON.stringify(
          baseLessonProgress(PYTHON_COURSE_ID, "capstone-word-frequency", {
            status: "in_progress",
            startedAt: iso(0),
            attemptCount: 2,
            runCount: 3,
            lastCode: { "main.py": CAPSTONE_BROKEN_CODE },
          }),
        ),
      };
      for (const id of completed) {
        entries[lessonKey(PYTHON_COURSE_ID, id)] = JSON.stringify(
          completedLesson(PYTHON_COURSE_ID, id),
        );
      }
      return entries;
    },
  },
  {
    id: "all-complete",
    label: "All complete (both courses)",
    description:
      "Every lesson + every practice exercise done across Python AND JavaScript. Dashboard all-green for both courses, celebration replay on revisit, LessonList shows all ✓.",
    frozen: true,
    seedStorage: () => {
      const entries: Record<string, string> = {
        "learner:v1:identity": JSON.stringify(fakeLearner()),
        ...onboardingAllDone(),
      };

      // Python course fully complete.
      const pyCompleted = [...PYTHON_LESSONS];
      entries[courseKey(PYTHON_COURSE_ID)] = JSON.stringify(
        courseProgress(
          PYTHON_COURSE_ID,
          PYTHON_LESSONS.length,
          pyCompleted,
          pyCompleted[pyCompleted.length - 1],
        ),
      );
      for (const id of pyCompleted) {
        entries[lessonKey(PYTHON_COURSE_ID, id)] = JSON.stringify(
          completedLesson(PYTHON_COURSE_ID, id, {
            practiceCompletedIds: PYTHON_PRACTICE_IDS[id] ?? [],
          }),
        );
      }

      // JS course fully complete.
      const jsCompleted = [...JS_LESSONS];
      entries[courseKey(JS_COURSE_ID)] = JSON.stringify(
        courseProgress(
          JS_COURSE_ID,
          JS_LESSONS.length,
          jsCompleted,
          jsCompleted[jsCompleted.length - 1],
        ),
      );
      for (const id of jsCompleted) {
        entries[lessonKey(JS_COURSE_ID, id)] = JSON.stringify(
          completedLesson(JS_COURSE_ID, id, {
            practiceCompletedIds: JS_PRACTICE_IDS[id] ?? [],
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
