import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb, db } from "./client.js";
import {
  findOwnerShareForLesson,
  getSharedByToken,
  insertSharedCompletion,
  listOwnerShares,
  revokeShareByOwner,
  rotateShareTokenByOwner,
  updateShareByOwner,
} from "./sharedCompletions.js";

let dbReachable = false;
const userIds: string[] = [];

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await db()`
    INSERT INTO auth.users (
      id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      ${id}, 'authenticated', 'authenticated', ${`share-${id}@test.local`},
      '{}'::jsonb, '{}'::jsonb, now(), now()
    )
  `;
  userIds.push(id);
  return id;
}

beforeAll(async () => {
  try {
    await db()`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (dbReachable && userIds.length > 0) {
    await db()`DELETE FROM auth.users WHERE id = ANY(${userIds}::uuid[])`;
  }
  await closeDb();
});

function shareInput(userId: string) {
  return {
    userId,
    courseId: "share-lifecycle-proof",
    lessonId: "lesson-1",
    lessonTitle: "Share Lifecycle Proof",
    lessonOrder: 1,
    courseTitle: "Share Lifecycle Proof",
    courseTotalLessons: 1,
    mastery: "strong" as const,
    timeSpentMs: 1_000,
    attemptCount: 1,
    codeSnippet: "print('first')",
    displayName: null,
  };
}

describe("managed share lifecycle — real Postgres", () => {
  it(
    "converges concurrent publishing and preserves owner-only lifecycle controls",
    async () => {
      if (!dbReachable) return;
      const owner = await makeUser();
      const stranger = await makeUser();

      const [first, duplicate] = await Promise.all([
        insertSharedCompletion(shareInput(owner)),
        insertSharedCompletion(shareInput(owner)),
      ]);
      expect(duplicate.shareToken).toBe(first.shareToken);
      expect(await listOwnerShares(owner)).toHaveLength(1);
      expect(
        await findOwnerShareForLesson(
          owner,
          first.courseId,
          first.lessonId,
        ),
      ).toMatchObject({ shareToken: first.shareToken });

      await expect(
        updateShareByOwner(stranger, first.shareToken, {
          displayName: "Not the owner",
          codeSnippet: "print('forged')",
          mastery: "shaky",
          timeSpentMs: 9,
          attemptCount: 9,
        }),
      ).resolves.toBeNull();

      const updated = await updateShareByOwner(owner, first.shareToken, {
        displayName: "Learner",
        codeSnippet: "print('updated')",
        mastery: "okay",
        timeSpentMs: 2_000,
        attemptCount: 2,
      });
      expect(updated).toMatchObject({
        shareToken: first.shareToken,
        displayName: "Learner",
        codeSnippet: "print('updated')",
        revision: 1,
      });

      const rotated = await rotateShareTokenByOwner(owner, first.shareToken);
      expect(rotated).not.toBeNull();
      expect(rotated!.shareToken).not.toBe(first.shareToken);
      expect(await getSharedByToken(first.shareToken)).toBeNull();
      expect(await getSharedByToken(rotated!.shareToken)).toMatchObject({
        revision: 2,
        displayName: "Learner",
      });

      expect(await revokeShareByOwner(stranger, rotated!.shareToken)).toBe(false);
      expect(await revokeShareByOwner(owner, rotated!.shareToken)).toBe(true);
      expect(await getSharedByToken(rotated!.shareToken)).toBeNull();
      expect(await listOwnerShares(owner)).toEqual([]);
    },
    30_000,
  );
});
