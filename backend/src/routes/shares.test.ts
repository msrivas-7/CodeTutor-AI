// Phase 21C: cinematic share route tests. Mirrors feedback.test.ts —
// fake auth via x-test-user, real DB so canonical catalog snapshots,
// ownership predicates, RLS, and constraints are exercised end-to-end.
// Skips when DATABASE_URL is unreachable.

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const { db } = await import("../db/client.js");
const { sharesAuthedRouter, sharesPublicRouter } = await import(
  "./shares.js"
);
const { createSharePreviewRouter } = await import("./sharePreview.js");
const {
  SHARE_PREVIEW_AUTH_HEADERS,
  signSharePreviewRequest,
} = await import("../services/share/previewAuth.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

let srv: Server;
let base: string;
let dbReachable = false;
const userIds: string[] = [];
const tokens: string[] = [];
const previewKey = {
  id: "integration-v1",
  secret: Buffer.alloc(32, 11).toString("base64"),
};
let previewNonce = 0;
let previewDisabled = false;

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (${id}, 'authenticated', 'authenticated', ${`u-${id}@test.local`}, '{}'::jsonb, '{}'::jsonb, now(), now())
  `;
  userIds.push(id);
  return id;
}

async function seedCompletedLesson(userId: string, courseId: string, lessonId: string) {
  await db()`
    INSERT INTO public.lesson_progress (
      user_id, course_id, lesson_id, status, started_at, completed_at,
      attempt_count, run_count, hint_count, time_spent_ms
    )
    VALUES (
      ${userId}, ${courseId}, ${lessonId}, 'completed',
      NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 minute',
      1, 3, 0, 600000
    )
    ON CONFLICT (user_id, course_id, lesson_id) DO UPDATE
      SET status = 'completed', completed_at = NOW() - INTERVAL '1 minute'
  `;
}

const sampleBody = (overrides: Partial<Record<string, unknown>> = {}) => ({
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  mastery: "strong" as const,
  timeSpentMs: 360_000,
  attemptCount: 1,
  codeSnippet: 'print("Hello, world!")',
  displayName: null,
  ...overrides,
});

function postCreate(userId: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-test-user"] = userId;
  return fetch(`${base}/api/shares`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function getPublic(token: string) {
  return fetch(`${base}/api/shares/${token}`);
}

function getPreview(token: string) {
  previewNonce += 1;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = Buffer.alloc(18);
  nonce.writeUInt32BE(previewNonce, 14);
  const encodedNonce = nonce.toString("base64url");
  const canonicalPath = `/api/internal/share-previews/${token}`;
  return fetch(`${base}${canonicalPath}`, {
    headers: {
      [SHARE_PREVIEW_AUTH_HEADERS.keyId]: previewKey.id,
      [SHARE_PREVIEW_AUTH_HEADERS.timestamp]: timestamp,
      [SHARE_PREVIEW_AUTH_HEADERS.nonce]: encodedNonce,
      [SHARE_PREVIEW_AUTH_HEADERS.signature]: signSharePreviewRequest({
        method: "GET",
        canonicalPath,
        timestamp,
        nonce: encodedNonce,
        keyId: previewKey.id,
        secret: previewKey.secret,
      }),
    },
  });
}

function deleteShare(userId: string | null, token: string) {
  const headers: Record<string, string> = {};
  if (userId) headers["x-test-user"] = userId;
  return fetch(`${base}/api/shares/${token}`, { method: "DELETE", headers });
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    await db()`SELECT 1 FROM public.shared_lesson_completions LIMIT 0`;
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
  // Mount public first (matches index.ts split-mount order).
  app.use(
    "/api/internal/share-previews",
    createSharePreviewRouter({
      keys: [previewKey],
      isDisabled: async () => previewDisabled,
      recordMetric: () => {},
    }),
  );
  app.use("/api/shares", sharesPublicRouter);
  app.use("/api/shares", sharesAuthedRouter);
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
    if (tokens.length) {
      await db()`DELETE FROM public.shared_lesson_completions WHERE share_token = ANY(${tokens}::text[])`;
    }
    if (userIds.length) {
      await db()`DELETE FROM public.lesson_progress WHERE user_id = ANY(${userIds}::uuid[])`;
      await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
    }
  }
});

describe("POST /api/shares", () => {
  it("creates a share when caller has completed the lesson", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const r = await postCreate(u, sampleBody());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.shareToken).toMatch(/^[a-z2-9]{12}$/);
    expect(body.url).toBe(`/s/${body.shareToken}`);
    tokens.push(body.shareToken);
  });

  it("rejects when lesson is not completed (403)", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    // No seedCompletedLesson — lesson_progress has no row.
    const r = await postCreate(u, sampleBody());
    expect(r.status).toBe(403);
  });

  it("rejects unauthenticated requests (401)", async () => {
    if (!dbReachable) return;
    const r = await postCreate(null, sampleBody());
    expect(r.status).toBe(401);
  });

  it("rejects invalid body (400) — missing field", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    const r = await postCreate(u, { courseId: "python-fundamentals" });
    expect(r.status).toBe(400);
  });

  it("rejects a zero-attempt completion as non-credible public data", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const r = await postCreate(u, sampleBody({ attemptCount: 0 }));
    expect(r.status).toBe(400);
  });

  it("blocks share when codeSnippet contains a secret-looking string", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const r = await postCreate(
      u,
      sampleBody({
        codeSnippet:
          'OPENAI_API_KEY = "sk-realsecretvaluedoesnotbelonghere1234"\nprint("hi")',
      }),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/secret/i);
  });

  it("rejects oversized codeSnippet (>4 KB)", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const r = await postCreate(
      u,
      sampleBody({ codeSnippet: "x".repeat(5000) }),
    );
    expect(r.status).toBe(400);
  });

  // Phase 23 P0 #4: per-user share lifetime cap. Pre-seed 50 active
  // rows directly (skipping the route's daily-cap + sanitizer + image
  // render path), then confirm the 51st via the route is rejected with
  // 429 + a friendly "revoke an older share" hint. Revoked rows must
  // NOT count, so we also seed an extra revoked row to prove it.
  it("rejects creation past the 50-share lifetime cap (429)", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");

    const seedTokens: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      seedTokens.push(`cap-${randomUUID().slice(0, 8)}-${i}`);
    }
    seedTokens.push(`cap-${randomUUID().slice(0, 8)}-revoked`);

    await db()`
      INSERT INTO public.shared_lesson_completions (
        share_token, user_id, course_id, lesson_id,
        lesson_title, lesson_order, course_title, course_total_lessons,
        mastery, time_spent_ms, attempt_count, code_snippet, created_at, revoked_at
      )
      SELECT
        t,
        ${u}::uuid,
        'python-fundamentals',
        'hello-world',
        'Hello, world',
        1,
        'Python Fundamentals',
        12,
        'strong',
        360000,
        1,
        'print("hi")',
        NOW() - INTERVAL '2 days',
        CASE WHEN t LIKE '%-revoked' THEN now() ELSE NULL END
      FROM unnest(${seedTokens}::text[]) AS t
    `;
    tokens.push(...seedTokens);

    const r = await postCreate(u, sampleBody());
    expect(r.status).toBe(429);
    const body = await r.json();
    expect(body.error).toMatch(/lifetime limit/i);
  });
});

describe("GET /api/shares/:token (public, anon-readable)", () => {
  it("returns the share JSON without exposing user_id", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const create = await postCreate(u, sampleBody({ displayName: "Mehul" }));
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    const r = await getPublic(shareToken);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.shareToken).toBe(shareToken);
    expect(body.lessonTitle).toBe("Hello, World!");
    expect(body.codeSnippet).toBe('print("Hello, world!")');
    expect(body.displayName).toBe("Mehul");
    // user_id MUST NOT appear in the public payload.
    expect(body.userId).toBeUndefined();
    expect(body.user_id).toBeUndefined();
  });

  it("returns 404 for an unknown token", async () => {
    if (!dbReachable) return;
    const r = await getPublic("aaaaaaaaaaaa");
    expect(r.status).toBe(404);
  });

  it("returns 404 for a malformed token after reserved public routes pass through", async () => {
    if (!dbReachable) return;
    const r = await getPublic("not-a-real-token-format");
    expect(r.status).toBe(404);
  });

  it("returns 404 after the share is revoked", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const create = await postCreate(u, sampleBody());
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    const del = await deleteShare(u, shareToken);
    expect(del.status).toBe(200);
    const r = await getPublic(shareToken);
    expect(r.status).toBe(404);
  });
});

describe("GET /api/internal/share-previews/:token (service-only)", () => {
  it("keeps crawler reads non-counting and leaves a cold human read available", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const create = await postCreate(u, sampleBody({ displayName: "Maya" }));
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    // A crawler burst uses only the internal service budget and never calls
    // bumpShareView. Five concurrent reads are enough to exercise real DB
    // concurrency without turning this integration test into a load test.
    const previews = await Promise.all(
      Array.from({ length: 5 }, () => getPreview(shareToken)),
    );
    expect(previews.every((response) => response.status === 200)).toBe(true);
    const dto = await previews[0].json();
    expect(dto).toMatchObject({
      schemaVersion: 1,
      lessonTitle: "Hello, World!",
      displayName: "Maya",
    });
    expect(dto.codeSnippet).toBeUndefined();
    expect(dto.viewCount).toBeUndefined();
    expect(dto.userId).toBeUndefined();

    const beforeHuman = await db()<Array<{ view_count: number }>>`
      SELECT view_count
        FROM public.shared_lesson_completions
       WHERE share_token = ${shareToken}
    `;
    expect(Number(beforeHuman[0]?.view_count)).toBe(0);

    // The same client can still make a cold human reader request after the
    // crawler burst because the preview route never touches public buckets.
    const publicRead = await getPublic(shareToken);
    expect(publicRead.status).toBe(200);

    let counted = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await db()<Array<{ view_count: number }>>`
        SELECT view_count
          FROM public.shared_lesson_completions
         WHERE share_token = ${shareToken}
      `;
      counted = Number(rows[0]?.view_count ?? 0);
      if (counted === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(counted).toBe(1);
  }, 30_000);

  it("returns the same 404 after revocation without falling through to public reads", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const create = await postCreate(u, sampleBody());
    const { shareToken } = await create.json();
    tokens.push(shareToken);
    expect((await getPreview(shareToken)).status).toBe(200);
    expect((await deleteShare(u, shareToken)).status).toBe(200);
    expect((await getPreview(shareToken)).status).toBe(404);
  }, 30_000);

  it("keeps human reads live while the backend preview kill switch is active", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const create = await postCreate(u, sampleBody());
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    previewDisabled = true;
    try {
      expect((await getPreview(shareToken)).status).toBe(503);
      expect((await getPublic(shareToken)).status).toBe(200);
    } finally {
      previewDisabled = false;
    }
  }, 30_000);
});

describe("DELETE /api/shares/:token", () => {
  it("revokes a share owned by the caller", async () => {
    if (!dbReachable) return;
    const u = await mkUser();
    await seedCompletedLesson(u, "python-fundamentals", "hello-world");
    const create = await postCreate(u, sampleBody());
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    const r = await deleteShare(u, shareToken);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
  });

  it("returns 404 when revoking a share owned by someone else", async () => {
    if (!dbReachable) return;
    const owner = await mkUser();
    const other = await mkUser();
    await seedCompletedLesson(owner, "python-fundamentals", "hello-world");
    const create = await postCreate(owner, sampleBody());
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    // The server-side UPDATE includes user_id in its WHERE clause, so a
    // different owner receives the same privacy-preserving 404 as a miss.
    const r = await deleteShare(other, shareToken);
    expect(r.status).toBe(404);
  });

  it("returns 401 for unauthenticated revoke", async () => {
    if (!dbReachable) return;
    const r = await deleteShare(null, "aaaaaaaaaaaa");
    expect(r.status).toBe(401);
  });
});
