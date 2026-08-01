// Phase 22F2A — B4: multi-file Python lesson smoke.
//
// The `internal-python-smoke` course was added in 22F2A to prove that the
// multi-file lesson chain (scaffolder → starterFilePaths metadata → frontend
// loader → backend writeFiles → runner Python imports) works end-to-end.
// Without this coverage, 22F2's `modules-and-imports` lesson would be
// authored against an unverified path; if the runner mishandled the
// helper file, learners would only discover it once it shipped.
//
// Mirrors the shape of `js-smoke.spec.ts` for the JavaScript multi-language
// smoke course — both prove a non-default language path executes cleanly.

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import {
  getMonacoValue,
  setMonacoValue,
  waitForMonacoReady,
} from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import * as S from "../utils/selectors";
import { expectLessonComplete } from "../utils/assertions";

const COURSE_ID = "internal-python-smoke";
const LESSON_ID = "multi-file-test";

test.describe("python multi-file smoke course (Phase 22F2A — B4)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("internal course is filtered out of the dashboard course grid", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto("/start");

    // listPublicCourses() filter must hide internal: true courses from the
    // learner-facing dashboard (same contract the JS smoke course relies on).
    await expect(
      page.getByText(/Internal — Python smoke test/i),
    ).toHaveCount(0);
  });

  test("direct-URL load hydrates main.py from metadata-declared multi-file starter", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // The starter main.py imports from helper.py — proves the loader
    // followed starterFilePaths and pulled both files. Monaco shows the active
    // entry (main.py) so we assert against its content.
    const starter = await getMonacoValue(page);
    expect(starter).toContain("from helper import greet");
    expect(starter).toContain('print(greet("world"))');
  });

  test("lesson-mode tab strip hides the close (X) affordance on every tab", async ({
    page,
  }) => {
    // Phase 22F2 prep: starter files are part of the curated lesson
    // experience. Closing main.py from the tab strip and then hitting
    // Run would break the lesson — exactly the friction we want to
    // remove for beginners. EditorTabs's `mode="lesson"` prop suppresses
    // the X button + the middle-click handler. Recovery via the new
    // top-level "Reset code" button is the parachute.
    //
    // E2E rather than a frontend unit test because the project has no
    // jsdom/testing-library setup; rendered DOM inside Playwright's
    // chromium is the cheapest place to assert the affordance is gone.
    //
    // Phase 22F2 prep: lesson mode now auto-opens EVERY starter file
    // as a tab (previously only the entry point opened). For
    // modules-and-imports style lessons, the learner needs to see
    // helper.py exists and click into it — without the tab, helper.py
    // is invisible.
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // Both metadata-declared starter tabs should be visible.
    await expect(page.locator('[aria-label="main.py"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[aria-label="helper.py"]')).toBeVisible();

    // No "Close ..." buttons should exist anywhere on the page in lesson
    // mode — covers every tab regardless of how many are open.
    await expect(
      page.getByRole("button", { name: /^close .+\.py$/i }),
    ).toHaveCount(0);
  });

  test("Reset code button restores the starter after edits (multi-file)", async ({
    page,
  }) => {
    // Phase 22F2 prep: the new top-level Reset button (next to Run) is
    // the recovery path now that the tab X is gone. Verify it actually
    // restores both files for a multi-file lesson.
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    const starter = await getMonacoValue(page);
    // Mangle main.py — pretend the learner accidentally broke it.
    await setMonacoValue(page, "# garbage\n");
    expect(await getMonacoValue(page)).not.toBe(starter);

    await S.resetCodeButton(page).click();
    const confirm = page.getByRole("alertdialog", { name: /reset this code/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: /^reset code$/i }).click();

    await expect
      .poll(async () => await getMonacoValue(page), { timeout: 5_000 })
      .toBe(starter);
  });

  test("Run executes the multi-file lesson and produces 'Hello, world!' stdout", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // The starter is the golden solution for this smoke (single-step,
    // single completionRule). Run as-is and verify both files reached
    // the runner — if helper.py didn't, the import would fail with
    // ModuleNotFoundError instead of producing the expected greeting.
    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Hello, world!/, {
      timeout: 30_000,
    });
  });

  test("expected_stdout completion rule passes against the multi-file starter", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Solution matches starter for this smoke; setting it explicitly to
    // exercise the round-trip Monaco → backend → runner → validator path.
    await setMonacoValue(page, 'from helper import greet\n\nprint(greet("world"))\n');
    await S.lessonRunButton(page).click();
    // Wait for run output before Check My Work — same pattern as
    // js-smoke.spec.ts:80 (Run produces stdout; Check My Work triggers
    // the validator + LessonCompletePanel).
    await expect(S.outputPanel(page)).toContainText(/Hello, world!/, {
      timeout: 30_000,
    });
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  });
});
