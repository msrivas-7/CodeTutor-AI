// Function-tests + capstone specs. Exercises Phase 8b's surface end-to-end —
// the Examples tab, the per-card pass/miss/error visualisation, auto-switch
// to Examples on Check My Work failure, and the FailedTestCallout. No harness
// mocking: the Docker backend runs pythonHarness for real, so these tests
// assert that the frontend parser and backend harness agree on wire format.

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import {
  getMonacoValue,
  setMonacoValue,
  waitForMonacoReady,
} from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { readLessonSolution } from "../fixtures/solutions";
import * as S from "../utils/selectors";
import { expectLessonComplete } from "../utils/assertions";

const COURSE_ID = "python-fundamentals";
const CAPSTONE = "capstone-word-frequency";

test.describe("function tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("hello-world does NOT render the Examples tab (no function_tests)", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    await expect(page.getByRole("tab", { name: /^examples$/i })).toHaveCount(0);
  });

  test("capstone renders Examples tab; tab shows all 5 visible tests (hidden excluded)", async ({ page }) => {
    await loadProfile(page, "capstone-first-fail");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${CAPSTONE}`);
    await waitForMonacoReady(page);

    await expect(page.getByRole("tab", { name: /^examples$/i })).toBeVisible();
    await page.getByRole("tab", { name: /^examples$/i }).click();

    const section = page.locator('section[aria-labelledby="examples-heading"]');
    await expect(section).toBeVisible();

    // Exactly 5 visible test cards (the lesson has 5 visible + 3 hidden).
    const cards = section.locator('[role="group"][aria-label^="Example "]');
    await expect(cards).toHaveCount(5);

    // Pre-run summary reads "5 examples — try one" — not a 0/5 scoreboard.
    await expect(section.getByText(/5 examples? — try one/i)).toBeVisible();
  });

  test("Run examples turns visible cards green for a correct solution", async ({ page }) => {
    await loadProfile(page, "capstone-first-fail");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${CAPSTONE}`);
    await waitForMonacoReady(page);
    // 60s (not the default 30s) because these two specs are often the first
    // per-worker to need an active session, and on a cold CI Docker daemon
    // the first createContainer can take >30s. Retries pass because the
    // daemon is warm by then; this bump absorbs the cold-start outlier
    // without hiding real latency regressions (60s is still well under the
    // 90s spec-level timeout).
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 60_000 });

    // Plug in the golden solution so every visible test passes.
    await setMonacoValue(page, readLessonSolution(COURSE_ID, CAPSTONE));
    await page.getByRole("tab", { name: /^examples$/i }).click();

    const section = page.locator('section[aria-labelledby="examples-heading"]');
    await section.getByRole("button", { name: /run (all visible )?examples/i }).click();

    // All 5 visible pass. The summary pill flips to "All 5 pass".
    await expect(section.getByText(/All 5 pass/i)).toBeVisible({ timeout: 30_000 });
    const passedCards = section.locator('[role="group"][aria-label$="Passed"]');
    await expect(passedCards).toHaveCount(5);
  });

  test("Run examples shows miss state on count_words rows for the buggy profile", async ({ page }) => {
    // capstone-first-fail's saved code returns a list of tuples from
    // count_words — visible count_words cases miss.
    await loadProfile(page, "capstone-first-fail");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${CAPSTONE}`);
    await waitForMonacoReady(page);
    // See :60 — same cold-start budget applies.
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 60_000 });

    await page.getByRole("tab", { name: /^examples$/i }).click();
    const section = page.locator('section[aria-labelledby="examples-heading"]');
    await section.getByRole("button", { name: /run (all visible )?examples/i }).click();

    // Summary pill reads "<passed> of 5 pass" when some pass and some fail.
    await expect(section.getByText(/\d+ of 5 pass/i)).toBeVisible({ timeout: 30_000 });
    // At least one card flipped to "Got something else" (soft failure vocab).
    const missCards = section.locator('[role="group"][aria-label$="Got something else"]');
    await expect(missCards.first()).toBeVisible();
  });

  test("Check My Work failure auto-switches to Examples + shows FailedTestCallout", async ({ page }) => {
    await loadProfile(page, "capstone-first-fail");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${CAPSTONE}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Run first so expected_stdout validation has a fresh result, then Check.
    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Total words/, { timeout: 20_000 });
    await S.checkMyWorkButton(page).click();

    // Examples tab should become selected automatically (the auto-switch
    // effect fires when checkFailure is set and the lesson has examples).
    await expect(page.getByRole("tab", { name: /^examples$/i, selected: true })).toBeVisible({
      timeout: 15_000,
    });

    // FailedTestCallout renders with role="status" and either a <code> of the
    // call (visible test) or the "One tricky case" copy (hidden test).
    const callout = page
      .locator('[role="status"]')
      .filter({ hasText: /count_words|Expected:|One tricky case/ })
      .first();
    await expect(callout).toBeVisible({ timeout: 15_000 });
  });

  test("Capstone golden solution → all tests pass → completion panel", async ({ page }) => {
    await loadProfile(page, "capstone-first-fail");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${CAPSTONE}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, readLessonSolution(COURSE_ID, CAPSTONE));
    expect(await getMonacoValue(page)).toContain("def tokenize");

    // The main script reads sys.stdin. Load the canned text via the Stdin tab
    // so the expected_stdout rule ("Top 3:\nthe: 5\nfox: 3\ndog: 2") matches.
    const stdinText = readLessonSolution(COURSE_ID, CAPSTONE, { file: "input.txt" });
    await S.stdinTab(page).click();
    const stdinBox = page.locator("#output-panel-body");
    await stdinBox.click();
    await stdinBox.fill(stdinText);
    await S.outputTab(page).click();

    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Top 3:/, { timeout: 30_000 });
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  });

  test("Ask tutor why button is gated behind 2nd consecutive same-failure", async ({ page }) => {
    // capstone-first-fail seeds broken count_words. First Check My Work:
    // consecutiveFails=1 → preview hint, no Ask tutor button. Second: →2,
    // "Ask tutor why" becomes clickable. The gate exists so learners aren't
    // trained to lean on the tutor after one stumble.
    await loadProfile(page, "capstone-first-fail");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${CAPSTONE}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Run once so expected_stdout has a fresh result.
    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Total words/, { timeout: 20_000 });

    // First fail → preview hint copy, no button.
    await S.checkMyWorkButton(page).click();
    await expect(page.getByRole("tab", { name: /^examples$/i, selected: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/If the next try still struggles, you'll be able to ask the tutor/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^ask tutor why$/i })).toHaveCount(0);

    // Second fail (same failing test) → gate opens.
    await S.checkMyWorkButton(page).click();
    await expect(page.getByRole("button", { name: /^ask tutor why$/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("functions lesson (order 6) — earliest lesson with function_tests", async ({ page }) => {
    // Per Phase 9A's authoring floor, "functions" is the first lesson that
    // can have function_tests. Verify the Examples tab appears there too.
    await loadProfile(page, "mid-course-healthy");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/functions`);
    await waitForMonacoReady(page);

    await expect(page.getByRole("tab", { name: /^examples$/i })).toBeVisible({ timeout: 10_000 });
  });
});
