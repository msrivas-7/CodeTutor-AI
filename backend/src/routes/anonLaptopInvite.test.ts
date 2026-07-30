// Phase A — A2 (device contract): tests for the magic-link graduation
// handoff. Real DB so the migration's CHECK + UNIQUE + CHECK
// constraints are exercised; ACS email send is mocked at the module
// level (tests assert call shape, not delivery). Skips cleanly when
// DATABASE_URL is unreachable (matches the shares.test.ts pattern).

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Mock ACS BEFORE importing the route — else the route's imported
// reference is the real implementation.
vi.mock("../services/email/acsClient.js", async () => {
  const actual = await vi.importActual<typeof import("../services/email/acsClient.js")>(
    "../services/email/acsClient.js",
  );
  return {
    ...actual,
    sendEmail: vi.fn(async () => ({ id: "mock-email-id" })),
  };
});

const { db } = await import("../db/client.js");
const { anonLaptopInviteRouter } = await import("./anonLaptopInvite.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { sendEmail } = await import("../services/email/acsClient.js");
const { hashEmail } = await import("../services/ai/ipHash.js");

let srv: Server;
let base: string;
let dbReachable = false;
const tokens: string[] = [];

const sendEmailMock = vi.mocked(sendEmail);

const validBody = (overrides: Partial<Record<string, unknown>> = {}) => ({
  email: `maya-${randomUUID()}@example.test`,
  code: 'print("Hello, Maya!")\n',
  name: "Maya",
  ...overrides,
});

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    await db()`SELECT 1 FROM public.anon_laptop_invites LIMIT 0`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const app = express();
  app.use(express.json());
  // Trust X-Forwarded-For from the test harness so req.ip varies per test.
  app.set("trust proxy", true);
  app.use("/api/anon", anonLaptopInviteRouter);
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
    await db()`DELETE FROM public.anon_laptop_invites WHERE token = ANY(${tokens}::text[])`;
  }
});

beforeEach(async () => {
  sendEmailMock.mockClear();
  // Per-test cleanup: only delete the rows THIS test file's tests
  // accumulated. The shared dev DB may have rows from concurrent test
  // runs or from manual dev work; we must not nuke those. The test
  // emails are random UUIDs (see validBody), so scoping the delete to
  // the tracked tokens array is sufficient to keep the per-IP / per-
  // email caps clean across tests.
  if (dbReachable && tokens.length > 0) {
    await db()`DELETE FROM public.anon_laptop_invites WHERE token = ANY(${tokens}::text[])`;
    tokens.length = 0;
  }
});

function postCreate(body: unknown, ip = "10.0.0.1") {
  return fetch(`${base}/api/anon/laptop-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function postRedeem(token: string) {
  return fetch(`${base}/api/anon/laptop-link/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/anon/laptop-link", () => {
  it("creates an invite + sends an email + returns the magic-link URL", async () => {
    if (!dbReachable) return;
    const r = await postCreate(validBody());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    // URL shape: <base>/start?invite=<token>
    expect(body.url).toMatch(/\/start\?invite=[a-z2-9]{12}$/);
    const token = new URL(body.url).searchParams.get("invite")!;
    expect(token).toMatch(/^[a-z2-9]{12}$/);
    tokens.push(token);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]![0];
    expect(call.subject).toMatch(/lesson 2/i);
    expect(call.text).toContain(body.url);
  });

  it("does NOT store the raw email — only the email_hash", async () => {
    if (!dbReachable) return;
    const email = `priya-${randomUUID()}@example.test`;
    const r = await postCreate(validBody({ email }));
    expect(r.status).toBe(200);
    const { url } = await r.json();
    const token = new URL(url).searchParams.get("invite")!;
    tokens.push(token);

    const rows = await db()<
      { email_hash: string; raw_search: number }[]
    >`
      SELECT email_hash,
             COUNT(*) FILTER (WHERE email_hash = ${email}) AS raw_search
        FROM public.anon_laptop_invites
       WHERE token = ${token}
       GROUP BY email_hash
    `;
    expect(rows[0]?.email_hash).not.toBe(email);
    // sha256 hex = 64 chars.
    expect(rows[0]?.email_hash.length).toBe(64);
  });

  it("rejects malformed email (400 INVALID_BODY)", async () => {
    if (!dbReachable) return;
    const r = await postCreate(validBody({ email: "not-an-email" }));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("INVALID_BODY");
  });

  it("rejects oversized code (>4KB)", async () => {
    if (!dbReachable) return;
    const r = await postCreate(validBody({ code: "x".repeat(4097) }));
    expect(r.status).toBe(400);
  });

  it("enforces per-IP cap (3 / 24h)", async () => {
    if (!dbReachable) return;
    const ip = "10.0.0.42";
    // Three sends from the same IP, each with a different email so
    // the per-email cap doesn't fire first.
    for (let i = 0; i < 3; i++) {
      const r = await postCreate(
        validBody({ email: `t${i}-${randomUUID()}@example.test` }),
        ip,
      );
      expect(r.status).toBe(200);
      const { url } = await r.json();
      tokens.push(new URL(url).searchParams.get("invite")!);
    }
    // Fourth from same IP → 429.
    const r4 = await postCreate(
      validBody({ email: `t4-${randomUUID()}@example.test` }),
      ip,
    );
    expect(r4.status).toBe(429);
    const body = await r4.json();
    expect(body.error).toBe("ANON_LAPTOP_INVITE_RATE_LIMITED");
    expect(body.scope).toBe("ip");
  });

  it("enforces per-email cap (1 / 24h) even from rotated IPs", async () => {
    if (!dbReachable) return;
    const email = `dup-${randomUUID()}@example.test`;
    const r1 = await postCreate(validBody({ email }), "10.0.1.1");
    expect(r1.status).toBe(200);
    tokens.push(new URL((await r1.json()).url).searchParams.get("invite")!);
    // Same email, different IP → still 429.
    const r2 = await postCreate(validBody({ email }), "10.0.1.2");
    expect(r2.status).toBe(429);
    const body = await r2.json();
    expect(body.scope).toBe("email");
  });

  // Review finding (PR #9, P1): the caps used to be read-then-write
  // across separate statements, so a concurrent burst all observed the
  // same pre-insert count, all passed, and all inserted — sending far
  // more mail than the advertised caps from an unauthenticated route.
  // reserveAndCreateInvite now does check+insert in one advisory-locked
  // transaction. These two tests fire genuinely parallel requests; they
  // fail against the old sequential implementation.
  // Generous timeout: the advisory lock makes these requests serialize
  // by design, and each one round-trips to a remote Supabase — the
  // default 5s isn't enough for 6–8 sequential trips.
  it("per-email cap holds under concurrent bursts (no double-send)", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const email = `burst-${randomUUID()}@example.test`;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        postCreate(validBody({ email }), `10.0.2.${i + 1}`),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    const limited = results.filter((r) => r.status === 429);
    for (const r of ok) {
      tokens.push(new URL((await r.json()).url).searchParams.get("invite")!);
    }
    // Exactly one send may win; every other must be refused.
    expect(ok.length).toBe(1);
    expect(limited.length).toBe(5);

    // The row count is the ground truth the email volume follows.
    const emailHash = hashEmail(email);
    const rows = await db()<{ n: number }[]>`
      SELECT COUNT(*)::int AS n
        FROM public.anon_laptop_invites
       WHERE email_hash = ${emailHash}
    `;
    expect(rows[0]!.n).toBe(1);
  });

  it("per-IP cap holds under concurrent bursts", { timeout: 60_000 }, async () => {
    if (!dbReachable) return;
    const ip = "10.0.3.77";
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        postCreate(
          validBody({ email: `ipburst-${randomUUID()}@example.test` }),
          ip,
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 200);
    for (const r of ok) {
      tokens.push(new URL((await r.json()).url).searchParams.get("invite")!);
    }
    // PER_IP_CAP is 3 — no more may slip through, whatever the timing.
    expect(ok.length).toBe(3);
    expect(results.filter((r) => r.status === 429).length).toBe(5);
  });

  // Review finding (PR #9, P2): Zod's .max() counts UTF-16 code units
  // but the DB CHECK is octet_length — so multibyte code in the 2–4k
  // character range passed validation and then died on the insert,
  // surfacing as a 500 instead of a bounded 400.
  it("rejects over-4096-BYTE code with 400, not a 500 from the DB CHECK", async () => {
    if (!dbReachable) return;
    // 1500 × 3-byte chars = 4500 bytes, but only 1500 JS length units.
    const multibyte = "あ".repeat(1500);
    expect(multibyte.length).toBeLessThan(4096);
    expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(4096);
    const r = await postCreate(validBody({ code: multibyte }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("INVALID_BODY");
  });

  it("accepts multibyte code that fits inside the byte budget", async () => {
    if (!dbReachable) return;
    const multibyte = "あ".repeat(100); // 300 bytes
    const r = await postCreate(validBody({ code: multibyte }));
    expect(r.status).toBe(200);
    tokens.push(new URL((await r.json()).url).searchParams.get("invite")!);
  });
});

describe("POST /api/anon/laptop-link/redeem", () => {
  it("returns the stashed code + name on first redemption", async () => {
    if (!dbReachable) return;
    const create = await postCreate(validBody());
    const { url } = await create.json();
    const token = new URL(url).searchParams.get("invite")!;
    tokens.push(token);

    const r = await postRedeem(token);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.code).toBe('print("Hello, Maya!")\n');
    expect(body.name).toBe("Maya");
    // Crucially: NO raw email or email_hash leaks back to the client.
    expect(body.email).toBeUndefined();
    expect(body.email_hash).toBeUndefined();
  });

  it("rejects a second redemption attempt as INVITE_USED (single-use)", async () => {
    if (!dbReachable) return;
    const create = await postCreate(validBody());
    const { url } = await create.json();
    const token = new URL(url).searchParams.get("invite")!;
    tokens.push(token);

    const first = await postRedeem(token);
    expect(first.status).toBe(200);
    const second = await postRedeem(token);
    expect(second.status).toBe(410);
    expect((await second.json()).error).toBe("INVITE_USED");
  });

  it("rejects an unknown token as INVITE_NOT_FOUND", async () => {
    if (!dbReachable) return;
    const r = await postRedeem("aaaaaaaaaaaa");
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("INVITE_NOT_FOUND");
  });

  it("rejects an expired invite as INVITE_EXPIRED", async () => {
    if (!dbReachable) return;
    // Insert a row directly with created_at 8 days ago and expires_at
    // 8 days ago + 1 second — well past `now()` but still satisfying the
    // DB CHECK (expires_at > created_at AND <= created_at + 7d). The
    // create-route path can't produce this shape (it always sets
    // created_at = now()), so the test goes around it.
    const token = "expiredaaaaa";
    tokens.push(token);
    await db()`
      INSERT INTO public.anon_laptop_invites
        (token, email_hash, ip_hash, code, name, created_at, expires_at)
      VALUES
        (${token},
         'a'::text || repeat('0', 63),
         'b'::text || repeat('0', 63),
         'print("Hello, X!")',
         'X',
         NOW() - INTERVAL '8 days',
         NOW() - INTERVAL '8 days' + INTERVAL '1 second')
    `;
    const r = await postRedeem(token);
    expect(r.status).toBe(410);
    expect((await r.json()).error).toBe("INVITE_EXPIRED");
  });

  it("rejects a malformed token as 400 INVALID_TOKEN", async () => {
    if (!dbReachable) return;
    const r = await postRedeem("NOT-A-TOKEN");
    expect(r.status).toBe(400);
  });
});
