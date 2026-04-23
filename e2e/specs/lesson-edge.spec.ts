// Lesson edge-case specs: stdin-driven lesson, locked lessons on the course
// overview, and the resume toast (saved code restoration). Each test exercises
// a narrow surface that's easy to regress during UI refactors.

import { expect, test } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import {
  loadProfile,
  markOnboardingDone,
  seedCompletedLessons,
  seedLessonProgress,
} from "../fixtures/profiles";
import { readLessonSolution } from "../fixtures/solutions";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

test.describe("lesson edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
  });

  test("input-output lesson: stdin tab text feeds input() at runtime", async ({ page }) => {
    await loadProfile(page, "empty");
    // useLessonLoader now bounces direct URLs that skip prereqs; input-output
    // depends on `variables`. Seed the direct prereq so the guard lets us in.
    await seedCompletedLessons(page, COURSE_ID, ["variables"]);
    await page.goto(`/learn/course/${COURSE_ID}/lesson/input-output`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Use the golden solution — it reads name + birth_year from stdin and
    // prints "Hi <name>! You are about <age> years old.".
    await setMonacoValue(page, readLessonSolution(COURSE_ID, "input-output"));

    // Load canned stdin via the Stdin tab. The OutputPanel tab bar reuses the
    // shared #output-panel-body textarea for stdin authoring.
    await S.stdinTab(page).click();
    const stdinBox = page.locator("#output-panel-body");
    await stdinBox.click();
    await stdinBox.fill("Alice\n2000\n");
    await S.outputTab(page).click();

    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Hi Alice/i, { timeout: 30_000 });
    await expect(S.outputPanel(page)).toContainText(/25 years old/i);
  });

  test("locked lesson: prerequisite-blocked lesson renders disabled in LessonList", async ({
    page,
  }) => {
    // Empty profile — nothing completed → lesson 2 (variables) should be
    // locked because its prereq (hello-world) isn't done.
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}`);

    // The lesson card itself is a <button disabled>. Its aria-label includes
    // "(locked — complete prerequisites first)".
    const lockedVariables = page.getByRole("button", {
      name: /variables.*locked.*complete prerequisites first/i,
    });
    await expect(lockedVariables).toBeVisible({ timeout: 10_000 });
    await expect(lockedVariables).toBeDisabled();
  });

  test("locked lesson: direct URL to a prereq-blocked lesson bounces to course page", async ({
    page,
  }) => {
    // The LessonList gate only covers click paths; a learner who pastes or
    // bookmarks a lesson URL would otherwise unlock it. useLessonLoader has
    // a matching prereq check that redirects to the course page when
    // prereqs are unmet AND the lesson has no prior progress.
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/variables`);

    // URL must land on the course overview, not stay on the lesson.
    await expect(page).toHaveURL(new RegExp(`/learn/course/${COURSE_ID}$`), {
      timeout: 10_000,
    });
    // And the locked lesson button should be visible + disabled — same
    // state as if the learner had opened the course page directly.
    await expect(
      page.getByRole("button", {
        name: /variables.*locked.*complete prerequisites first/i,
      }),
    ).toBeDisabled();
  });

  test("prereq bounce does NOT create an in_progress lesson row", async ({ page }) => {
    // Audit gap #8 (hazy-wishing-wren bucket 10): the prereq guard in
    // useLessonLoader runs BEFORE startLesson() to avoid a self-unlock
    // bug: if the guard ran after, a direct URL visit would PATCH the row
    // to `in_progress`, and on the next page load the `existingStatus !==
    // "not_started"` branch would wave the learner through. Regression
    // here would be a silent security bypass of the entire prereq system
    // by anyone who pastes a URL. Assert by intercepting: no PATCH that
    // includes `status: "in_progress"` fires for the blocked lesson.
    const inProgressPatches: unknown[] = [];
    await page.route(
      `**/api/user/lessons/${COURSE_ID}/variables`,
      async (route) => {
        if (route.request().method() === "PATCH") {
          try {
            const body = JSON.parse(route.request().postData() ?? "{}");
            if (body.status === "in_progress") inProgressPatches.push(body);
          } catch {
            /* skip */
          }
        }
        await route.fallback();
      },
    );

    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/variables`);

    // Bounce landed.
    await expect(page).toHaveURL(new RegExp(`/learn/course/${COURSE_ID}$`), {
      timeout: 10_000,
    });

    // Give any stray async PATCH a beat before asserting. The guard's
    // navigate() happens synchronously before startLesson; a regression
    // would show up as a call here within the first second or two.
    await page.waitForTimeout(1000);
    expect(
      inProgressPatches,
      "prereq bounce must not write an in_progress row (would self-unlock on refresh)",
    ).toEqual([]);
  });

  test("resume toast: seeded lastCode triggers 'Your code was restored' banner", async ({
    page,
  }) => {
    const SAVED_CODE = "print('resumed from a previous session')\n";
    await loadProfile(page, "empty");

    // Seed a lesson progress row with lastCode on the server so the
    // LessonPage loader effect sees it on first hydrate.
    await seedLessonProgress(page, COURSE_ID, "hello-world", {
      status: "in_progress",
      attemptCount: 1,
      lastCode: { "main.py": SAVED_CODE },
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    // Resume banner visible immediately.
    await expect(page.getByText(/your code was restored/i)).toBeVisible({ timeout: 10_000 });

    // Monaco now carries the saved code (loadSavedCode populates the model).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const win = window as unknown as {
            monaco?: { editor?: { getModels: () => Array<{ getValue: () => string }> } };
          };
          const model = win.monaco?.editor?.getModels()?.[0];
          return model?.getValue() ?? "";
        }),
      )
      .toContain("resumed from a previous session");
  });

  test("resume toast auto-dismisses after RESUME_TOAST_MS (3s)", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedLessonProgress(page, COURSE_ID, "hello-world", {
      status: "in_progress",
      attemptCount: 1,
      lastCode: { "main.py": "print('x')\n" },
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    const toast = page.getByText(/your code was restored/i);
    await expect(toast).toBeVisible({ timeout: 10_000 });
    // RESUME_TOAST_MS is 3000 — give it 6s of slack for event-loop jitter.
    await expect(toast).toHaveCount(0, { timeout: 6_000 });
  });
});
