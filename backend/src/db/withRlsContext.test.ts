// Phase 26 (audit C-3): contract tests for withRlsContext.
//
// These verify the SET-LOCAL-ROLE pattern actually scopes queries —
// without this test, every "migrated to RLS" claim about a DB module is
// just hope. Each test seeds two users and verifies that user A inside
// a withRlsContext block CANNOT see user B's row, even when issuing a
// query with no WHERE clause.
//
// Skips cleanly when DATABASE_URL is unreachable (CI without Supabase
// access). When connected, exercises real RLS policies + auth.uid().

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb, db, withRlsContext } from "./client.js";

// Skip predicate evaluated at COLLECTION time (vitest's it.skipIf is
// not deferred to beforeAll). Sync check on env presence is the cheapest
// signal that "we're in an environment where the DB might be reachable" —
// beforeAll then does the actual probe + flips dbReachable to false on
// any catch, which short-circuits the test bodies with an early return.
const HAS_DB_URL = !!process.env.DATABASE_URL;
let dbReachable = HAS_DB_URL;
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

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    await db()`SELECT 1 FROM public.user_preferences LIMIT 0`;
    const rows = await db()<Array<{ rolname: string }>>`
      SELECT rolname FROM pg_roles WHERE rolname = 'authenticated'
    `;
    if (rows.length === 0) {
      console.warn(
        "[withRlsContext test] 'authenticated' role missing — skipping",
      );
      dbReachable = false;
      return;
    }
    dbReachable = true;
  } catch (err) {
    console.warn(
      `[withRlsContext test] beforeAll failed → tests will skip: ${(err as Error).message}`,
    );
    dbReachable = false;
  }
});

afterAll(async () => {
  if (dbReachable && userIds.length) {
    await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

describe("withRlsContext", () => {
  it.skipIf(!HAS_DB_URL)(
    "rejects empty userId before opening any transaction",
    async () => {
      await expect(
        withRlsContext("", async (tx) => tx`SELECT 1`),
      ).rejects.toThrow(/non-empty userId/);
    },
  );

  it.skipIf(!HAS_DB_URL)(
    "scopes user_preferences SELECT to the calling user",
    async () => {
      const alice = await mkUser();
      const bob = await mkUser();

      // Seed each user's preferences row via the service-role connection
      // (bypasses RLS) so the test data exists regardless of policy
      // posture. The actual assertion runs INSIDE withRlsContext.
      await db()`
        INSERT INTO public.user_preferences (user_id, persona)
        VALUES (${alice}, 'beginner'), (${bob}, 'advanced')
      `;

      try {
        // Alice's context — query with NO WHERE clause. Without RLS the
        // service-role connection sees both rows; with RLS scoped to
        // Alice's auth.uid(), she should see only her own.
        const aliceRows = await withRlsContext(alice, async (tx) => {
          return await tx<Array<{ user_id: string; persona: string }>>`
            SELECT user_id, persona FROM public.user_preferences
          `;
        });
        expect(aliceRows).toHaveLength(1);
        expect(aliceRows[0].user_id).toBe(alice);
        expect(aliceRows[0].persona).toBe("beginner");

        // Bob's context — same query, different scope.
        const bobRows = await withRlsContext(bob, async (tx) => {
          return await tx<Array<{ user_id: string; persona: string }>>`
            SELECT user_id, persona FROM public.user_preferences
          `;
        });
        expect(bobRows).toHaveLength(1);
        expect(bobRows[0].user_id).toBe(bob);
        expect(bobRows[0].persona).toBe("advanced");

        // Cross-user attempt — Alice's context tries to read Bob's row by id.
        // RLS filters before evaluation; result is 0 rows, NOT a 403.
        const cross = await withRlsContext(alice, async (tx) => {
          return await tx`
            SELECT user_id FROM public.user_preferences WHERE user_id = ${bob}
          `;
        });
        expect(cross).toHaveLength(0);
      } finally {
        await db()`
          DELETE FROM public.user_preferences WHERE user_id = ANY(${[alice, bob]}::uuid[])
        `;
      }
    },
  );

  it.skipIf(!HAS_DB_URL)(
    "service-role outside the wrapper still sees everything (cross-user paths unaffected)",
    async () => {
      const alice = await mkUser();
      const bob = await mkUser();
      await db()`
        INSERT INTO public.user_preferences (user_id, persona)
        VALUES (${alice}, 'beginner'), (${bob}, 'advanced')
      `;
      try {
        // Standard service-role read — admin paths use this. Both rows
        // present.
        const all = await db()<Array<{ user_id: string }>>`
          SELECT user_id FROM public.user_preferences
           WHERE user_id = ANY(${[alice, bob]}::uuid[])
        `;
        expect(all).toHaveLength(2);
      } finally {
        await db()`
          DELETE FROM public.user_preferences WHERE user_id = ANY(${[alice, bob]}::uuid[])
        `;
      }
    },
  );

  it.skipIf(!HAS_DB_URL)(
    "INSERT under RLS context with mismatched user_id is rejected by WITH CHECK",
    async () => {
      const alice = await mkUser();
      const bob = await mkUser();
      // Alice's RLS context tries to insert a row claiming user_id=Bob.
      // The user_preferences policy has WITH CHECK (auth.uid() = user_id),
      // so this MUST fail — defense against a route handler bug that
      // accidentally writes to the wrong user.
      await expect(
        withRlsContext(alice, async (tx) => {
          await tx`
            INSERT INTO public.user_preferences (user_id, persona)
            VALUES (${bob}, 'beginner')
          `;
        }),
      ).rejects.toThrow();

      // Cleanup: verify NO row was inserted (RLS rejected; nothing else
      // wrote during the failed transaction).
      const rows = await db()<Array<{ user_id: string }>>`
        SELECT user_id FROM public.user_preferences
         WHERE user_id = ANY(${[alice, bob]}::uuid[])
      `;
      expect(rows).toHaveLength(0);
    },
  );

  it.skipIf(!HAS_DB_URL)(
    "transaction error rolls back any partial RLS-scoped writes",
    async () => {
      const alice = await mkUser();
      try {
        await expect(
          withRlsContext(alice, async (tx) => {
            await tx`
              INSERT INTO public.user_preferences (user_id, persona)
              VALUES (${alice}, 'beginner')
            `;
            throw new Error("intentional rollback");
          }),
        ).rejects.toThrow(/intentional rollback/);
        const rows = await db()`
          SELECT user_id FROM public.user_preferences WHERE user_id = ${alice}
        `;
        expect(rows).toHaveLength(0);
      } finally {
        await db()`DELETE FROM public.user_preferences WHERE user_id = ${alice}`;
      }
    },
  );
});
