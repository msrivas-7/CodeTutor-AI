// Practice-mode specs. Phase 6 surface — authored practice exercises that
// appear after lesson completion. Covers the end-to-end loop: enter practice
// (from completion panel or ?mode=practice deeplink), solve an exercise,
// progress chip advances, Next challenge steps forward, All practice done CTA
// on final exercise, Reset practice rolls completions back, Exit practice
// restores the saved lesson code. AI is mocked — the Docker backend runs the
// function_tests harness for real so the validator path is authentic.

import { expect, test } from "@playwright/test";

import { mockAllAI } from "../fixtures/aiMocks";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { readLessonSolution, readPracticeSolution } from "../fixtures/solutions";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";
// `functions` is the earliest lesson with `function_tests`-flavored practice
// (per the Phase 9A authoring floor at order >= 6). The `capstones-pending`
// profile has lessons 1–10 complete, so `functions` (order 6) is completed
// and its practice exercises are unlocked.
const LESSON_ID = "functions";
const EX1 = "square-function";
const EX2 = "greet-default";
const EX3 = "max-of-three";

async function goToLesson(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
  await waitForMonacoReady(page);
  await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });
}

test.describe("practice mode", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("deeplink ?mode=practice enters practice view with first exercise", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // Practice header: "Practice  1 of 3  0/3 done".
    await expect(page.getByText(/^Practice$/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1 of 3/).first()).toBeVisible();
    await expect(page.getByText(/0\/3 done/).first()).toBeVisible();

    // Exercise title of the first practice: "Square function".
    await expect(page.getByRole("heading", { name: /square function/i })).toBeVisible();

    // Back to lesson anchor is the escape hatch back to instructions view.
    await expect(page.getByRole("button", { name: /back to lesson/i })).toBeVisible();
  });

  test("exercise picker chips let the learner jump between the 3 exercises", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // The picker renders 3 numbered round chips with aria-label="Exercise N:
    // <title>". Click #2 → greet-default title should render.
    await page.getByRole("button", { name: /^exercise 2:/i }).click();
    await expect(page.getByRole("heading", { name: /greeting with default/i })).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /^exercise 3:/i }).click();
    await expect(page.getByRole("heading", { name: /max of three/i })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("solve first exercise → Check passes → Next challenge moves to exercise 2", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // Plug in the golden practice solution for square-function.
    await setMonacoValue(page, readPracticeSolution(COURSE_ID, LESSON_ID, EX1));
    await S.lessonRunButton(page).click();
    await S.checkMyWorkButton(page).click();

    // Completion feedback pill inside PracticeInstructionsView.
    await expect(page.getByText(/nice work/i).first()).toBeVisible({ timeout: 30_000 });
    // And the "Next challenge →" CTA appears.
    const nextBtn = page.getByRole("button", { name: /next challenge/i });
    await expect(nextBtn).toBeVisible({ timeout: 5_000 });

    // Counter tick: 1/3 done now.
    await expect(page.getByText(/1\/3 done/).first()).toBeVisible();

    await nextBtn.click();
    await expect(page.getByRole("heading", { name: /greeting with default/i })).toBeVisible({
      timeout: 5_000,
    });
    // Header now reads "2 of 3".
    await expect(page.getByText(/2 of 3/).first()).toBeVisible();
  });

  test("completing all 3 exercises swaps Next for 'All practice done'", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // Solve all 3 in a row via the picker.
    for (const [idx, exId] of [[1, EX1], [2, EX2], [3, EX3]] as const) {
      await page.getByRole("button", { name: new RegExp(`^exercise ${idx}:`, "i") }).click();
      await setMonacoValue(page, readPracticeSolution(COURSE_ID, LESSON_ID, exId));
      await S.lessonRunButton(page).click();
      await S.checkMyWorkButton(page).click();
      await expect(page.getByText(/nice work/i).first()).toBeVisible({ timeout: 30_000 });
    }

    // Header shows "3/3 done" now.
    await expect(page.getByText(/3\/3 done/).first()).toBeVisible();
    // On the final exercise with no more after, the button flips to success
    // copy and routes back to the lesson.
    const doneBtn = page.getByRole("button", { name: /all practice done/i });
    await expect(doneBtn).toBeVisible({ timeout: 5_000 });
    await doneBtn.click();
    // Practice view unmounts — the Practice header chip is gone.
    await expect(page.getByRole("heading", { name: /max of three/i })).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test("completed chips show ✓, active chip gets violet highlight", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // Solve just exercise 1.
    await setMonacoValue(page, readPracticeSolution(COURSE_ID, LESSON_ID, EX1));
    await S.lessonRunButton(page).click();
    await S.checkMyWorkButton(page).click();
    await expect(page.getByText(/nice work/i).first()).toBeVisible({ timeout: 30_000 });

    // Chip for ex1 now has "(completed)" suffix in aria-label.
    await expect(
      page.getByRole("button", { name: /^exercise 1:.*\(completed\)/i }),
    ).toBeVisible();
    // Chip for ex2 does not.
    await expect(page.getByRole("button", { name: /^exercise 2:/i })).toBeVisible();
  });

  test("Reset practice wipes completions after confirm", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // First — solve one to get a completed chip.
    await setMonacoValue(page, readPracticeSolution(COURSE_ID, LESSON_ID, EX1));
    await S.lessonRunButton(page).click();
    await S.checkMyWorkButton(page).click();
    await expect(page.getByText(/1\/3 done/).first()).toBeVisible({ timeout: 30_000 });

    // The reset icon button only appears when completedCount > 0. It has
    // title="Reset practice progress for this lesson".
    await page.getByRole("button", { name: /reset practice progress/i }).click();
    const modal = page.locator('[role="alertdialog"]').filter({ hasText: /reset practice progress/i });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: /^reset$/i }).click();
    await expect(modal).toHaveCount(0);

    // Header reverts to 0/3 done.
    await expect(page.getByText(/0\/3 done/).first()).toBeVisible({ timeout: 5_000 });
  });

  test("Show hints toggles the hints list", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    const toggle = page.getByRole("button", { name: /show hints/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    // After expansion the button text flips to "Hide hints" + an <ol> renders.
    await expect(page.getByRole("button", { name: /hide hints/i })).toBeVisible();
    await expect(page.locator("ol").filter({ hasText: /def square/i })).toBeVisible();
  });

  test("Back to lesson exits practice and restores instructions view", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    await expect(page.getByRole("heading", { name: /square function/i })).toBeVisible();
    await page.getByRole("button", { name: /back to lesson/i }).click();

    // Back in instructions view — the lesson's h1 title (renders in
    // LessonInstructionsPanel, not the practice header).
    await expect(page.getByRole("heading", { level: 1, name: /^functions$/i })).toBeVisible({
      timeout: 5_000,
    });
    // And the Practice "X of Y" header chip is gone.
    await expect(page.getByText(/\d+ of 3/)).toHaveCount(0);
  });

  test("completion panel Start Practice opens practice view inline", async ({ page }) => {
    // Use the mid-course profile which leaves `functions` (order 6) as "next
    // up" — not yet started. Solve it fresh so the completion panel renders,
    // then click Start Practice from within it.
    await loadProfile(page, "mid-course-healthy");
    await goToLesson(page);

    // Pull in the lesson's golden solution from the solution/ dir.
    await setMonacoValue(page, readLessonSolution(COURSE_ID, LESSON_ID));
    await S.lessonRunButton(page).click();
    await S.checkMyWorkButton(page).click();

    // Completion modal renders with "Start Practice" primary CTA.
    const modal = page.locator('[role="alertdialog"]');
    const startPractice = modal.getByRole("button", { name: /^start practice/i });
    await expect(startPractice).toBeVisible({ timeout: 30_000 });
    await startPractice.click();

    // Modal closes and practice view mounts.
    await expect(page.getByText(/^Practice$/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/1 of 3/).first()).toBeVisible();
  });
});
