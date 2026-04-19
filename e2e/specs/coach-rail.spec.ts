// CoachRail nudge specs. The rail renders inline above the instructions on
// the lesson page and surfaces one priority-ordered tip at a time: "run your
// code", "this one's tricky — try hints", "you completed it — keep going",
// etc. These tests drive the real learner inputs (edit, run, check) and
// assert that the expected nudge shows up. Avoids time-based rules (idle>30,
// elapsed>60) because those would either block the suite or require Date.now
// mocking.

import { expect, test } from "@playwright/test";

import { mockAllAI } from "../fixtures/aiMocks";
import { waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

test.describe("coach rail nudges", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("ran-ok-check: after Run with no error, prompts learner to Check My Work", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Run the default starter — it prints a placeholder and does NOT throw.
    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).not.toBeEmpty({ timeout: 30_000 });

    // The coach nudge about clicking Check My Work should appear within a
    // tick (CoachRail polls every 5s but hasRun flips the dep immediately).
    await expect(
      page.getByText(/Your code ran! Click Check My Work/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("many-fails: after 3 failed Check My Work clicks, the 'tricky' nudge appears", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Starter is a placeholder comment — Check My Work will fail every time.
    for (let i = 0; i < 3; i++) {
      await S.checkMyWorkButton(page).click();
      // Wait for the failure to register before the next click — otherwise
      // multiple clicks race and failedCheckCount doesn't tick reliably.
      await expect(S.checkMyWorkButton(page)).toBeEnabled({ timeout: 10_000 });
    }

    await expect(page.getByText(/This one's tricky/i)).toBeVisible({ timeout: 15_000 });
  });

  test("completed-idle: visiting an already-completed lesson shows the 'Nice work' nudge", async ({
    page,
  }) => {
    // mid-course-healthy has lessons 1–5 complete. Navigate straight to a
    // completed lesson — CoachRail sees lessonComplete=true immediately.
    await loadProfile(page, "mid-course-healthy");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    await expect(
      page.getByText(/Nice work! You can practice more/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("dismiss × button hides the current nudge", async ({ page }) => {
    await loadProfile(page, "mid-course-healthy");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    const nudge = page.getByText(/Nice work! You can practice more/i).first();
    await expect(nudge).toBeVisible({ timeout: 15_000 });
    // Dismiss control lives on the same rail.
    await page.getByRole("button", { name: /dismiss coach tip/i }).click();
    // The text should be gone from the CoachRail region specifically (it may
    // still appear elsewhere in completion panels etc, but at the rail's
    // position it's empty now).
    await expect(nudge).toHaveCount(0, { timeout: 5_000 });
  });

  test("stuck-on-lesson profile lands ready to receive many-fails after a few checks", async ({
    page,
  }) => {
    // The canonical "stuck" profile — pre-seeds attemptCount=5. Surfacing
    // the nudge still requires actual check clicks (the in-component counter
    // is React state, not persisted) but it's a realistic flow.
    await loadProfile(page, "stuck-on-lesson");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/conditionals`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    for (let i = 0; i < 3; i++) {
      await S.checkMyWorkButton(page).click();
      await expect(S.checkMyWorkButton(page)).toBeEnabled({ timeout: 10_000 });
    }

    await expect(page.getByText(/This one's tricky/i)).toBeVisible({ timeout: 15_000 });
  });
});
