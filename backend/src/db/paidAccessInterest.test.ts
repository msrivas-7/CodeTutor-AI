// Integration tests for paid_access_interest. Matches the superuser-connected
// pattern in userData.test.ts — we insert into auth.users directly, so this
// only runs against a Postgres where the test role can write to auth.* (not
// the cloud transaction pooler). Skips cleanly when DB is unreachable.
//
// Round 7: covers the monotonic-once-true behavior of denylisted_at_click so
// a user denylisted-then-un-denylisted doesn't lose the banned-lead signal
// on their next click. Claim "DB-side flag behavior is unit-tested" in
// e2e/specs/free-tier.spec.ts now has a real backing here.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const { db, closeDb } = await import("./client.js");
const pai = await import("./paidAccessInterest.js");
const prefs = await import("./preferences.js");

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

async function readRow(userId: string) {
  const rows = await db()<
    Array<{
      click_count: number;
      denylisted_at_click: boolean;
      email: string;
      display_name: string | null;
    }>
  >`
    SELECT click_count, denylisted_at_click, email, display_name
      FROM public.paid_access_interest
     WHERE user_id = ${userId}
  `;
  return rows[0] ?? null;
}

// Same env-gate as userData.test.ts: we only attempt any DB work when the
// caller has explicitly opted in via RUN_DB_TESTS=1 or the CI env. A dev
// who happens to have prod DATABASE_URL exported would otherwise trip the
// SELECT 1 reachability check and then get a `permission denied for schema
// auth` error on mkUser — or worse, succeed against a superuser-configured
// staging DB. The gate keeps this suite strictly opt-in.
const DB_TESTS_ENABLED =
  process.env.RUN_DB_TESTS === "1" || process.env.CI === "true";

beforeAll(async () => {
  if (!DB_TESTS_ENABLED) {
    dbReachable = false;
    return;
  }
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
    // The paid_access_interest and user_preferences rows FK-cascade via
    // auth.users → but user_preferences doesn't cascade on delete today,
    // so clear the denorm column explicitly before user cleanup.
    await sql`DELETE FROM public.user_preferences WHERE user_id = ANY(${userIds}::uuid[])`;
    await sql`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

describe("db/paidAccessInterest", () => {
  it("upsert inserts a row with denylisted_at_click=false by default", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    const { clickCount } = await pai.upsertPaidAccessInterest(userId);
    expect(clickCount).toBe(1);
    const row = await readRow(userId);
    expect(row?.denylisted_at_click).toBe(false);
  });

  it("upsert records denylisted_at_click=true when opted in", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await pai.upsertPaidAccessInterest(userId, { denylistedAtClick: true });
    const row = await readRow(userId);
    expect(row?.denylisted_at_click).toBe(true);
  });

  it("denylisted_at_click is monotonic-once-true: clean click after a denylisted click keeps the flag", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    // First click: denylisted
    await pai.upsertPaidAccessInterest(userId, { denylistedAtClick: true });
    // Second click: user is no longer denylisted (e.g., operator unbanned them)
    const { clickCount } = await pai.upsertPaidAccessInterest(userId, {
      denylistedAtClick: false,
    });
    expect(clickCount).toBe(2);
    const row = await readRow(userId);
    // Monotonic-once-true: we still need to know the user was denylisted at
    // some point, because that's the signal the operator uses to triage.
    expect(row?.denylisted_at_click).toBe(true);
  });

  it("clean-then-denylisted click sets the flag on the later state", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await pai.upsertPaidAccessInterest(userId, { denylistedAtClick: false });
    await pai.upsertPaidAccessInterest(userId, { denylistedAtClick: true });
    const row = await readRow(userId);
    expect(row?.denylisted_at_click).toBe(true);
    expect(row?.click_count).toBe(2);
  });

  it("delete removes the row and the denormed user_preferences flag flips to false", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await pai.upsertPaidAccessInterest(userId);
    // P-M7: presence flag is served from user_preferences.paid_access_shown_at
    // so /ai-status can read it in the same PK lookup as the BYOK cipher.
    expect((await prefs.getAIStatusPrefs(userId)).hasShownPaidInterest).toBe(true);
    await pai.deletePaidAccessInterest(userId);
    expect((await prefs.getAIStatusPrefs(userId)).hasShownPaidInterest).toBe(false);
    expect(await readRow(userId)).toBeNull();
  });

  it("upsert mirrors paid_access_shown_at onto user_preferences", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await pai.upsertPaidAccessInterest(userId);
    const rows = await db()<Array<{ paid_access_shown_at: Date | null }>>`
      SELECT paid_access_shown_at
        FROM public.user_preferences
       WHERE user_id = ${userId}
    `;
    expect(rows[0]?.paid_access_shown_at).toBeInstanceOf(Date);
  });

  it("repeat upserts preserve the first-click timestamp on user_preferences", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await pai.upsertPaidAccessInterest(userId);
    const firstRows = await db()<Array<{ paid_access_shown_at: Date | null }>>`
      SELECT paid_access_shown_at FROM public.user_preferences WHERE user_id = ${userId}
    `;
    const first = firstRows[0]?.paid_access_shown_at;
    expect(first).toBeInstanceOf(Date);
    // Sleep a tick so now() would move forward if COALESCE is broken.
    await new Promise((r) => setTimeout(r, 30));
    await pai.upsertPaidAccessInterest(userId);
    const secondRows = await db()<Array<{ paid_access_shown_at: Date | null }>>`
      SELECT paid_access_shown_at FROM public.user_preferences WHERE user_id = ${userId}
    `;
    expect(secondRows[0]?.paid_access_shown_at?.toISOString()).toBe(
      first?.toISOString(),
    );
  });

  it("re-upsert after delete starts fresh with click_count=1", async () => {
    if (!dbReachable) return;
    const userId = await mkUser();
    await pai.upsertPaidAccessInterest(userId, { denylistedAtClick: true });
    await pai.deletePaidAccessInterest(userId);
    const { clickCount } = await pai.upsertPaidAccessInterest(userId, {
      denylistedAtClick: false,
    });
    // Fresh row — monotonic OR only applies within a row's lifetime. A
    // deleted-then-reinserted row should reflect the new click's state.
    expect(clickCount).toBe(1);
    const row = await readRow(userId);
    expect(row?.denylisted_at_click).toBe(false);
  });
});
