// Phase 27 §4 — disable-streaks toggle e2e.
//
// Alex persona: career-changer who burned out on streak-pressure in
// prior apps. He WILL toggle off streaks and WILL notice if any
// streak surface keeps leaking through afterward. This spec guards
// the contract:
//
//   1. Toggle defaults OFF (streaks visible — the modal default for
//      Maya, who responds well to streak signal).
//   2. After flipping ON, the toolbar StreakChip on /start AND on
//      the LessonPage disappears.
//   3. After flipping back OFF, the chip reappears with the same
//      streak count (server data preserved across the toggle).
//
// What this spec does NOT cover:
//   - Lesson-complete panel streak section (would require completing
//     a real lesson via the run/check flow — covered by streak.spec
//     for the always-on case; the disable variant is a render-time
//     gate on the same component, so the chip absence on /start
//     plus the LessonPage stands in).
//   - SharePage streak count (the share page doesn't currently
//     render streak count — see plan §4 SharePage note).
//   - digestSweeper SQL excludes opted-out users (backend
//     integration test, separate concern from e2e).

import { expect, test } from "../fixtures/auth";
import { mockAllAI } from "../fixtures/aiMocks";
import {
  loadProfile,
  markOnboardingDone,
  seedLessonProgress,
} from "../fixtures/profiles";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

test.describe("disable-streaks toggle (Phase 27 §4)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
    await loadProfile(page, "empty");
    // Seed a 1-day streak via the same backend route streak.spec
    // uses — PATCHing a lesson to status=completed fires
    // updateUserStreak inline.
    await seedLessonProgress(page, COURSE_ID, "hello-world", {
      status: "completed",
      attemptCount: 1,
    });
  });

  test("Hide-streaks toggle in Settings → Account: defaults off", async ({
    page,
  }) => {
    await page.goto("/start");
    await S.openSettings(page, "account");
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    const toggle = page.getByRole("switch", { name: /toggle hide streaks/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Section heading + body copy lands so Alex knows what it does.
    await expect(page.getByText(/^Streaks$/)).toBeVisible();
    await expect(page.getByText(/Some people learn better without streaks/i)).toBeVisible();
  });

  test("flipping the toggle hides the StreakChip on /start", async ({
    page,
  }) => {
    await page.goto("/start");

    // Pre-toggle: chip is visible (1-day streak from beforeEach seed).
    const chip = page.getByRole("button", { name: /1-day streak/i }).first();
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // Open settings, flip the toggle.
    await S.openSettings(page, "account");
    const toggle = page.getByRole("switch", { name: /toggle hide streaks/i });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 5_000,
    });

    // Close the settings dialog so the chip's container is unobscured.
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Chip is gone — StreakChip returns null when disableStreaks is true.
    await expect(
      page.getByRole("button", { name: /1-day streak/i }),
    ).toHaveCount(0);
  });

  test("flipping back OFF restores the chip with the preserved streak count", async ({
    page,
  }) => {
    await page.goto("/start");
    await S.openSettings(page, "account");
    const toggle = page.getByRole("switch", { name: /toggle hide streaks/i });

    // ON → chip hidden.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", {
      timeout: 5_000,
    });

    // OFF → chip back, same value (server-side streak preserved across
    // the toggle — disable is a display gate, not a data wipe).
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false", {
      timeout: 5_000,
    });

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: /1-day streak/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("disable-streaks also hides the chip on the LessonPage toolbar", async ({
    page,
  }) => {
    // Toggle ON first via settings on the dashboard.
    await page.goto("/start");
    await S.openSettings(page, "account");
    await page
      .getByRole("switch", { name: /toggle hide streaks/i })
      .click();
    await page.keyboard.press("Escape");

    // Navigate to the lesson — chip should still be hidden in this
    // surface since the gate is at the StreakChip render layer
    // (every consumer is gated by useDisableStreaks).
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await expect(
      page.getByRole("button", { name: /back to course/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("button", { name: /1-day streak/i }),
    ).toHaveCount(0);
  });
});
