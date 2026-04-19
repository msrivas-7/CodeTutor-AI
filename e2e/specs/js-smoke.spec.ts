// JavaScript smoke-test specs. The `_internal-js-smoke` course was added in
// Phase 10E to prove the platform's multi-language plumbing (schema → loader
// → runner → validator) works for a non-Python language. These specs are the
// customer-POV surface: a learner who typed the URL ends up on a functional
// lesson, the JS runner executes via the polyglot runner, and validation
// passes with console.log output matching the expected_stdout rule.

import { expect, test } from "@playwright/test";

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

const COURSE_ID = "_internal-js-smoke";
const LESSON_ID = "hello-print";

test.describe("javascript smoke course", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("internal course is filtered out of the dashboard course grid", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/learn");

    // The dashboard uses listPublicCourses() so the JS smoke title must NOT
    // appear in the course catalog. Python fundamentals is the only visible
    // course today.
    await expect(page.getByText(/Internal — JavaScript smoke test/i)).toHaveCount(0);
  });

  test("direct-URL lesson load renders JS starter in Monaco", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // Starter text is a placeholder with a TODO — verify it hydrated.
    const starter = await getMonacoValue(page);
    expect(starter).toContain("console.log");
    expect(starter).toContain("TODO");

    // Lesson heading uses the JS lesson title — two h1 elements render (the
    // header chip "Lesson 1: …" and the instructions "Hello, JavaScript"),
    // so match the exact instructions one.
    await expect(
      page.getByRole("heading", { level: 1, name: /^hello, javascript$/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Run executes the JS runner and produces stdout", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Starter prints "TODO" — Run the starter as-is and verify the polyglot
    // runner executes JS and the output surfaces in OutputPanel.
    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/TODO/, { timeout: 30_000 });
  });

  test("golden JS solution passes expected_stdout + triggers completion", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(
      page,
      readLessonSolution(COURSE_ID, LESSON_ID, { language: "javascript" }),
    );
    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Hello, JavaScript!/, {
      timeout: 30_000,
    });
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  });
});
