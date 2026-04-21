// Phase 20-P1: feedback route tests. Mirrors the userData.test.ts shape —
// fake auth via `x-test-user`, real DB so the RLS + constraint posture is
// exercised end-to-end. Skips cleanly when DATABASE_URL is unreachable.

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const { db, closeDb } = await import("../db/client.js");
const { feedbackRouter } = await import("./feedback.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

let srv: Server;
let base: string;
let dbReachable = false;
const userIds: string[] = [];
const feedbackIds: string[] = [];

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (${id}, 'authenticated', 'authenticated', ${`u-${id}@test.local`}, '{}'::jsonb, '{}'::jsonb, now(), now())
  `;
  userIds.push(id);
  return id;
}

function req(userId: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-test-user"] = userId;
  return fetch(`${base}/api/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    // Confirm the feedback table exists (Phase 20-P1 migration).
    await db()`SELECT 1 FROM public.feedback LIMIT 0`;
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
  app.use("/api/feedback", feedbackRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
  if (dbReachable) {
    if (feedbackIds.length) {
      await db()`DELETE FROM public.feedback WHERE id = ANY(${feedbackIds}::uuid[])`;
    }
    if (userIds.length) {
      // ON DELETE SET NULL preserves any feedback rows whose fk we didn't
      // track; sweep them here so reruns stay clean.
      await db()`DELETE FROM public.feedback WHERE user_id = ANY(${userIds}::uuid[])`;
      await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
    }
  }
  await closeDb();
});

describe("POST /api/feedback", () => {
  it("inserts a row for the authenticated user and returns its id", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, {
      body: "The editor hung when I saved",
      category: "bug",
      diagnostics: { route: "/editor", viewport: "1200x800" },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; createdAt: string };
    expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    feedbackIds.push(json.id);
    const [row] = await db()<
      Array<{ user_id: string; body: string; category: string }>
    >`SELECT user_id, body, category FROM public.feedback WHERE id = ${json.id}`;
    expect(row.user_id).toBe(userId);
    expect(row.body).toBe("The editor hung when I saved");
    expect(row.category).toBe("bug");
  });

  it("defaults diagnostics to {} when omitted", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, { body: "idea: add dark mode", category: "idea" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };
    feedbackIds.push(json.id);
    const [row] = await db()<
      Array<{ diagnostics: Record<string, unknown> }>
    >`SELECT diagnostics FROM public.feedback WHERE id = ${json.id}`;
    expect(row.diagnostics).toEqual({});
  });

  it("rejects an empty body with 400", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, { body: "", category: "other" });
    expect(res.status).toBe(400);
  });

  it("rejects a body longer than 4000 chars with 400", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, { body: "x".repeat(4001), category: "other" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown category with 400", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, { body: "hello", category: "rant" });
    expect(res.status).toBe(400);
  });

  it("rejects diagnostics exceeding the byte budget with 400", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    // 9 × 1 KB strings = ~9 KB, well past the 8 KB cap.
    const bloat: Record<string, string> = {};
    for (let i = 0; i < 9; i++) bloat[`k${i}`] = "x".repeat(1023);
    const res = await req(userId, { body: "hi", category: "other", diagnostics: bloat });
    expect(res.status).toBe(400);
  });

  it("rejects a single diagnostics value over 1 KB with 400", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, {
      body: "hi",
      category: "other",
      diagnostics: { userAgent: "x".repeat(1100) },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    if (!dbReachable) return;
    const res = await req(null, { body: "hi", category: "other" });
    expect(res.status).toBe(401);
  });
});

describe("feedback row survives account deletion (user_id SET NULL)", () => {
  it("keeps the row with user_id = null after the owning user is deleted", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, { body: "outlive me", category: "other" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };
    feedbackIds.push(json.id);

    // Simulate the cascading side of delete-account: remove the user row.
    await db()`DELETE FROM auth.users WHERE id = ${userId}`;
    // Remove this id from the cleanup tracker — it no longer exists.
    const idx = userIds.indexOf(userId);
    if (idx !== -1) userIds.splice(idx, 1);

    const [row] = await db()<
      Array<{ user_id: string | null; body: string }>
    >`SELECT user_id, body FROM public.feedback WHERE id = ${json.id}`;
    expect(row).toBeDefined();
    expect(row.user_id).toBeNull();
    expect(row.body).toBe("outlive me");
  });
});
