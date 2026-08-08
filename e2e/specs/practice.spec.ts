// Practice-mode specs. Phase 6 surface — authored practice exercises that
// appear after lesson completion. Covers the end-to-end loop: enter practice
// (from completion panel or ?mode=practice deeplink), solve an exercise,
// progress chip advances, Next challenge steps forward, All practice done CTA
// on final exercise, Reset practice rolls completions back, Exit practice
// restores the saved lesson code. AI is mocked — the Docker backend runs the
// function_tests harness for real so the validator path is authentic.

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { focusMonaco, getMonacoValue, setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone, seedApiKey } from "../fixtures/profiles";
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
    expect(await getMonacoValue(page)).toContain("def greet");
    await page.getByRole("button", { name: /^exercise 3:/i }).click();
    await expect(page.getByRole("heading", { name: /max of three/i })).toBeVisible({
      timeout: 5_000,
    });
    expect(await getMonacoValue(page)).toContain("def max_of_three");
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

    // Leaving and re-entering resumes at the first incomplete exercise,
    // rather than sending the learner back through a challenge they finished.
    await page.getByRole("button", { name: /exit practice mode/i }).click();
    await page.getByRole("button", { name: /practice 1 of 3/i }).click();
    await expect(page.getByRole("heading", { name: /greeting with default/i })).toBeVisible();
    expect(await getMonacoValue(page)).toContain("def greet");
  });

  test("rate-limited completion keeps the solution and gates retry to Retry-After", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    let blockedOnce = false;
    await page.route(
      `**/api/user/lessons/${COURSE_ID}/${LESSON_ID}`,
      async (route) => {
        const request = route.request();
        const body = request.method() === "PATCH"
          ? (request.postDataJSON() as Record<string, unknown>)
          : {};
        if (!blockedOnce && body.practiceEvidence) {
          blockedOnce = true;
          await route.fulfill({
            status: 429,
            contentType: "application/json",
            headers: { "Retry-After": "2" },
            body: JSON.stringify({ error: "Too many requests" }),
          });
          return;
        }
        await route.fallback();
      },
    );
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    const solution = readPracticeSolution(COURSE_ID, LESSON_ID, EX1);
    await setMonacoValue(page, solution);
    await S.lessonRunButton(page).click();
    await S.checkMyWorkButton(page).click();

    await expect(page.getByRole("alert").filter({ hasText: /practice result not saved/i })).toBeVisible({
      timeout: 30_000,
    });
    const countdown = page.getByRole("button", { name: /retry in \d+s/i });
    await expect(countdown).toBeVisible();
    await expect(countdown).toBeDisabled();
    expect(await getMonacoValue(page)).toBe(solution);
    await expect(page.getByText(/0\/3 done/).first()).toBeVisible();

    const retry = page.getByRole("button", { name: /^retry saving$/i });
    await expect(retry).toBeEnabled({ timeout: 5_000 });
    await retry.click();
    await expect(page.getByText(/nice work/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1\/3 done/).first()).toBeVisible();
  });

  test("authenticated phone practice keeps every workspace surface inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    await page.getByRole("button", { name: /exit practice mode/i }).click();
    const practiceEntry = page.getByRole("button", { name: /practice 0 of 3/i });
    await expect(practiceEntry).toBeVisible();
    await practiceEntry.click();
    await expect(page.getByRole("heading", { name: /square function/i })).toBeVisible();

    const editor = page.getByRole("textbox", { name: /code editor for/i }).first();
    const run = S.lessonRunButton(page);
    const check = S.checkMyWorkButton(page);
    for (const control of [editor, run, check]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box, "workspace control should have a rendered box").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      codeBlocks: Array.from(
        document.querySelectorAll<HTMLElement>('section[aria-labelledby^="practice-tests-"] code'),
      ).map((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
      practiceButtons: Array.from(
        document.querySelectorAll<HTMLElement>('section[aria-label="Lesson instructions"] button'),
      ).map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
    }));
    expect(layout.documentWidth).toBe(layout.viewportWidth);
    expect(layout.codeBlocks.length).toBeGreaterThan(0);
    expect(layout.codeBlocks.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth)).toBe(true);
    expect(layout.practiceButtons.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
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

  test("completed practice code resets to the authored starter before the editor unlocks", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    const authoredStarter = await getMonacoValue(page);
    const solved = readPracticeSolution(COURSE_ID, LESSON_ID, EX1);
    await setMonacoValue(page, solved);
    await S.lessonRunButton(page).click();
    await S.checkMyWorkButton(page).click();
    await expect(page.getByText(/nice work/i).first()).toBeVisible({ timeout: 30_000 });
    // Let the ordinary debounced practice draft persist so Reset is forced to
    // choose between a real saved solution and the immutable authored starter.
    await page.waitForTimeout(2_300);

    const resetAndWaitForCommit = async () => {
      await S.resetCodeButton(page).click();
      const confirm = page.getByRole("alertdialog", { name: /reset this code/i });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: /^reset code$/i }).click();
      await expect(
        page.getByRole("status").filter({ hasText: /code reset\. output, checks, and tutor context/i }),
      ).toBeVisible({ timeout: 5_000 });
      expect(await getMonacoValue(page)).toBe(authoredStarter);
    };

    await resetAndWaitForCommit();
    await page.getByRole("button", { name: /undo reset/i }).click();
    await expect.poll(() => getMonacoValue(page)).toBe(solved);

    await resetAndWaitForCommit();
    await focusMonaco(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await page.keyboard.type("\n# RESET_SENTINEL_AFTER_COMMIT");
    await page.waitForTimeout(2_300);
    expect(await getMonacoValue(page)).toContain("RESET_SENTINEL_AFTER_COMMIT");
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
    const lessonHeading = page.getByRole("heading", { level: 1, name: /^functions$/i });
    await expect(lessonHeading).toBeVisible({
      timeout: 5_000,
    });
    await expect(lessonHeading).toBeFocused();
    await expect(page).not.toHaveURL(/mode=practice/);
    // And the Practice "X of Y" header chip is gone.
    await expect(page.getByText(/\d+ of 3/)).toHaveCount(0);
  });

  test("collapsed practice exit focuses the visible instructions restore control", async ({
    page,
  }) => {
    await loadProfile(page, "capstones-pending");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    await page.getByRole("button", { name: "Collapse practice instructions" }).click();
    const restoreInstructions = page.getByRole("button", {
      name: "Show instructions panel",
    });
    await expect(restoreInstructions).toBeVisible();

    await page
      .getByRole("button", { name: "Exit practice mode and return to lesson" })
      .click();
    await expect(page.getByText("Practice Mode", { exact: true })).toHaveCount(0);
    await expect(restoreInstructions).toBeFocused();
  });

  test("AI tutor sends the active exercise identity for server-resolved context", async ({ page }) => {
    // Regression guard: practice mode must identify the active exercise so
    // the backend can resolve the exercise-specific teaching context. The
    // browser must not send author-controlled titles, objectives, or rules;
    // those are now loaded from the server-authoritative lesson catalog.
    // Order matters: loadProfile calls resetServerState which DELETEs
    // the BYOK key, so seed AFTER loading the profile (otherwise the
    // composer renders disabled "Configure API key first").
    await loadProfile(page, "capstones-pending");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });

    // Capture the POST body sent to /api/ai/ask/stream. mockAllAI
    // (in beforeEach) already installed a fulfill handler; our
    // handler runs first (LIFO) and falls through to it via fallback().
    let captured: Record<string, unknown> | null = null;
    await page.route("**/api/ai/ask/stream", async (route) => {
      if (route.request().method() === "POST") {
        try {
          captured = JSON.parse(route.request().postData() ?? "{}");
        } catch {
          /* skip — let the fallback handle it */
        }
      }
      await route.fallback();
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}?mode=practice`);
    await waitForMonacoReady(page);

    // Confirm the practice view rendered for exercise 1 (Square function).
    await expect(page.getByRole("heading", { name: /square function/i })).toBeVisible();

    // Ask any question. Composer should already be enabled (key was
    // seeded) — no need to drive the TutorSetupWarning Connect path.
    await expect(S.tutorInput(page)).toBeEnabled({ timeout: 10_000 });
    await S.tutorInput(page).fill("How do I get started?");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // Wait for the request to land.
    await expect.poll(() => captured, { timeout: 10_000 }).not.toBeNull();
    const body = captured as unknown as Record<string, unknown>;
    const ctx = body.lessonContext as Record<string, unknown>;
    expect(ctx).toBeTruthy();

    expect(ctx).toEqual({
      courseId: COURSE_ID,
      lessonId: LESSON_ID,
      exerciseId: EX1,
    });
  });

  test("AI tutor sends lesson identity without exercise framing outside practice mode", async ({ page }) => {
    // Complement to the prior spec: the same lesson outside practice mode
    // must explicitly identify no exercise. The backend then resolves the
    // ordinary lesson context instead of an exercise-specific snapshot.
    // Same order constraint as the prior test (see comment above).
    await loadProfile(page, "capstones-pending");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });

    let captured: Record<string, unknown> | null = null;
    await page.route("**/api/ai/ask/stream", async (route) => {
      if (route.request().method() === "POST") {
        try {
          captured = JSON.parse(route.request().postData() ?? "{}");
        } catch {
          /* skip */
        }
      }
      await route.fallback();
    });

    await goToLesson(page);

    await expect(S.tutorInput(page)).toBeEnabled({ timeout: 10_000 });
    await S.tutorInput(page).fill("What's a function?");
    await page.getByRole("button", { name: /^ask$/i }).click();

    await expect.poll(() => captured, { timeout: 10_000 }).not.toBeNull();
    const body = captured as unknown as Record<string, unknown>;
    const ctx = body.lessonContext as Record<string, unknown>;
    expect(ctx).toBeTruthy();

    expect(ctx).toEqual({
      courseId: COURSE_ID,
      lessonId: LESSON_ID,
      exerciseId: null,
    });
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
    const modal = page.getByRole("dialog", { name: /lesson complete/i });
    const startPractice = modal.getByRole("button", { name: /^start practice/i });
    await expect(startPractice).toBeVisible({ timeout: 30_000 });
    await startPractice.click();

    // Modal closes and practice view mounts.
    await expect(page.getByText(/^Practice$/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/1 of 3/).first()).toBeVisible();
  });
});
