// Integration tests against a superuser-connected Postgres with the Phase
// 18b schema + RLS policies applied. Inserts directly into auth.users via
// the `postgres` superuser (see mkUser below) rather than going through
// GoTrue, so these specs need a Postgres where the connection role can
// write to `auth.*`. That rules out the cloud transaction pooler — this
// file only runs green against a Postgres you control (a scratch docker
// container or a personal Postgres with the migrations applied).
//
// Skips cleanly if DATABASE_URL is unreachable, so it's a no-op during the
// normal cloud-only `npm test` flow. Each test namespaces rows under a
// fresh random uuid so specs don't step on each other in parallel.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const { db, closeDb } = await import("./client.js");
const prefs = await import("./preferences.js");
const courses = await import("./courseProgress.js");
const lessons = await import("./lessonProgress.js");
const editor = await import("./editorProject.js");
// BYOK round-trips go through the real crypto module on purpose — we want
// to catch a config mismatch (BYOK_ENCRYPTION_KEY missing / wrong length)
// the same way a startup boot would.
const byok = await import("../services/crypto/byok.js");

let dbReachable = false;
const userIds: string[] = [];

// The public.* tables FK to auth.users. We're running as the `postgres`
// superuser in tests, so we can insert minimal auth.users rows directly
// rather than going through the GoTrue admin API (which would need a
// running auth server + service-role key). Each spec fabricates a unique
// id; afterAll cleans them all up.
async function mkUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (${id}, 'authenticated', 'authenticated', ${`u-${id}@test.local`}, '{}'::jsonb, '{}'::jsonb, now(), now())
  `;
  userIds.push(id);
  return id;
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (dbReachable && userIds.length) {
    const sql = db();
    // Clean up every user this suite touched, in FK-safe order. Deleting
    // the auth.users row cascades to all four public.* tables because of
    // ON DELETE CASCADE in the Phase 18b migration.
    await sql`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

describe.skipIf(!process.env.RUN_DB_TESTS && process.env.CI !== "true")(
  "db integration — only runs when RUN_DB_TESTS=1 or CI=true",
  () => {
    it("placeholder gate", () => expect(true).toBe(true));
  },
);

// The actual suite — unconditionally registered so reachability is detected
// at runtime (beforeAll) and each `it` can skip if DB isn't up. Using
// vitest's `.skipIf` on dynamic values is painful; we guard per-test instead.

describe("db/preferences", () => {
  it("getPreferences returns defaults for a never-seen user", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const p = await prefs.getPreferences(userId);
    expect(p.persona).toBe("intermediate");
    expect(p.theme).toBe("dark");
    expect(p.welcomeDone).toBe(false);
    expect(p.uiLayout).toEqual({});
  });

  it("upsert creates then patch merges", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const created = await prefs.upsertPreferences(userId, {
      persona: "beginner",
      welcomeDone: true,
    });
    expect(created.persona).toBe("beginner");
    expect(created.welcomeDone).toBe(true);
    expect(created.theme).toBe("dark");

    const patched = await prefs.upsertPreferences(userId, {
      theme: "light",
      openaiModel: "gpt-4o-mini",
    });
    expect(patched.persona).toBe("beginner"); // preserved
    expect(patched.welcomeDone).toBe(true); // preserved
    expect(patched.theme).toBe("light"); // updated
    expect(patched.openaiModel).toBe("gpt-4o-mini");
  });

  it("upsert with uiLayout replaces jsonb", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await prefs.upsertPreferences(userId, { uiLayout: { panel: "left" } });
    const p = await prefs.upsertPreferences(userId, {
      uiLayout: { panel: "right", width: 320 },
    });
    expect(p.uiLayout).toEqual({ panel: "right", width: 320 });
  });

  it("setting openaiModel to null clears it", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await prefs.upsertPreferences(userId, { openaiModel: "gpt-4o" });
    const cleared = await prefs.upsertPreferences(userId, {
      openaiModel: null,
    });
    expect(cleared.openaiModel).toBeNull();
  });

  it("check constraint rejects invalid persona", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await expect(
      prefs.upsertPreferences(userId, {
        persona: "expert" as unknown as "beginner",
      }),
    ).rejects.toThrow();
  });
});

describe("db/preferences — BYOK key round-trip", () => {
  it("getOpenAIKey returns null when no key has ever been set", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    expect(await prefs.getOpenAIKey(userId)).toBeNull();
  });

  it("setOpenAIKey on a never-seen user inserts the row; getOpenAIKey returns plaintext", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const plaintext = "sk-test-unit-aaaaaaaaaaaaaaaaaaaa";
    await prefs.setOpenAIKey(userId, plaintext);
    expect(await prefs.getOpenAIKey(userId)).toBe(plaintext);
  });

  it("setOpenAIKey flips hasOpenaiKey to true without touching other preference columns", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await prefs.upsertPreferences(userId, { persona: "beginner", theme: "light" });
    const before = await prefs.getPreferences(userId);
    expect(before.hasOpenaiKey).toBe(false);

    await prefs.setOpenAIKey(userId, "sk-another-key-bbbbbbbbbbbbbbbbbbbb");
    const after = await prefs.getPreferences(userId);
    expect(after.hasOpenaiKey).toBe(true);
    // Scalar columns survive the encryption upsert.
    expect(after.persona).toBe("beginner");
    expect(after.theme).toBe("light");
  });

  it("setOpenAIKey overwrites a prior key (last write wins)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await prefs.setOpenAIKey(userId, "sk-first-key-000000000000000000");
    await prefs.setOpenAIKey(userId, "sk-second-key-1111111111111111111");
    expect(await prefs.getOpenAIKey(userId)).toBe("sk-second-key-1111111111111111111");
  });

  it("clearOpenAIKey nulls cipher + nonce and flips hasOpenaiKey back to false", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await prefs.setOpenAIKey(userId, "sk-clear-me-ccccccccccccccccccccc");
    expect((await prefs.getPreferences(userId)).hasOpenaiKey).toBe(true);

    await prefs.clearOpenAIKey(userId);
    expect(await prefs.getOpenAIKey(userId)).toBeNull();
    expect((await prefs.getPreferences(userId)).hasOpenaiKey).toBe(false);
  });

  it("stored cipher+nonce decrypt only under the owning userId (AAD binding end-to-end)", async () => {
    if (!dbReachable) return;
    const userA = await mkUser();
    const userB = await mkUser();
    await prefs.setOpenAIKey(userA, "sk-owner-only-dddddddddddddddddd");

    // Pull the raw ciphertext columns for userA and attempt to decrypt under
    // userB's id. The AAD binding must make this throw — a row-copy attack
    // (A's cipher pasted into B's row) would surface here.
    const rows = await db()<
      Array<{ cipher: Buffer; nonce: Buffer }>
    >`SELECT openai_api_key_cipher AS cipher, openai_api_key_nonce AS nonce
        FROM public.user_preferences WHERE user_id = ${userA}`;
    expect(rows[0].cipher).not.toBeNull();
    expect(() => byok.decryptKey(rows[0].cipher, rows[0].nonce, userB)).toThrow();
  });
});

describe("db/courseProgress", () => {
  it("list is empty for fresh user; upsert inserts a row", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    expect(await courses.listCourseProgress(userId)).toEqual([]);
    const row = await courses.upsertCourseProgress(userId, "python", {
      status: "in_progress",
      startedAt: new Date(0).toISOString(),
      lastLessonId: "lesson-1",
    });
    expect(row.courseId).toBe("python");
    expect(row.status).toBe("in_progress");
    expect(row.lastLessonId).toBe("lesson-1");
    expect(row.completedLessonIds).toEqual([]);
  });

  it("upsert merges completedLessonIds on conflict", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await courses.upsertCourseProgress(userId, "py", {
      completedLessonIds: ["a", "b"],
    });
    const row = await courses.upsertCourseProgress(userId, "py", {
      status: "completed",
      completedLessonIds: ["a", "b", "c"],
    });
    expect(row.completedLessonIds).toEqual(["a", "b", "c"]);
    expect(row.status).toBe("completed");
  });

  it("delete returns true then false", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await courses.upsertCourseProgress(userId, "js", {});
    expect(await courses.deleteCourseProgress(userId, "js")).toBe(true);
    expect(await courses.deleteCourseProgress(userId, "js")).toBe(false);
  });
});

describe("db/lessonProgress", () => {
  it("list filters by course; upsert merges counters", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.upsertLessonProgress(userId, "py", "l1", {
      attemptCount: 1,
      runCount: 2,
    });
    await lessons.upsertLessonProgress(userId, "py", "l2", {
      attemptCount: 1,
    });
    await lessons.upsertLessonProgress(userId, "js", "l1", {
      attemptCount: 5,
    });

    const pyRows = await lessons.listLessonProgress(userId, "py");
    expect(pyRows).toHaveLength(2);
    const all = await lessons.listLessonProgress(userId);
    expect(all).toHaveLength(3);

    const patched = await lessons.upsertLessonProgress(userId, "py", "l1", {
      attemptCount: 5,
      hintCount: 2,
    });
    expect(patched.attemptCount).toBe(5);
    expect(patched.runCount).toBe(2);
    expect(patched.hintCount).toBe(2);
  });

  it("lastCode jsonb round-trips", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const code = { "main.py": "print('hi')" };
    const row = await lessons.upsertLessonProgress(userId, "py", "l1", {
      lastCode: code,
      lastOutput: "hi\n",
    });
    expect(row.lastCode).toEqual(code);
    expect(row.lastOutput).toBe("hi\n");
  });

  it("deleteLessonProgress scoped by course removes those rows only", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.upsertLessonProgress(userId, "py", "l1", {});
    await lessons.upsertLessonProgress(userId, "py", "l2", {});
    await lessons.upsertLessonProgress(userId, "js", "l1", {});
    const deleted = await lessons.deleteLessonProgress(userId, "py");
    expect(deleted).toBe(2);
    const remaining = await lessons.listLessonProgress(userId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].courseId).toBe("js");
  });

  it("deleteLessonProgress scoped by lessonId removes only the single row", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.upsertLessonProgress(userId, "py", "l1", {});
    await lessons.upsertLessonProgress(userId, "py", "l2", {});
    const deleted = await lessons.deleteLessonProgress(userId, "py", "l1");
    expect(deleted).toBe(1);
    const remaining = await lessons.listLessonProgress(userId, "py");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].lessonId).toBe("l2");
  });

  it("deleteLessonProgress for a nonexistent row returns 0", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    expect(await lessons.deleteLessonProgress(userId, "py", "ghost")).toBe(0);
    expect(await lessons.deleteLessonProgress(userId, "ghost-course")).toBe(0);
  });

  it("practiceExerciseCode jsonb round-trips and a later patch replaces it wholesale", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const first = { "ex1": { "main.py": "print('a')" } };
    const r1 = await lessons.upsertLessonProgress(userId, "py", "l1", {
      practiceExerciseCode: first,
    });
    expect(r1.practiceExerciseCode).toEqual(first);

    const second = { "ex2": { "main.py": "print('b')" } };
    const r2 = await lessons.upsertLessonProgress(userId, "py", "l1", {
      practiceExerciseCode: second,
    });
    // CASE WHEN practiceExerciseCode !== undefined THEN replace — so "ex1"
    // should be gone, not merged. This is the invariant that keeps practice
    // mode from accumulating stale exercise buffers.
    expect(r2.practiceExerciseCode).toEqual(second);
  });

  it("practiceCompletedIds persists; omitting from a later patch preserves prior value", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.upsertLessonProgress(userId, "py", "l1", {
      practiceCompletedIds: ["ex1", "ex2"],
    });
    // Bump an unrelated counter without touching practiceCompletedIds —
    // COALESCE should preserve the prior array.
    const bumped = await lessons.upsertLessonProgress(userId, "py", "l1", {
      runCount: 7,
    });
    expect(bumped.practiceCompletedIds).toEqual(["ex1", "ex2"]);
    expect(bumped.runCount).toBe(7);
  });

  it("lastCode = null via CASE branch clears the jsonb (distinct from 'omitted')", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.upsertLessonProgress(userId, "py", "l1", {
      lastCode: { "main.py": "x = 1" },
    });
    // Explicit null in patch → CASE WHEN lastCode !== undefined → write null.
    const cleared = await lessons.upsertLessonProgress(userId, "py", "l1", {
      lastCode: null,
    });
    expect(cleared.lastCode).toBeNull();
  });

  // P-H4 (adversarial audit, bucket 4b): batch-additive heartbeat. Unlike
  // upsertLessonProgress's COALESCE-set semantics, addLessonTimes bumps
  // time_spent_ms by the provided delta. Two flushes in a row accumulate;
  // a brand-new (courseId,lessonId) seeds a row with status='in_progress'.
  it("addLessonTimes seeds a new row with the delta on first touch", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const written = await lessons.addLessonTimes(userId, [
      { courseId: "py", lessonId: "loops", deltaMs: 30_000 },
    ]);
    expect(written).toBe(1);
    const rows = await lessons.listLessonProgress(userId, "py");
    expect(rows).toHaveLength(1);
    expect(rows[0].timeSpentMs).toBe(30_000);
    expect(rows[0].status).toBe("in_progress");
  });

  it("addLessonTimes increments an existing row instead of overwriting", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.upsertLessonProgress(userId, "py", "loops", {
      status: "in_progress",
      timeSpentMs: 60_000,
    });
    await lessons.addLessonTimes(userId, [
      { courseId: "py", lessonId: "loops", deltaMs: 45_000 },
    ]);
    const [row] = await lessons.listLessonProgress(userId, "py");
    expect(row.timeSpentMs).toBe(105_000);
  });

  it("addLessonTimes folds repeats for the same (course,lesson) in a single batch", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await lessons.addLessonTimes(userId, [
      { courseId: "py", lessonId: "l1", deltaMs: 10_000 },
      { courseId: "py", lessonId: "l1", deltaMs: 15_000 },
      { courseId: "py", lessonId: "l2", deltaMs: 5_000 },
      { courseId: "py", lessonId: "l1", deltaMs: 0 }, // ignored
      { courseId: "py", lessonId: "l1", deltaMs: -100 }, // ignored
    ]);
    const rows = await lessons.listLessonProgress(userId, "py");
    const byLesson = Object.fromEntries(rows.map((r) => [r.lessonId, r.timeSpentMs]));
    expect(byLesson.l1).toBe(25_000);
    expect(byLesson.l2).toBe(5_000);
  });

  it("addLessonTimes([]) is a no-op that returns 0", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    expect(await lessons.addLessonTimes(userId, [])).toBe(0);
  });
});

describe("db/editorProject", () => {
  it("get returns defaults; save replaces fully", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const empty = await editor.getEditorProject(userId);
    expect(empty.files).toEqual({});
    expect(empty.language).toBe("python");

    const saved = await editor.saveEditorProject(userId, {
      language: "typescript",
      files: { "index.ts": "const x = 1;" },
      activeFile: "index.ts",
      openTabs: ["index.ts"],
      fileOrder: ["index.ts"],
      stdin: "",
    });
    expect(saved.language).toBe("typescript");
    expect(saved.files).toEqual({ "index.ts": "const x = 1;" });
    expect(saved.activeFile).toBe("index.ts");
  });

  it("second save overwrites prior files payload", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await editor.saveEditorProject(userId, {
      language: "python",
      files: { "a.py": "1" },
      activeFile: "a.py",
      openTabs: ["a.py"],
      fileOrder: ["a.py"],
      stdin: "",
    });
    const second = await editor.saveEditorProject(userId, {
      language: "python",
      files: { "b.py": "2" },
      activeFile: "b.py",
      openTabs: ["b.py"],
      fileOrder: ["b.py"],
      stdin: "hello",
    });
    expect(second.files).toEqual({ "b.py": "2" });
    expect(second.stdin).toBe("hello");
  });

  it("getEditorProject defaults are the documented shape (never-seen user)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const p = await editor.getEditorProject(userId);
    expect(p.language).toBe("python");
    expect(p.files).toEqual({});
    expect(p.activeFile).toBeNull();
    expect(p.openTabs).toEqual([]);
    expect(p.fileOrder).toEqual([]);
    expect(p.stdin).toBe("");
  });

  it("save with null activeFile persists null (not the empty string)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const saved = await editor.saveEditorProject(userId, {
      language: "python",
      files: {},
      activeFile: null,
      openTabs: [],
      fileOrder: [],
      stdin: "",
    });
    expect(saved.activeFile).toBeNull();
    const refetched = await editor.getEditorProject(userId);
    expect(refetched.activeFile).toBeNull();
  });

  it("save with empty files + empty arrays round-trips", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const saved = await editor.saveEditorProject(userId, {
      language: "javascript",
      files: {},
      activeFile: null,
      openTabs: [],
      fileOrder: [],
      stdin: "",
    });
    expect(saved.files).toEqual({});
    expect(saved.openTabs).toEqual([]);
    expect(saved.fileOrder).toEqual([]);
    expect(saved.language).toBe("javascript");
  });
});
