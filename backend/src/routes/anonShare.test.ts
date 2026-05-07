// Phase A — A3 (anon-share unlock): tests for the anon share creation
// route. Real DB so the migration's owner_ck XOR + ip_hash CHECK +
// public-read RLS are exercised end-to-end. Storage upload + OG render
// are mocked at the kickOffRenders boundary so the test doesn't touch
// the share-og bucket.

import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../services/share/kickOffRenders.js", () => ({
  kickOffRenders: vi.fn(() => undefined),
}));

// Mock the catalog lookup — it reads from disk relative to a path
// shape that's correct in the prod container (`/app/courses`) but not
// in the local backend test runner (`frontend/public/courses` lives in
// the sibling frontend tree). Returning a stable snapshot keeps these
// tests focused on the route's defenses, not catalog wiring.
vi.mock("../services/share/lessonCatalog.js", () => ({
  getLessonSnapshot: vi.fn(async () => ({
    lessonTitle: "Hello, World!",
    lessonOrder: 1,
    courseTitle: "Python Fundamentals",
    courseTotalLessons: 12,
  })),
}));

const { db } = await import("../db/client.js");
const { anonShareRouter } = await import("./anonShare.js");
const { sharesPublicRouter } = await import("./shares.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { kickOffRenders } = await import("../services/share/kickOffRenders.js");

let srv: Server;
let base: string;
let dbReachable = false;
const tokens: string[] = [];

const renderMock = vi.mocked(kickOffRenders);

const sampleBody = (overrides: Partial<Record<string, unknown>> = {}) => ({
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  mastery: "strong" as const,
  timeSpentMs: 360_000,
  attemptCount: 1,
  codeSnippet: 'print("Hello, Maya!")\n',
  displayName: "Maya",
  ...overrides,
});

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    // Confirm the migration's nullable user_id + ip_hash columns exist.
    await db()`SELECT user_id, ip_hash FROM public.shared_lesson_completions LIMIT 0`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const app = express();
  app.use(express.json());
  app.set("trust proxy", true);
  app.use("/api/anon", anonShareRouter);
  // Mount the public read route so the cross-route test can exercise
  // POST /api/anon/shares → GET /api/shares/:token end-to-end.
  app.use("/api/shares", sharesPublicRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
  if (dbReachable && tokens.length) {
    await db()`DELETE FROM public.shared_lesson_completions WHERE share_token = ANY(${tokens}::text[])`;
  }
});

beforeEach(async () => {
  renderMock.mockClear();
  if (dbReachable && tokens.length > 0) {
    await db()`DELETE FROM public.shared_lesson_completions WHERE share_token = ANY(${tokens}::text[])`;
    tokens.length = 0;
  }
});

function postCreate(body: unknown, ip = "10.99.0.1") {
  return fetch(`${base}/api/anon/shares`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/anon/shares", () => {
  it("creates an anon share row keyed by ip_hash (NOT user_id)", async () => {
    if (!dbReachable) return;
    const r = await postCreate(sampleBody());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.shareToken).toMatch(/^[a-z2-9]{12}$/);
    expect(body.url).toBe(`/s/${body.shareToken}`);
    tokens.push(body.shareToken);

    // Verify the row's ownership shape — ip_hash present, user_id null.
    const rows = await db()<
      Array<{ user_id: string | null; ip_hash: string | null }>
    >`
      SELECT user_id, ip_hash
        FROM public.shared_lesson_completions
       WHERE share_token = ${body.shareToken}
    `;
    expect(rows[0]?.user_id).toBeNull();
    expect(rows[0]?.ip_hash).not.toBeNull();
    // sha256 hex = 64 chars.
    expect(rows[0]?.ip_hash?.length).toBe(64);
  });

  it("kicks off the OG render fire-and-forget", async () => {
    if (!dbReachable) return;
    const r = await postCreate(sampleBody());
    expect(r.status).toBe(200);
    tokens.push((await r.json()).shareToken);
    expect(renderMock).toHaveBeenCalledTimes(1);
    const props = renderMock.mock.calls[0]![0];
    expect(props.lessonTitle).toBeTruthy();
    // Server-side lookup — client cannot smuggle a fake title.
    expect(props.lessonTitle).not.toBe("HACKED");
  });

  it("rejects an invalid (course, lesson) pair (400)", async () => {
    if (!dbReachable) return;
    const r = await postCreate(
      sampleBody({ courseId: "javascript-fundamentals" }),
    );
    // The literal-typed zod schema rejects this at the body-parse layer.
    expect(r.status).toBe(400);
  });

  it("rejects oversized codeSnippet (>4 KB)", async () => {
    if (!dbReachable) return;
    const r = await postCreate(sampleBody({ codeSnippet: "x".repeat(4097) }));
    expect(r.status).toBe(400);
  });

  it("rejects a snippet that contains an OPENAI_API_KEY-shaped secret", async () => {
    if (!dbReachable) return;
    const r = await postCreate(
      sampleBody({
        codeSnippet:
          'OPENAI_API_KEY = "sk-realsecretvaluedoesnotbelonghere1234"\nprint("hi")',
      }),
    );
    expect(r.status).toBe(400);
  });

  it("enforces per-IP-per-hour cap (1 / hour)", async () => {
    if (!dbReachable) return;
    const ip = "10.99.0.5";
    const r1 = await postCreate(sampleBody(), ip);
    expect(r1.status).toBe(200);
    tokens.push((await r1.json()).shareToken);
    // Second from same IP within the hour → 429 scope=hour.
    const r2 = await postCreate(sampleBody(), ip);
    expect(r2.status).toBe(429);
    const body = await r2.json();
    expect(body.error).toBe("ANON_SHARE_RATE_LIMITED");
    expect(body.scope).toBe("hour");
  });

  it("the public GET route can read the anon share back (cross-route, no ip_hash leak)", async () => {
    if (!dbReachable) return;
    // POST → returns token.
    const create = await postCreate(sampleBody({ displayName: "Anika" }));
    expect(create.status).toBe(200);
    const { shareToken } = await create.json();
    tokens.push(shareToken);

    // GET /api/shares/:token via the public router. This is the
    // load-bearing path: the row has user_id=NULL, ip_hash set; the
    // SELECT must include ip_hash (matching SharedRowSchema), and
    // the JSON response must NOT leak the ip_hash to the client.
    const r = await fetch(`${base}/api/shares/${shareToken}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.displayName).toBe("Anika");
    expect(body.lessonTitle).toBe("Hello, World!");
    // Privacy invariant: ip_hash never returned to public clients.
    expect(body.ipHash).toBeUndefined();
    expect(body.ip_hash).toBeUndefined();
    // user_id is NOT exposed on the public route either.
    expect(body.userId).toBeUndefined();
  });

  it("scrubs control characters from displayName before persisting", async () => {
    if (!dbReachable) return;
    // ‮ is right-to-left override — sanitizeDisplayName strips it.
    const r = await postCreate(
      sampleBody({ displayName: `Maya‮${randomUUID()}` }),
    );
    expect(r.status).toBe(200);
    const { shareToken } = await r.json();
    tokens.push(shareToken);
    const rows = await db()<Array<{ display_name: string | null }>>`
      SELECT display_name
        FROM public.shared_lesson_completions
       WHERE share_token = ${shareToken}
    `;
    // The RTL char must NOT appear in the persisted name.
    expect(rows[0]?.display_name).not.toContain("‮");
  });
});
