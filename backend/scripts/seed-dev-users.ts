// Dev-only: seed a handful of real Supabase users in `codetutor-dev` with
// different progress states so manual QA can log in and land on a specific
// surface without clicking through a fresh signup every time.
//
// Replaces the Phase 17 `__dev__/profiles.ts` localStorage seeder — now that
// state lives in Postgres (Phase 18b), the equivalent is: real auth.users
// rows + upserted user_preferences / course_progress / lesson_progress.
//
// Safety:
//   * Loads creds from ../../.env, which holds the codetutor-dev bundle.
//   * Requires ALLOW_DEV_SEED=yes every run. No default. Prints the target
//     Supabase URL before writing so the operator can bail.
//   * Refuses if SUPABASE_URL contains "prod".
//   * Password read from DEV_SEED_PASSWORD (gitignored .env). Rotate by
//     changing the env value and re-running — every user is re-stamped.
//
// Run:
//   cd backend
//   ALLOW_DEV_SEED=yes npx tsx scripts/seed-dev-users.ts
//
// Idempotent: re-running wipes each seeded user's progress rows and re-applies
// them. auth.users rows are upserted (created on first run, password + metadata
// reset on subsequent runs).

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

// ─── Scenario data ───────────────────────────────────────────────────────────

const PYTHON = "python-fundamentals";
const JS = "javascript-fundamentals";

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

// Broken capstone code — tokenize works, count_words returns a list of tuples
// instead of a dict. Triggers exactly one visible-test failure on
// "count_words sums repeats" so user4 lands in the 2nd-fail "Ask tutor why"
// scenario after two Check My Work clicks.
const CAPSTONE_BROKEN = `# Capstone: Word Frequency Counter
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

interface LessonSeed {
  status: "in_progress" | "completed";
  attemptCount?: number;
  runCount?: number;
  hintCount?: number;
  timeSpentMs?: number;
  lastCode?: Record<string, string>;
}

interface CourseSeed {
  courseId: string;
  status: "in_progress" | "completed";
  completedLessons: readonly string[];
  lastLessonId?: string;
}

interface LessonEntry {
  courseId: string;
  lessonId: string;
  seed: LessonSeed;
}

interface Scenario {
  email: string;
  firstName: string;
  lastName: string;
  label: string;
  preferences: {
    welcomeDone?: boolean;
    workspaceDone?: boolean;
    editorDone?: boolean;
    theme?: "dark" | "light" | "system";
    persona?: "beginner" | "intermediate" | "advanced";
  };
  courses: CourseSeed[];
  lessons: LessonEntry[];
}

function completed(
  courseId: string,
  ids: readonly string[],
  overrides: Partial<LessonSeed> = {},
): LessonEntry[] {
  return ids.map((lessonId) => ({
    courseId,
    lessonId,
    seed: {
      status: "completed",
      attemptCount: 1,
      runCount: 3,
      timeSpentMs: 8 * 60_000,
      ...overrides,
    },
  }));
}

const ONBOARDING_DONE = {
  welcomeDone: true,
  workspaceDone: true,
  editorDone: true,
} as const;

const SCENARIOS: Scenario[] = [
  {
    email: "user1@test.com",
    firstName: "Test",
    lastName: "User 1",
    label: "Fresh — no onboarding, no progress",
    preferences: {},
    courses: [],
    lessons: [],
  },
  {
    email: "user2@test.com",
    firstName: "Test",
    lastName: "User 2",
    label: "Mid-course — Python 1-5 + JS 1-3 done, on Python functions & JS loops",
    preferences: ONBOARDING_DONE,
    courses: [
      {
        courseId: PYTHON,
        status: "in_progress",
        completedLessons: PYTHON_LESSONS.slice(0, 5),
        lastLessonId: "functions",
      },
      {
        courseId: JS,
        status: "in_progress",
        completedLessons: JS_LESSONS.slice(0, 3),
        lastLessonId: "loops",
      },
    ],
    lessons: [
      ...completed(PYTHON, PYTHON_LESSONS.slice(0, 5)),
      {
        courseId: PYTHON,
        lessonId: "functions",
        seed: { status: "in_progress", attemptCount: 1 },
      },
      ...completed(JS, JS_LESSONS.slice(0, 3)),
      {
        courseId: JS,
        lessonId: "loops",
        seed: { status: "in_progress", attemptCount: 1 },
      },
    ],
  },
  {
    email: "user3@test.com",
    firstName: "Test",
    lastName: "User 3",
    label: "Stuck on Python conditionals — 5 attempts, triggers many-fails coach",
    preferences: ONBOARDING_DONE,
    courses: [
      {
        courseId: PYTHON,
        status: "in_progress",
        completedLessons: ["hello-world", "variables", "input-output"],
        lastLessonId: "conditionals",
      },
    ],
    lessons: [
      ...completed(PYTHON, ["hello-world", "variables", "input-output"]),
      {
        courseId: PYTHON,
        lessonId: "conditionals",
        seed: {
          status: "in_progress",
          attemptCount: 5,
          runCount: 8,
          hintCount: 1,
          lastCode: {
            "main.py":
              "# still figuring out conditionals\nage = int(input())\nif age > 0:\n  print('valid')\n",
          },
        },
      },
    ],
  },
  {
    email: "user4@test.com",
    firstName: "Test",
    lastName: "User 4",
    label: "Capstone with broken count_words — tests FailedTestCallout + Ask-tutor-why gate",
    preferences: ONBOARDING_DONE,
    courses: [
      {
        courseId: PYTHON,
        status: "in_progress",
        completedLessons: PYTHON_LESSONS.slice(0, 10),
        lastLessonId: "capstone-word-frequency",
      },
    ],
    lessons: [
      ...completed(PYTHON, PYTHON_LESSONS.slice(0, 10)),
      {
        courseId: PYTHON,
        lessonId: "capstone-word-frequency",
        seed: {
          status: "in_progress",
          attemptCount: 2,
          runCount: 3,
          lastCode: { "main.py": CAPSTONE_BROKEN },
        },
      },
    ],
  },
  {
    email: "user5@test.com",
    firstName: "Test",
    lastName: "User 5",
    label: "Both courses fully complete — celebration replay, all-✓ LessonList",
    preferences: ONBOARDING_DONE,
    courses: [
      {
        courseId: PYTHON,
        status: "completed",
        completedLessons: [...PYTHON_LESSONS],
        lastLessonId: PYTHON_LESSONS[PYTHON_LESSONS.length - 1],
      },
      {
        courseId: JS,
        status: "completed",
        completedLessons: [...JS_LESSONS],
        lastLessonId: JS_LESSONS[JS_LESSONS.length - 1],
      },
    ],
    lessons: [
      ...completed(PYTHON, PYTHON_LESSONS),
      ...completed(JS, JS_LESSONS),
    ],
  },
];

// ─── Supabase admin API (raw fetch — no @supabase/supabase-js dep) ───────────

type AdminUser = { id: string; email: string };

async function supabaseAdminUpsertUser(
  url: string,
  serviceKey: string,
  email: string,
  password: string,
  userMetadata: Record<string, string>,
): Promise<string> {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    }),
  });
  if (createRes.ok) {
    const body = (await createRes.json()) as AdminUser;
    return body.id;
  }

  // 422/400 + "already registered" → fall through to update path.
  const errBody = await createRes.text();
  const alreadyExists =
    (createRes.status === 422 || createRes.status === 400) &&
    /already|registered|exists/i.test(errBody);
  if (!alreadyExists) {
    throw new Error(
      `createUser(${email}) failed: HTTP ${createRes.status} — ${errBody}`,
    );
  }

  // Existing accounts may be beyond the first page once E2E has created
  // enough ephemeral users. Walk the bounded Admin API result set instead
  // of assuming the five named fixtures are among the first 200 records.
  const perPage = 200;
  let found: AdminUser | undefined;
  for (let page = 1; page <= 100 && !found; page += 1) {
    const listRes = await fetch(
      `${url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers },
    );
    if (!listRes.ok) {
      throw new Error(`listUsers(page=${page}) failed: HTTP ${listRes.status}`);
    }
    const { users } = (await listRes.json()) as { users: AdminUser[] };
    found = users.find((u) => u.email === email);
    if (users.length < perPage) break;
  }
  if (!found) {
    throw new Error(
      `Admin API said ${email} exists, but listUsers couldn't find it. ` +
        `Check the project's emailed rate limits or Admin API visibility.`,
    );
  }

  // Reset password + metadata so state stays consistent across reruns.
  const updateRes = await fetch(`${url}/auth/v1/admin/users/${found.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    }),
  });
  if (!updateRes.ok) {
    const body = await updateRes.text();
    throw new Error(
      `updateUser(${email}) failed: HTTP ${updateRes.status} — ${body}`,
    );
  }
  return found.id;
}

// ─── Progress seeding ────────────────────────────────────────────────────────

async function seedProgress(
  sql: postgres.Sql,
  userId: string,
  s: Scenario,
): Promise<void> {
  const theme = s.preferences.theme ?? "dark";
  const persona = s.preferences.persona ?? "beginner";

  await sql`
    INSERT INTO user_preferences (
      user_id, persona, theme,
      welcome_done, workspace_coach_done, editor_coach_done
    ) VALUES (
      ${userId}, ${persona}, ${theme},
      ${s.preferences.welcomeDone ?? false},
      ${s.preferences.workspaceDone ?? false},
      ${s.preferences.editorDone ?? false}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      persona = EXCLUDED.persona,
      theme = EXCLUDED.theme,
      welcome_done = EXCLUDED.welcome_done,
      workspace_coach_done = EXCLUDED.workspace_coach_done,
      editor_coach_done = EXCLUDED.editor_coach_done
  `;

  // Wipe before reseed so re-runs are deterministic.
  await sql`DELETE FROM lesson_progress WHERE user_id = ${userId}`;
  await sql`DELETE FROM course_progress WHERE user_id = ${userId}`;

  for (const c of s.courses) {
    await sql`
      INSERT INTO course_progress (
        user_id, course_id, status,
        started_at, completed_at,
        last_lesson_id, completed_lesson_ids
      ) VALUES (
        ${userId}, ${c.courseId}, ${c.status},
        NOW() - INTERVAL '7 days',
        ${c.status === "completed" ? sql`NOW()` : null},
        ${c.lastLessonId ?? null},
        ${[...c.completedLessons]}
      )
    `;
  }

  for (const l of s.lessons) {
    const seed = l.seed;
    await sql`
      INSERT INTO lesson_progress (
        user_id, course_id, lesson_id, status,
        started_at, completed_at,
        attempt_count, run_count, hint_count, time_spent_ms,
        last_code
      ) VALUES (
        ${userId}, ${l.courseId}, ${l.lessonId}, ${seed.status},
        NOW() - INTERVAL '2 days',
        ${seed.status === "completed" ? sql`NOW() - INTERVAL '1 day'` : null},
        ${seed.attemptCount ?? 0},
        ${seed.runCount ?? 0},
        ${seed.hintCount ?? 0},
        ${seed.timeSpentMs ?? 0},
        ${seed.lastCode ? sql.json(seed.lastCode) : null}
      )
    `;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} not set — populate root .env from .env.example`);
  }
  return v;
}

async function main(): Promise<void> {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const dbUrl = requireEnv("DATABASE_URL");
  const password = requireEnv("DEV_SEED_PASSWORD");

  if (/prod/i.test(url)) {
    throw new Error(
      `[safety] SUPABASE_URL looks like prod (${url}). Refusing to seed.`,
    );
  }

  if (process.env.ALLOW_DEV_SEED !== "yes") {
    console.error("[safety] This will create/update test users + progress in:");
    console.error(`  ${url}`);
    console.error("Rerun with ALLOW_DEV_SEED=yes to confirm.");
    process.exit(1);
  }

  console.log(`Seeding ${SCENARIOS.length} dev users to ${url}…\n`);

  const sql = postgres(dbUrl, { prepare: false });
  try {
    for (const s of SCENARIOS) {
      const userId = await supabaseAdminUpsertUser(
        url,
        serviceKey,
        s.email,
        password,
        { first_name: s.firstName, last_name: s.lastName },
      );
      await seedProgress(sql, userId, s);
      console.log(`  ✓ ${s.email.padEnd(18)} ${s.label}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log("\nDone. Shared password is the DEV_SEED_PASSWORD env value (see .dev-users.md).");
}

main().catch((err) => {
  console.error("[seed-dev-users] failed:", err);
  process.exit(1);
});
