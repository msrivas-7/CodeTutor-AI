// Phase A — A6 (memory v0): tests for the concept-tag ledger writer.
// Real DB so the migration's owner_ck XOR + UNIQUE partial indexes are
// exercised end-to-end.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const { db } = await import("./client.js");
const { writeConceptTags } = await import("./conceptLedger.js");

let dbReachable = false;
const userIds: string[] = [];
const ipHashes: string[] = [];

async function mkUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (${id}, 'authenticated', 'authenticated', ${`u-${id}@test.local`}, '{}'::jsonb, '{}'::jsonb, now(), now())
  `;
  userIds.push(id);
  return id;
}

function mkIpHash(): string {
  // 64-char hex (sha256 length) so the column-shape CHECK passes.
  // Random per call so each test has its own IP-hash key.
  const h = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  ipHashes.push(h);
  return h;
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    await db()`SELECT 1 FROM public.learner_concept_ledger LIMIT 0`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  if (ipHashes.length) {
    await db()`DELETE FROM public.learner_concept_ledger WHERE ip_hash = ANY(${ipHashes}::text[])`;
  }
  if (userIds.length) {
    // ON DELETE CASCADE on user_id removes ledger rows automatically.
    await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
});

beforeEach(async () => {
  if (!dbReachable) return;
  // No global wipe — keep tests isolated by per-test users / ip_hashes.
});

describe("writeConceptTags (authed/userId path)", () => {
  it("writes one row per (concept_tag, event_type) pair on first call", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const written = await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print", "strings"],
      used: ["syntax"],
    });
    expect(written).toBe(3);
    const rows = await db()<
      Array<{ concept_tag: string; event_type: string }>
    >`
      SELECT concept_tag, event_type
        FROM public.learner_concept_ledger
       WHERE user_id = ${userId}
       ORDER BY concept_tag
    `;
    expect(rows.map((r) => r.concept_tag)).toEqual([
      "print",
      "strings",
      "syntax",
    ]);
    expect(rows.find((r) => r.concept_tag === "print")?.event_type).toBe("taught");
    expect(rows.find((r) => r.concept_tag === "syntax")?.event_type).toBe("used");
  });

  it("re-completing the same lesson is idempotent (returns 0 inserted)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print"],
    });
    const second = await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print"],
    });
    expect(second).toBe(0);
    const rows = await db()<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM public.learner_concept_ledger
       WHERE user_id = ${userId}
    `;
    expect(rows[0]?.count).toBe(1);
  });

  it("writes a separate row for each event_type on the same concept", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print"],
    });
    await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      practiced: ["print"],
    });
    // The UNIQUE index is over (user_id, course_id, lesson_id,
    // concept_tag, event_type) — different event_type means a separate
    // row, not a conflict.
    const rows = await db()<
      Array<{ event_type: string }>
    >`
      SELECT event_type
        FROM public.learner_concept_ledger
       WHERE user_id = ${userId}
         AND concept_tag = 'print'
       ORDER BY event_type
    `;
    expect(rows.map((r) => r.event_type)).toEqual(["practiced", "taught"]);
  });

  it("dedups + trims tags before insert", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const written = await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      // Duplicate "print", whitespace, and an empty string — should
      // collapse to one valid row.
      taught: ["print", " print ", "print", "", "  "],
    });
    expect(written).toBe(1);
  });
});

describe("writeConceptTags (anon/ipHash path)", () => {
  it("writes ip_hash-keyed rows with user_id NULL", async () => {
    if (!dbReachable) return;
    const ipHash = mkIpHash();
    await writeConceptTags({
      ipHash,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print", "strings", "syntax"],
    });
    const rows = await db()<
      Array<{ user_id: string | null; ip_hash: string; event_type: string }>
    >`
      SELECT user_id, ip_hash, event_type
        FROM public.learner_concept_ledger
       WHERE ip_hash = ${ipHash}
    `;
    expect(rows.length).toBe(3);
    rows.forEach((r) => {
      expect(r.user_id).toBeNull();
      expect(r.ip_hash).toBe(ipHash);
      expect(r.event_type).toBe("taught");
    });
  });

  it("anon and authed paths are independent (anon row doesn't suppress authed write)", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const ipHash = mkIpHash();
    await writeConceptTags({
      ipHash,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print"],
    });
    // Same lesson + concept under userId → NEW row (the unique
    // partial indexes are per-key, not cross-key).
    const written = await writeConceptTags({
      userId,
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      taught: ["print"],
    });
    expect(written).toBe(1);
  });
});

describe("writeConceptTags input validation", () => {
  it("throws when both userId and ipHash are set (owner_ck XOR)", async () => {
    if (!dbReachable) return;
    await expect(
      writeConceptTags({
        userId: "00000000-0000-0000-0000-000000000000",
        ipHash: mkIpHash(),
        courseId: "x",
        lessonId: "y",
        taught: ["t"],
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("throws when neither userId nor ipHash is set", async () => {
    if (!dbReachable) return;
    await expect(
      writeConceptTags({
        courseId: "x",
        lessonId: "y",
        taught: ["t"],
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("returns 0 when no tags are passed", async () => {
    if (!dbReachable) return;
    const written = await writeConceptTags({
      ipHash: mkIpHash(),
      courseId: "x",
      lessonId: "y",
    });
    expect(written).toBe(0);
  });
});
