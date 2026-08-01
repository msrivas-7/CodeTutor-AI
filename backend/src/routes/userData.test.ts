// Routes test: mount userDataRouter behind a fake auth middleware that just
// sets req.userId from an `x-test-user` header. This sidesteps JWKS plumbing
// and keeps the test focused on route-level concerns — schema validation,
// happy-path round trips, query-string handling. Inserts auth.users rows
// directly, so needs a superuser-connected Postgres with the Phase 18b
// schema applied; skips cleanly when DATABASE_URL is unreachable.

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// The DELETE /account path calls out to Supabase's admin REST API. Stub the
// wrapper so these tests exercise only the route's validation + ownership
// logic — the live HTTP shape is covered in supabaseAdmin.test.ts.
vi.mock("../db/supabaseAdmin.js", () => ({
  isAdminAvailable: vi.fn(() => true),
  adminDeleteUser: vi.fn(async () => {}),
}));

// Phase 23 P1 #6: stub the deletion-audit insert in this suite because
// `adminDeleteUser` is itself mocked — so we never produce a real
// "account is gone" event whose audit trail we'd want to write. The
// real insert path is covered in `deletedAccounts.test.ts` which uses
// the live DB. Mocking here also avoids polluting the test DB with
// audit rows that have no corresponding deletion.
vi.mock("../db/deletedAccounts.js", () => ({
  insertDeletedAccount: vi.fn(async () => {}),
}));

const { db, closeDb } = await import("../db/client.js");
const { userDataRouter } = await import("./userData.js");
const { upsertCourseProgress } = await import("../db/courseProgress.js");
const { upsertLessonProgress } = await import("../db/lessonProgress.js");
const { getLessonConceptTags } = await import(
  "../services/share/lessonCatalog.js"
);
const supabaseAdmin = await import("../db/supabaseAdmin.js");
const deletedAccountsDb = await import("../db/deletedAccounts.js");

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

function req(
  userId: string,
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-test-user", userId);
  headers.set("content-type", "application/json");
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
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
    const email = req.header("x-test-email");
    // Phase 23 P0 #1: account-delete recent-auth gate reads `iat` from
    // the JWT. Tests pass `x-test-iat` (seconds-since-epoch) to simulate
    // a token of a specific age. Default to "now" when absent so the
    // gate doesn't reject existing tests that don't care about it.
    // The literal string "absent" forces no iat claim at all (used by
    // the missing-iat test case).
    const iatHeader = req.header("x-test-iat");
    // Phase 23 P0 #1: provider claim distinguishes password vs OAuth
    // sessions. The recent-auth gate only fires for password sessions;
    // OAuth-issued sessions skip it (no provider | "email" → password).
    const providerHeader = req.header("x-test-provider");
    let claims: {
      email?: string;
      iat?: number;
      app_metadata?: Record<string, unknown>;
    } | undefined;
    if (email !== undefined || iatHeader !== undefined || providerHeader !== undefined) {
      claims = { email };
      if (iatHeader === "absent") {
        // leave iat unset
      } else if (iatHeader !== undefined) {
        claims.iat = Number(iatHeader);
      } else {
        claims.iat = Math.floor(Date.now() / 1000);
      }
      if (providerHeader !== undefined) {
        claims.app_metadata = { provider: providerHeader };
      }
    }
    if (claims) req.authClaims = claims as typeof req.authClaims;
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
    expect(body.persona).toBe("beginner");
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
  it("PATCH course derives canonical progress instead of trusting completion claims", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const patchRes = await req(userId, "/api/user/courses/python-fundamentals", {
      method: "PATCH",
      body: JSON.stringify({
        status: "in_progress",
        lastLessonId: "hello-world",
        completedLessonIds: ["variables", "loops"],
      }),
    });
    expect(patchRes.status).toBe(200);

    const listRes = await req(userId, "/api/user/courses");
    expect(listRes.status).toBe(200);
    const { courses } = await listRes.json();
    expect(courses).toHaveLength(1);
    expect(courses[0].status).toBe("in_progress");
    expect(courses[0].completedLessonIds).toEqual([]);
  });

  it("GET /lessons?courseId= filters", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    for (const [course, lesson] of [
      ["python-fundamentals", "hello-world"],
      ["python-fundamentals", "variables"],
      ["javascript-fundamentals", "hello-print"],
    ]) {
      await upsertLessonProgress(userId, course, lesson, {
        status: "in_progress",
      });
    }
    const pyRes = await req(userId, "/api/user/lessons?courseId=python-fundamentals");
    const { lessons } = await pyRes.json();
    expect(lessons).toHaveLength(2);
    for (const r of lessons) expect(r.courseId).toBe("python-fundamentals");
  });

  it("DELETE /courses/:id cascades lessons + course rows", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await upsertCourseProgress(userId, "python-fundamentals", {
      status: "in_progress",
    });
    await upsertLessonProgress(userId, "python-fundamentals", "hello-world", {
      status: "in_progress",
    });
    const del = await req(userId, "/api/user/courses/python-fundamentals", {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const body = await del.json();
    expect(body.course).toBe(true);
    expect(body.lessons).toBe(1);
  });
});

describe("Phase B1 concept memory routes", () => {
  it("serves one server-owned warm-up without leaking its answer and records recall", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    for (const conceptTag of ["int", "str", "string-concat"]) {
      await db()`
        INSERT INTO public.learner_concept_ledger (
          user_id, course_id, lesson_id, concept_tag, event_type, occurred_at
        ) VALUES (
          ${userId}, 'python-fundamentals', 'route-memory-exposure',
          ${conceptTag}, 'used', now() - interval '6 days'
        )
      `;
    }

    const warmupRes = await req(
      userId,
      "/api/user/memory/warmup?courseId=python-fundamentals&lessonId=input-output",
    );
    expect(warmupRes.status).toBe(200);
    const { warmup } = await warmupRes.json();
    expect(warmup).toMatchObject({
      courseId: "python-fundamentals",
      lessonId: "input-output",
      warmupId: "join-text-and-a-number",
      attemptCount: 0,
    });
    expect(warmup).not.toHaveProperty("correctIndex");
    expect(warmup).not.toHaveProperty("explanation");

    const answerRes = await req(
      userId,
      `/api/user/memory/warmup/${warmup.episodeId}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ requestId: randomUUID(), choiceIndex: 1 }),
      },
    );
    expect(answerRes.status).toBe(200);
    await expect(answerRes.json()).resolves.toMatchObject({
      isCorrect: true,
      attemptNumber: 1,
      completed: true,
      firstAttemptCorrect: true,
    });

    const memoryRes = await req(
      userId,
      "/api/user/memory?courseId=python-fundamentals",
    );
    expect(memoryRes.status).toBe(200);
    const memory = await memoryRes.json();
    expect(memory.refreshAfterDays).toBe(5);
    const remembered = memory.concepts.filter((item: { conceptTag: string }) =>
      warmup.conceptTags.includes(item.conceptTag),
    );
    expect(remembered).toHaveLength(warmup.conceptTags.length);
    expect(
      remembered.every((item: { state: string }) => item.state === "remembered"),
    ).toBe(true);
  }, 30_000);

  it("accepts bounded canonical practice evidence with the lesson patch", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const requestId = randomUUID();
    const patchRes = await req(
      userId,
      "/api/user/lessons/python-fundamentals/hello-world",
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "in_progress",
          practiceCompletedIds: ["two-lines"],
          practiceEvidence: {
            exerciseId: "two-lines",
            requestId,
            attemptCount: 2,
            hintCount: 1,
            timeSpentMs: 25_000,
            modelAssisted: false,
          },
        }),
      },
    );
    expect(patchRes.status).toBe(200);

    const rows = await db()<Array<{
      activity_id: string;
      evidence_source: string;
      attempt_count: number;
      hint_count: number;
    }>>`
      SELECT activity_id, evidence_source, attempt_count, hint_count
        FROM public.learner_concept_evidence
       WHERE user_id = ${userId} AND request_id = ${requestId}::uuid
    `;
    const canonicalTags = await getLessonConceptTags(
      "python-fundamentals",
      "hello-world",
    );
    const canonicalTagCount = new Set([
      ...(canonicalTags?.taught ?? []),
      ...(canonicalTags?.used ?? []),
    ]).size;
    expect(rows).toHaveLength(canonicalTagCount);
    expect(rows.every((row) => row.activity_id === "two-lines")).toBe(true);
    expect(rows.every((row) => row.evidence_source === "client_observed")).toBe(true);
    expect(rows.every((row) => row.attempt_count === 2 && row.hint_count === 1)).toBe(true);

    const legacyLedger = await db()<Array<{ count: number }>>`
      SELECT count(*)::int AS count
        FROM public.learner_concept_ledger
       WHERE user_id = ${userId}
         AND course_id = 'python-fundamentals'
         AND lesson_id = 'hello-world'
         AND event_type = 'practiced'
    `;
    expect(canonicalTags).not.toBeNull();
    expect(legacyLedger[0]?.count).toBe(
      new Set([...(canonicalTags?.taught ?? []), ...(canonicalTags?.used ?? [])])
        .size,
    );
  }, 30_000);

  it("rejects malformed or mismatched evidence before mutating progress", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const patchRes = await req(
      userId,
      "/api/user/lessons/python-fundamentals/hello-world",
      {
        method: "PATCH",
        body: JSON.stringify({
          practiceCompletedIds: ["two-lines"],
          practiceEvidence: {
            exerciseId: "not-a-real-exercise",
            requestId: randomUUID(),
            attemptCount: 1,
            hintCount: 0,
            timeSpentMs: 1_000,
            modelAssisted: false,
          },
        }),
      },
    );
    expect(patchRes.status).toBe(400);

    const rows = await db()<Array<{ count: number }>>`
      SELECT count(*)::int AS count
        FROM public.lesson_progress
       WHERE user_id = ${userId}
         AND course_id = 'python-fundamentals'
         AND lesson_id = 'hello-world'
    `;
    expect(rows[0]?.count).toBe(0);
  }, 30_000);
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
        expectedRevision: 0,
        writerId: randomUUID(),
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

describe("DELETE /api/user/account (Phase 20-P0 #9)", () => {
  it("rejects when confirmEmail is missing (400)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(
      userId,
      "/api/user/account",
      { method: "DELETE", body: JSON.stringify({}) },
      { "x-test-email": `u-${userId}@test.local` },
    );
    expect(res.status).toBe(400);
    // Admin wasn't invoked — we bailed on validation.
    expect(supabaseAdmin.adminDeleteUser).not.toHaveBeenCalled();
  });

  it("rejects with EMAIL_MISMATCH when confirmEmail doesn't match the JWT claim", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: "wrong@test.local" }),
      },
      { "x-test-email": `u-${userId}@test.local` },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("EMAIL_MISMATCH");
    expect(supabaseAdmin.adminDeleteUser).not.toHaveBeenCalled();
  });

  it("returns 501 when the service-role key is not configured", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    vi.mocked(supabaseAdmin.isAdminAvailable).mockReturnValueOnce(false);
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: `u-${userId}@test.local` }),
      },
      { "x-test-email": `u-${userId}@test.local` },
    );
    expect(res.status).toBe(501);
    expect(supabaseAdmin.adminDeleteUser).not.toHaveBeenCalled();
  });

  it("calls adminDeleteUser with the JWT userId on match (case-insensitive email)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    vi.mocked(supabaseAdmin.isAdminAvailable).mockReturnValue(true);
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        // Uppercase the submitted confirmation to prove we compare case-insensitively.
        body: JSON.stringify({ confirmEmail: `U-${userId}@TEST.local` }),
      },
      { "x-test-email": `u-${userId}@test.local` },
    );
    expect(res.status).toBe(200);
    expect(supabaseAdmin.adminDeleteUser).toHaveBeenCalledWith(userId);
    expect(supabaseAdmin.adminDeleteUser).toHaveBeenCalledOnce();
  });

  // Phase 23 P0 #1: recent-auth gate.
  it("returns 428 REAUTH_REQUIRED when the JWT was issued more than 5 minutes ago", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    vi.mocked(supabaseAdmin.isAdminAvailable).mockReturnValue(true);
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    // 30 minutes old → well past the 5min + 60s skew window.
    const staleIat = Math.floor(Date.now() / 1000) - 30 * 60;
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: `u-${userId}@test.local` }),
      },
      {
        "x-test-email": `u-${userId}@test.local`,
        "x-test-iat": String(staleIat),
      },
    );
    expect(res.status).toBe(428);
    const body = await res.json();
    expect(body.error).toBe("REAUTH_REQUIRED");
    expect(body.reason).toBe("stale_jwt");
    // Stale JWT must NOT trigger destruction.
    expect(supabaseAdmin.adminDeleteUser).not.toHaveBeenCalled();
  });

  it("accepts a JWT just over the 5min window if it's within the 60s clock skew tolerance", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    vi.mocked(supabaseAdmin.isAdminAvailable).mockReturnValue(true);
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    // 5min + 30s old — inside the +60s skew tolerance.
    const skewedIat = Math.floor(Date.now() / 1000) - (5 * 60 + 30);
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: `u-${userId}@test.local` }),
      },
      {
        "x-test-email": `u-${userId}@test.local`,
        "x-test-iat": String(skewedIat),
      },
    );
    expect(res.status).toBe(200);
    expect(supabaseAdmin.adminDeleteUser).toHaveBeenCalledWith(userId);
  });

  it("applies the recent-auth gate UNIFORMLY — OAuth sessions are gated too", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    vi.mocked(supabaseAdmin.isAdminAvailable).mockReturnValue(true);
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    // Same stale JWT, but with provider=google to assert the gate fires
    // regardless of session origin. Carving out OAuth would split the
    // security guarantee — attackers would find the easier path.
    const staleIat = Math.floor(Date.now() / 1000) - 60 * 60;
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: `u-${userId}@test.local` }),
      },
      {
        "x-test-email": `u-${userId}@test.local`,
        "x-test-iat": String(staleIat),
        "x-test-provider": "google",
      },
    );
    expect(res.status).toBe(428);
    const body = await res.json();
    expect(body.error).toBe("REAUTH_REQUIRED");
    expect(supabaseAdmin.adminDeleteUser).not.toHaveBeenCalled();
  });

  it("returns 428 REAUTH_REQUIRED when the JWT lacks an iat claim entirely", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    // Clear adminDeleteUser mock so prior tests' calls don't leak.
    vi.mocked(supabaseAdmin.adminDeleteUser).mockClear();
    // Build a request that bypasses our default-iat shim by passing the
    // header as empty string (the test middleware treats `undefined` as
    // "set iat=now"; an explicit empty string forces NaN → no claim).
    const res = await req(
      userId,
      "/api/user/account",
      {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: `u-${userId}@test.local` }),
      },
      {
        "x-test-email": `u-${userId}@test.local`,
        "x-test-iat": "absent",
      },
    );
    expect(res.status).toBe(428);
    const body = await res.json();
    expect(body.error).toBe("REAUTH_REQUIRED");
    expect(body.reason).toBe("missing_iat");
    expect(supabaseAdmin.adminDeleteUser).not.toHaveBeenCalled();
  });
});

describe("GET /api/user/export", () => {
  // Regression: the bucket-8 ship SELECTed `has_openai_key` as a real column,
  // but it's a computed boolean (`openai_api_key_cipher IS NOT NULL`). The
  // route 500'd in prod before anyone noticed. This test hits every SELECT in
  // buildUserExport against a real schema — any column rename/removal that
  // breaks the export blows up here.
  it("returns a 200 bundle whose shape matches the export contract", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    // Seed a preferences row via the public endpoint so has_openai_key has a
    // row to compute against. This mirrors the production flow — the user's
    // first interaction always hits /preferences before Settings.
    const seedRes = await req(userId, "/api/user/preferences", {
      method: "PATCH",
      body: JSON.stringify({ theme: "light" }),
    });
    expect(seedRes.status).toBe(200);

    const res = await req(userId, "/api/user/export");
    expect(res.status).toBe(200);
    const bundle = await res.json();
    expect(bundle.userId).toBe(userId);
    expect(bundle).toHaveProperty("exportedAt");
    // has_openai_key is the computed flag the export contract promises.
    expect(bundle.preferences).not.toBeNull();
    expect(bundle.preferences).toHaveProperty("has_openai_key", false);
    // Array-shaped tables exist even when empty.
    expect(Array.isArray(bundle.courseProgress)).toBe(true);
    expect(Array.isArray(bundle.lessonProgress)).toBe(true);
    expect(Array.isArray(bundle.aiUsageLedger)).toBe(true);
    expect(Array.isArray(bundle.feedback)).toBe(true);
    expect(Array.isArray(bundle.conceptExposure)).toBe(true);
    expect(Array.isArray(bundle.conceptEvidence)).toBe(true);
    expect(Array.isArray(bundle.retrievalEpisodes)).toBe(true);
    expect(Array.isArray(bundle.retrievalAnswers)).toBe(true);
    // Nullable singletons are null when absent, not undefined.
    expect(bundle.editorProject).toBeNull();
    expect(bundle.paidAccessInterest).toBeNull();
    expect(bundle.platformDenylist).toBeNull();
  });

  it("serves as an attachment with a dated filename", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const res = await req(userId, "/api/user/export");
    expect(res.status).toBe(200);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/attachment; filename="codetutor-export-\d{4}-\d{2}-\d{2}\.json"/);
  });
});
