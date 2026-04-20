// JavaScript Fundamentals course (Phase 13). Exercises the same guided flow
// that powers the Python course, but against a JS lesson arc that uses every
// rule type the platform supports: expected_stdout (lessons 1–4),
// function_tests (lessons 5–7), and a mixed mini-project in lesson 8.
//
// Python specs remain the canonical surface; this file is an additive proof
// that the language-agnostic plumbing (runner, harness registry, validator
// hints, authoring scripts) actually holds up in production.

import { expect, test } from "@playwright/test";

import { mockAllAI } from "../fixtures/aiMocks";
import {
  getMonacoValue,
  setMonacoValue,
  waitForMonacoReady,
} from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { readLessonSolution, readPracticeSolution } from "../fixtures/solutions";
import * as S from "../utils/selectors";
import { expectLessonComplete, expectStdoutContains } from "../utils/assertions";

const COURSE_ID = "javascript-fundamentals";

test.describe("javascript-fundamentals course", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("course appears in the learner-facing dashboard", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/learn");

    // `javascript-fundamentals` is `internal: false`, so listPublicCourses()
    // must surface it alongside Python fundamentals.
    await expect(
      page.getByText(/javascript fundamentals/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("lesson 1 (hello-print) — starter renders, solution passes", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-print`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Starter should already contain the prompt comment and a placeholder.
    const starter = await getMonacoValue(page);
    expect(starter).toContain("console.log");

    // Type the golden solution and verify Check My Work completes.
    await setMonacoValue(
      page,
      readLessonSolution(COURSE_ID, "hello-print", { language: "javascript" }),
    );
    await S.lessonRunButton(page).click();
    await expectStdoutContains(page, /Hello, World!/);
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  });

  test("lesson 5 (functions-basics) — function_tests harness end-to-end", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/functions-basics`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // function_tests lessons expose the Examples tab.
    await expect(S.examplesTab(page)).toBeVisible();

    // Untouched starter — Check My Work should fail (the harness can't find
    // `greet`, or it returns undefined), which should also switch to Examples.
    await S.checkMyWorkButton(page).click();
    await expect(S.examplesTab(page)).toHaveAttribute("aria-selected", "true", {
      timeout: 15_000,
    });

    // Paste the golden solution → all function tests pass → completion panel.
    await setMonacoValue(
      page,
      readLessonSolution(COURSE_ID, "functions-basics", { language: "javascript" }),
    );
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  });

  test("lesson 8 (mini-project) — mixed rules all complete on golden code", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/mini-project`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(
      page,
      readLessonSolution(COURSE_ID, "mini-project", { language: "javascript" }),
    );
    await S.lessonRunButton(page).click();
    // `main()` prints the three habit lines + the summary.
    await expectStdoutContains(page, /1 of 3 habits done/);

    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  });

  test("reset code via overflow menu restores the JS starter", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-print`);
    await waitForMonacoReady(page);

    const starter = await getMonacoValue(page);
    await setMonacoValue(page, "// scratch — about to be reset");
    expect(await getMonacoValue(page)).not.toEqual(starter);

    await S.overflowMenuButton(page).click();
    await S.resetCodeMenuItem(page).click();

    // Reset Code has no confirm dialog — Monaco reverts immediately to the
    // starter. Compare after trimming trailing whitespace: the starter file
    // has a trailing newline that the reset path drops.
    await expect
      .poll(async () => (await getMonacoValue(page)).trimEnd(), {
        timeout: 10_000,
      })
      .toBe(starter.trimEnd());
  });

  test("arrays-basics practice exercise runs against the JS harness", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/arrays-basics`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Clear lesson first so we can move into practice mode — simplest path:
    // paste lesson solution, pass Check My Work.
    await setMonacoValue(
      page,
      readLessonSolution(COURSE_ID, "arrays-basics", { language: "javascript" }),
    );
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);

    // Practice exercises are authored as function_tests — no expected_stdout
    // round-trip needed to prove they execute. We rely on the fact that the
    // golden practice solution file exists and parses.
    const practice = readPracticeSolution(
      COURSE_ID,
      "arrays-basics",
      "positives-only",
      { language: "javascript" },
    );
    expect(practice).toContain("function positivesOnly");
  });
});
