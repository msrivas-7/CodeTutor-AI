// Lesson edge-case specs: stdin-driven lesson, locked lessons on the course
// overview, and the resume toast (saved code restoration). Each test exercises
// a narrow surface that's easy to regress during UI refactors.

import { randomUUID } from "node:crypto";

import { mockAllAI } from "../fixtures/aiMocks";
import { expect, getWorkerUser, test } from "../fixtures/auth";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import {
  BACKEND,
  loadProfile,
  markOnboardingDone,
  newBackendContext,
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
    // Seed the complete trusted prerequisite prefix; the server deliberately
    // refuses sparse client-side unlock lists.
    await seedCompletedLessons(page, COURSE_ID, ["hello-world", "variables"]);
    await page.goto(`/learn/course/${COURSE_ID}/lesson/input-output`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    // Use the golden solution — it reads name + birth_year from stdin and
    // prints "Hi <name>! You are about <age> years old.".
    await setMonacoValue(page, readLessonSolution(COURSE_ID, "input-output"));

    // Load canned stdin via the Stdin tab's named textarea.
    await S.stdinTab(page).click();
    const stdinBox = S.stdinInput(page);
    await stdinBox.click();
    await stdinBox.fill("Alice\n2000\n");
    await S.outputTab(page).click();

    await S.lessonRunButton(page).click();
    await expect(S.outputPanel(page)).toContainText(/Hi Alice/i, { timeout: 30_000 });
    await expect(S.outputPanel(page)).toContainText(/25 years old/i);
  });

  test("a fresh run clears a stale Check verdict before publishing new output", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await setMonacoValue(page, readLessonSolution(COURSE_ID, "hello-world"));

    await S.checkMyWorkButton(page).click();
    const staleVerdict = page.getByText("Run your code first before checking.", {
      exact: true,
    });
    await expect(staleVerdict).toBeVisible();

    await S.lessonRunButton(page).click();
    await expect(staleVerdict).toHaveCount(0);
    await expect(S.outputPanel(page)).toContainText(/Hello, Alice!/i, {
      timeout: 30_000,
    });
  });

  test("accepting a conflicting lesson draft focuses the newly mounted editor", async (
    { page },
    testInfo,
  ) => {
    await loadProfile(page, "empty");
    await seedCompletedLessons(page, COURSE_ID, ["hello-world"]);
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    const user = await getWorkerUser(testInfo.workerIndex);
    const backend = await newBackendContext();
    const headers = {
      "X-Requested-With": "codetutor",
      Authorization: `Bearer ${user.session.access_token}`,
      "Content-Type": "application/json",
    };
    try {
      const lessonsResponse = await backend.get(
        `${BACKEND}/api/user/lessons?courseId=${COURSE_ID}`,
        { headers },
      );
      expect(lessonsResponse.ok(), await lessonsResponse.text()).toBeTruthy();
      const lessons = (await lessonsResponse.json()) as {
        lessons: Array<{ lessonId: string; draftRevision: number }>;
      };
      const current = lessons.lessons.find((lesson) => lesson.lessonId === "hello-world");
      expect(current).toBeDefined();

      // The mounted lesson may finish its initial background save between the
      // revision read above and this deliberate remote write. Rebase only the
      // test setup against the authoritative 409 payload; once our remote
      // draft wins, the product path below still has to detect and resolve the
      // real stale-local conflict without retries or weakened assertions.
      let expectedRevision = current?.draftRevision ?? 0;
      let remoteSaved = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const remoteSave = await backend.put(
          `${BACKEND}/api/user/lessons/${COURSE_ID}/hello-world/draft`,
          {
            headers,
            data: {
              code: { "remote-focus.py": "# accepted remote draft\n" },
              expectedRevision,
              writerId: randomUUID(),
            },
          },
        );
        if (remoteSave.ok()) {
          remoteSaved = true;
          break;
        }
        if (remoteSave.status() !== 409) {
          expect(remoteSave.ok(), await remoteSave.text()).toBeTruthy();
        }
        const conflict = (await remoteSave.json()) as {
          current?: { draftRevision?: number };
        };
        const latestRevision = conflict.current?.draftRevision;
        if (!Number.isInteger(latestRevision)) {
          throw new Error("Lesson draft conflict omitted the authoritative revision");
        }
        expectedRevision = latestRevision!;
      }
      expect(
        remoteSaved,
        "remote conflict fixture could not win the latest draft revision after 3 attempts",
      ).toBe(true);

      await setMonacoValue(page, "# stale local draft\n");
      const useNewer = page.getByRole("button", { name: "Use newer saved version" });
      await expect(useNewer).toBeVisible({ timeout: 15_000 });
      await useNewer.click();

      await expect(
        page.getByRole("button", { name: "Active file remote-focus.py" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null),
        )
        .toBe("Code editor for remote-focus.py");

      // The conflict request is one-shot. A later Monaco remount must not
      // steal focus from another interaction's explicit recovery target.
      await page.getByRole("button", { name: /Practice 0 of 3/i }).click();
      await page.getByText(/Back to lesson/i).click();
      await expect(
        page.getByRole("heading", { level: 1, name: /Hello, World!/i }),
      ).toBeFocused();
    } finally {
      await backend.dispose();
    }
  });

  test("missing lesson gives a responsive recovery path without header collisions", async ({
    page,
  }) => {
    await loadProfile(page, "empty");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/learn/course/${COURSE_ID}/lesson/not-a-real-lesson`);

    const unavailableHeading = page.getByRole("heading", {
      name: "Lesson unavailable",
      exact: true,
    });
    await expect(unavailableHeading).toBeVisible();
    await expect(unavailableHeading).toBeFocused();
    await expect(page.getByText("CodeTutor AI", { exact: true })).toBeHidden();

    const headerCollisions = await page.locator("header").evaluate((header) => {
      const controls = [...header.querySelectorAll<HTMLElement>("button, select, [role='status']")]
        .map((element) => ({
          name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
          rect: element.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const collisions: string[] = [];
      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          const a = controls[left]!;
          const b = controls[right]!;
          const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (overlapX > 0.5 && overlapY > 0.5) collisions.push(`${a.name} overlaps ${b.name}`);
        }
      }
      return collisions;
    });
    expect(headerCollisions).toEqual([]);

    const browse = page.getByRole("link", {
      name: "Browse guided learning",
      exact: true,
    });
    const start = page.getByRole("link", { name: "Go to Start", exact: true });
    for (const link of [browse, start]) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await browse.click();
    await expect(page.getByRole("heading", { name: "Guided Learning" })).toBeVisible();
  });

  test("missing course announces its recovery heading on arrival", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/learn/course/not-a-real-course");

    const heading = page.getByRole("heading", {
      name: "Course unavailable",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByRole("link", { name: "Browse guided learning" })).toBeVisible();
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

  test("reset prerequisite keeps downstream progress saved but clearly locks its entry points", async ({
    page,
  }) => {
    await loadProfile(page, "all-complete");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    await S.overflowMenuButton(page).click();
    await S.resetLessonMenuItem(page).click();
    const resetDialog = page.getByRole("alertdialog", {
      name: /reset lesson progress/i,
    });
    await expect(resetDialog).toContainText(
      /lessons that depend on this one keep their progress, but stay locked/i,
    );
    await resetDialog.getByRole("button", { name: /^reset lesson$/i }).click();
    await expect(resetDialog).toHaveCount(0);

    await page.getByRole("button", { name: "Back to course" }).click();
    const savedNotice = page
      .getByRole("status")
      .filter({ hasText: /later progress is still saved/i });
    await expect(savedNotice).toContainText(/recomplete hello, world!/i);
    await expect(savedNotice).toBeFocused();

    const savedVariables = page.getByRole("button", {
      name: /variables and strings.*locked.*recomplete prerequisites.*progress saved/i,
    });
    await expect(savedVariables).toBeVisible();
    await expect(savedVariables).toBeDisabled();

    const savedPractice = page.getByRole("button", {
      name: /recomplete prerequisites to reopen practice/i,
    }).first();
    await expect(savedPractice).toBeVisible();
    await expect(savedPractice).toBeDisabled();

    await page.setViewportSize({ width: 390, height: 844 });
    const backButton = page.getByRole("button", { name: "Back to courses" });
    const streakButton = page.getByRole("button", { name: /day streak/i });
    const feedbackButton = page.getByRole("button", { name: "Give feedback" });

    // The streak is one persistent, spring-animated surface. A viewport
    // change intentionally morphs that same node from its desktop geometry
    // into the compact header, so wait for its final responsive position
    // before enforcing the no-collision contract.
    await expect
      .poll(async () => {
        const [streak, feedback] = await Promise.all([
          streakButton.boundingBox(),
          feedbackButton.boundingBox(),
        ]);
        if (!streak || !feedback) return false;
        return streak.x + streak.width <= feedback.x;
      })
      .toBe(true);
    const [backBox, streakBox, feedbackBox] = await Promise.all([
      backButton.boundingBox(),
      streakButton.boundingBox(),
      feedbackButton.boundingBox(),
    ]);
    expect(backBox).not.toBeNull();
    expect(streakBox).not.toBeNull();
    expect(feedbackBox).not.toBeNull();
    expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(streakBox!.x);
    expect(streakBox!.x + streakBox!.width).toBeLessThanOrEqual(feedbackBox!.x);
    const courseHeadingBox = await page
      .getByRole("heading", { name: "Python Fundamentals" })
      .boundingBox();
    expect(courseHeadingBox).not.toBeNull();
    expect(courseHeadingBox!.width).toBeLessThanOrEqual(1);
    expect(courseHeadingBox!.height).toBeLessThanOrEqual(1);
    expect(backBox!.height).toBeGreaterThanOrEqual(44);
  });

  test("signed-in try URL redirects to the authenticated lesson with saved progress", async ({
    page,
  }) => {
    await loadProfile(page, "all-complete");
    await page.goto(`/try/lesson/${COURSE_ID}/hello-world`);
    await waitForMonacoReady(page);

    await expect(page).toHaveURL(
      new RegExp(`/learn/course/${COURSE_ID}/lesson/hello-world$`),
    );
    await expect(page.getByRole("button", { name: /sign up to save/i })).toHaveCount(0);
    await expect(page.getByText("✓ Completed", { exact: true })).toBeVisible();
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
