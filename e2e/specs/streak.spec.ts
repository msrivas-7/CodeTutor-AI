// Phase 21B: streak chip e2e. Verifies the chip:
//   - returns null at Day 0 (no chip rendered for fresh users)
//   - shows "Day 1." after a single lesson completion (via seedLessonProgress
//     which PATCHes the backend route that fires updateUserStreak inline)
//   - appears in both the StartPage (top-right of ResumeLearningCard or
//     fallback row) and the LessonPage header toolbar
//
// We don't drive the full run/check flow — that's covered by practice.spec.ts.
// Instead we hit the PATCH route directly via seedLessonProgress, which is
// what a successful completion would do anyway.

import { expect, test } from "../fixtures/auth";
import { mockAllAI } from "../fixtures/aiMocks";
import {
  loadProfile,
  markOnboardingDone,
  seedLessonProgress,
} from "../fixtures/profiles";

const COURSE_ID = "python-fundamentals";

test.describe("Phase 21B: streak chip", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("Day 0 (fresh user) renders no chip on StartPage", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/start");
    // Chip is a <button> with descriptive aria-label. Day 0 returns
    // null → no matching button.
    await expect(
      page.getByRole("button", { name: /streak|grace/i }),
    ).toHaveCount(0);
  });

  test("first lesson completion → chip is visible on StartPage with '1-day streak' label", async ({ page }) => {
    await loadProfile(page, "empty");
    // PATCH a lesson to status=completed; this hits the backend route
    // that fires updateUserStreak inline.
    await seedLessonProgress(page, COURSE_ID, "hello-world", {
      status: "completed",
      attemptCount: 1,
    });

    await page.goto("/start");
    // Both visible text and aria-label include "1-day streak" so the
    // chip is self-explanatory at a glance, no tooltip required.
    const chip = page.getByRole("button", { name: /1-day streak/i }).first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAccessibleName(/1-day streak/i);
    await expect(page.getByTestId("streak-morph-identity")).toContainText("1-day streak");
  });

  test("chip is visible in the LessonPage header toolbar", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, "hello-world", {
      status: "completed",
      attemptCount: 1,
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    // Wait for the lesson page chrome to mount.
    await expect(
      page.getByRole("button", { name: /back to course/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Chip appears in the page chrome — descriptive aria-label match.
    await expect(
      page.getByRole("button", { name: /1-day streak/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
