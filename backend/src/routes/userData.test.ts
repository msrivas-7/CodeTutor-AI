// Routes test: mount userDataRouter behind a fake auth middleware that just
// sets req.userId from an `x-test-user` header. This sidesteps JWKS plumbing
// and keeps the test focused on route-level concerns — schema validation,
// happy-path round trips, query-string handling. Inserts auth.users rows
// directly, so needs a superuser-connected Postgres with the Phase 18b
// schema applied; skips cleanly when DATABASE_URL is unreachable.

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const { db, closeDb } = await import("../db/client.js");
const { userDataRouter } = await import("./userData.js");

let srv: Server;
let base: string;
let dbReachable = false;
const userIds: string[] = [];

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (${id}, 'authenticated', 'authenticated', ${`u-${id}@test.local`}, '{}'::jsonb, '{}'::jsonb, now(), now())
  `;
  userIds.push(id);
  return id;
}

function req(userId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-test-user", userId);
  headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    if (u) req.userId = u;
    next();
  });
  app.use("/api/user", userDataRouter);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
  if (dbReachable && userIds.length) {
    await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

describe("GET /api/user/preferences", () => {
  it("returns defaults for a fresh user", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, "/api/user/preferences");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.persona).toBe("intermediate");
    expect(body.theme).toBe("dark");
  });
});

describe("PATCH /api/user/preferences", () => {
  it("merges a patch and returns the updated row", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, "/api/user/preferences", {
      method: "PATCH",
      body: JSON.stringify({ theme: "light", welcomeDone: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.theme).toBe("light");
    expect(body.welcomeDone).toBe(true);
  });

  it("rejects an unknown field with 400 (strict schema)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, "/api/user/preferences", {
      method: "PATCH",
      body: JSON.stringify({ theme: "light", foo: "bar" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid enum value with 400", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, "/api/user/preferences", {
      method: "PATCH",
      body: JSON.stringify({ persona: "expert" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("course + lesson progress routes", () => {
  it("PATCH course then GET /courses reflects the row", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const patchRes = await req(userId, "/api/user/courses/python", {
      method: "PATCH",
      body: JSON.stringify({
        status: "in_progress",
        lastLessonId: "l3",
        completedLessonIds: ["l1", "l2"],
      }),
    });
    expect(patchRes.status).toBe(200);

    const listRes = await req(userId, "/api/user/courses");
    expect(listRes.status).toBe(200);
    const { courses } = await listRes.json();
    expect(courses).toHaveLength(1);
    expect(courses[0].status).toBe("in_progress");
    expect(courses[0].completedLessonIds).toEqual(["l1", "l2"]);
  });

  it("GET /lessons?courseId= filters", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    for (const [course, lesson] of [
      ["python", "l1"],
      ["python", "l2"],
      ["js", "l1"],
    ]) {
      await req(userId, `/api/user/lessons/${course}/${lesson}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "in_progress" }),
      });
    }
    const pyRes = await req(userId, "/api/user/lessons?courseId=python");
    const { lessons } = await pyRes.json();
    expect(lessons).toHaveLength(2);
    for (const r of lessons) expect(r.courseId).toBe("python");
  });

  it("DELETE /courses/:id cascades lessons + course rows", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await req(userId, "/api/user/courses/python", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    await req(userId, "/api/user/lessons/python/l1", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    const del = await req(userId, "/api/user/courses/python", {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const body = await del.json();
    expect(body.course).toBe(true);
    expect(body.lessons).toBe(1);
  });
});

describe("editor project routes", () => {
  it("GET returns defaults; PUT replaces; GET reflects", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const g1 = await req(userId, "/api/user/editor-project");
    expect(g1.status).toBe(200);
    const first = await g1.json();
    expect(first.language).toBe("python");
    expect(first.files).toEqual({});

    const put = await req(userId, "/api/user/editor-project", {
      method: "PUT",
      body: JSON.stringify({
        language: "javascript",
        files: { "index.js": "console.log(1)" },
        activeFile: "index.js",
        openTabs: ["index.js"],
        fileOrder: ["index.js"],
        stdin: "",
      }),
    });
    expect(put.status).toBe(200);

    const g2 = await req(userId, "/api/user/editor-project");
    const second = await g2.json();
    expect(second.language).toBe("javascript");
    expect(second.files).toEqual({ "index.js": "console.log(1)" });
    expect(second.activeFile).toBe("index.js");
  });

  it("PUT rejects a payload missing required fields", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const put = await req(userId, "/api/user/editor-project", {
      method: "PUT",
      body: JSON.stringify({ language: "python" }),
    });
    expect(put.status).toBe(400);
  });
});
