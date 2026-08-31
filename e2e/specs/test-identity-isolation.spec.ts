import { expect, test } from "@playwright/test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  buildCurrentRunTestEmail,
  deleteCurrentRunTestUser,
  extractTestRunSuffix,
  isCurrentRunTestEmail,
  isRecognizedCiRunSuffix,
  reapAbandonedCiTestUsers,
  requireCurrentRunSuffix,
  shouldReapAbandonedCiUsers,
  teardownCurrentRunTestUsers,
} from "../fixtures/testIdentity";

type FakeAdmin = {
  client: SupabaseClient;
  deletedIds: string[];
};

function fakeUser(
  id: string,
  email: string,
  createdAt = "2026-07-29T00:00:00.000Z",
): User {
  return { id, email, created_at: createdAt } as User;
}

function createFakeAdmin(users: User[]): FakeAdmin {
  const deletedIds: string[] = [];
  const client = {
    auth: {
      admin: {
        listUsers: async ({ page }: { page: number }) => ({
          data: { users: page === 1 ? users : [] },
          error: null,
        }),
        deleteUser: async (id: string) => {
          deletedIds.push(id);
          return { data: { user: null }, error: null };
        },
      },
    },
  } as unknown as SupabaseClient;
  return { client, deletedIds };
}

test.describe("test identity namespace guard", () => {
  test("run A cleanup cannot delete run B or non-test identities", async () => {
    const runA = "shard-1-run100-attempt1";
    const runB = "shard-1-run101-attempt1";
    const userA = fakeUser("run-a", buildCurrentRunTestEmail("w0", runA));
    const userB = fakeUser("run-b", buildCurrentRunTestEmail("w0", runB));
    const wrongDomain = fakeUser(
      "wrong-domain",
      `e2e-w0-${runA}@example.com`,
    );
    const realUser = fakeUser("real-user", "learner@codetutor.test");
    const fake = createFakeAdmin([userA, userB, wrongDomain, realUser]);

    const report = await teardownCurrentRunTestUsers(fake.client, runA);

    expect(report).toEqual({
      scanned: 4,
      matched: 1,
      deleted: 1,
      foreignSkipped: 3,
    });
    expect(fake.deletedIds).toEqual([userA.id]);

    await expect(
      deleteCurrentRunTestUser(fake.client, userB, runA),
    ).rejects.toThrow(/outside the current run namespace/i);
    expect(fake.deletedIds).toEqual([userA.id]);
  });

  test("requires the exact suffix and approved domain", () => {
    const suffix = "shard-6-run999-attempt2";
    const email = buildCurrentRunTestEmail("auth-a1", suffix);

    expect(isCurrentRunTestEmail(email, suffix)).toBe(true);
    expect(isCurrentRunTestEmail(email, "run999-attempt2")).toBe(false);
    expect(
      isCurrentRunTestEmail(
        email.replace("codetutor.test", "example.com"),
        suffix,
      ),
    ).toBe(false);
    expect(
      isCurrentRunTestEmail(`learner-${suffix}@codetutor.test`, suffix),
    ).toBe(false);
    expect(() => requireCurrentRunSuffix("")).toThrow(/deletion refused/i);
    expect(extractTestRunSuffix(email)).toBe(suffix);
    expect(extractTestRunSuffix(`e2e-w0-${suffix}@codetutor.test`)).toBeNull();
  });

  test("only the shard-1 CI leader runs the abandoned-user janitor", () => {
    expect(shouldReapAbandonedCiUsers("shard-1-run100-attempt1")).toBe(true);
    expect(shouldReapAbandonedCiUsers("shard-2-run100-attempt1")).toBe(false);
    expect(shouldReapAbandonedCiUsers("security-run100-attempt1")).toBe(false);
    expect(shouldReapAbandonedCiUsers("local-100")).toBe(false);
  });

  test("recognizes every calibrated benchmark namespace for abandoned cleanup", () => {
    for (const total of [6, 8, 10, 12, 14, 16, 17, 20]) {
      for (const shard of [1, total]) {
        expect(
          isRecognizedCiRunSuffix(
            `benchmark-${total}-${shard}-run100-attempt1`,
          ),
        ).toBe(true);
      }
    }

    expect(
      isRecognizedCiRunSuffix("benchmark-20-21-run100-attempt1"),
    ).toBe(false);
    expect(
      isRecognizedCiRunSuffix("benchmark-6-20-run100-attempt1"),
    ).toBe(false);
    expect(
      isRecognizedCiRunSuffix("benchmark-50-1-run100-attempt1"),
    ).toBe(false);
  });

  test("reaps only recognized CI users older than 24 hours", async () => {
    const old = "2026-07-28T00:00:00.000Z";
    const recent = "2026-07-29T18:00:00.000Z";
    const staleShard = fakeUser(
      "stale-shard",
      buildCurrentRunTestEmail("w0", "shard-3-run80-attempt1"),
      old,
    );
    const staleSecurity = fakeUser(
      "stale-security",
      buildCurrentRunTestEmail("w0", "security-run81-attempt2"),
      old,
    );
    const staleBenchmark = fakeUser(
      "stale-benchmark",
      buildCurrentRunTestEmail("w0", "benchmark-10-7-run83-attempt1"),
      old,
    );
    const recentCi = fakeUser(
      "recent-ci",
      buildCurrentRunTestEmail("w0", "shard-6-run82-attempt1"),
      recent,
    );
    const staleLocal = fakeUser(
      "stale-local",
      buildCurrentRunTestEmail("w0", "security-local-123-abc"),
      old,
    );
    const foreign = fakeUser("foreign", "learner@codetutor.test", old);
    const fake = createFakeAdmin([
      staleShard,
      staleSecurity,
      staleBenchmark,
      recentCi,
      staleLocal,
      foreign,
    ]);

    const report = await reapAbandonedCiTestUsers(fake.client, {
      now: new Date("2026-07-30T00:00:00.000Z"),
    });

    expect(report).toEqual({
      scanned: 6,
      eligible: 3,
      deleted: 3,
      truncated: false,
    });
    expect(fake.deletedIds).toEqual([
      staleShard.id,
      staleSecurity.id,
      staleBenchmark.id,
    ]);
  });

  test("abandoned-user janitor enforces its age floor and batch ceiling", async () => {
    const users = Array.from({ length: 3 }, (_, index) =>
      fakeUser(
        `stale-${index}`,
        buildCurrentRunTestEmail(`w${index}`, `shard-2-run${90 + index}-attempt1`),
        "2026-07-20T00:00:00.000Z",
      ),
    );
    const fake = createFakeAdmin(users);

    await expect(
      reapAbandonedCiTestUsers(fake.client, { minimumAgeMs: 1 }),
    ).rejects.toThrow(/at least 24 hours/i);

    const report = await reapAbandonedCiTestUsers(fake.client, {
      now: new Date("2026-07-30T00:00:00.000Z"),
      maxDeletes: 2,
    });
    expect(report).toEqual({
      scanned: 3,
      eligible: 3,
      deleted: 2,
      truncated: true,
    });
    expect(fake.deletedIds).toHaveLength(2);
  });

  test("600 varied overlapping namespaces record zero cross-run deletions", async () => {
    for (let iteration = 0; iteration < 600; iteration += 1) {
      const runA = `shard-${(iteration % 10) + 1}-run${1000 + iteration}-attempt1`;
      const runB = `shard-${((iteration + 1) % 10) + 1}-run${2000 + iteration}-attempt2`;
      const a = fakeUser(`a-${iteration}`, buildCurrentRunTestEmail("w0", runA));
      const b = fakeUser(`b-${iteration}`, buildCurrentRunTestEmail("w1", runB));
      const order = iteration % 2 === 0 ? [a, b] : [b, a];
      const fake = createFakeAdmin(order);

      await teardownCurrentRunTestUsers(fake.client, runA);

      expect(fake.deletedIds).toEqual([a.id]);
      expect(fake.deletedIds).not.toContain(b.id);
    }
  });
});
