import { expect, test } from "@playwright/test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  buildCurrentRunTestEmail,
  deleteCurrentRunTestUser,
  isCurrentRunTestEmail,
  requireCurrentRunSuffix,
  teardownCurrentRunTestUsers,
} from "../fixtures/testIdentity";

type FakeAdmin = {
  client: SupabaseClient;
  deletedIds: string[];
};

function fakeUser(id: string, email: string): User {
  return { id, email } as User;
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
    const suffix = "shard-4-run999-attempt2";
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
  });

  test("600 varied overlapping namespaces record zero cross-run deletions", async () => {
    for (let iteration = 0; iteration < 600; iteration += 1) {
      const runA = `shard-${(iteration % 4) + 1}-run${1000 + iteration}-attempt1`;
      const runB = `shard-${((iteration + 1) % 4) + 1}-run${2000 + iteration}-attempt2`;
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
