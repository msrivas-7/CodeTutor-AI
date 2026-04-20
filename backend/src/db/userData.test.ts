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
});
