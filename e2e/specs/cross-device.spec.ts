// Phase 18b: per-user state — preferences, course/lesson progress, editor
// project — lives in Supabase Postgres and is hydrated on sign-in. These
// specs simulate "the same user signs in on a second device": we open a
// fresh browser context (isolated localStorage) as the same worker user and
// assert that state persists across the device boundary. The asymmetry is
// the whole point — if any bit stays in localStorage-only, the second
// context misses it.
//
// We reuse the auth fixture's per-worker test user (admin-created in
// globalSetup) so we don't need signup round-trips. Each test resets that
// user's server state first via the profiles fixture so earlier tests in
// the same worker can't bleed through.

import {
  expect,
  loginAsTestUser,
  test,
  trackSessionCleanup,
} from "../fixtures/auth";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { mockAllAI } from "../fixtures/aiMocks";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import * as S from "../utils/selectors";
import { seedAuthedRetrievalPass } from "../fixtures/retrievalGate";
import { waitForJsonApiResponse } from "../fixtures/persistenceEvidence";

const COURSE_ID = "python-fundamentals";

test.describe("cross-device persistence (Phase 18b)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginAsTestUser(page, testInfo.workerIndex);
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  test(
    "theme change persists across a fresh browser context for the same user",
    async ({ page, browser }, testInfo) => {
      // 1. On device A (pre-authed page), flip to light theme via Settings.
      await page.goto("/start");
      await S.openSettings(page, "profile");
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      const saveAck = waitForJsonApiResponse<
        { theme: string },
        { theme?: string }
      >(page, {
        method: "PATCH",
        pathname: "/api/user/preferences",
        requestMatches: (body) => body?.theme === "light",
      });
      await page.getByRole("button", { name: /^light$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      expect((await saveAck).responseBody.theme).toBe("light");

      // 2. Open a fresh context (device B) and log in as the same user.
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      const hydrateAck = waitForJsonApiResponse<{ theme: string }>(pageB, {
        method: "GET",
        pathname: "/api/user/preferences",
      });
      await pageB.goto("/start");
      expect((await hydrateAck).responseBody.theme).toBe("light");
      // 3. Server-backed theme hydrates into <html data-theme>.
      await expect(pageB.locator("html")).toHaveAttribute("data-theme", "light", {
        timeout: 10_000,
      });
      await contextB.close();
    },
  );

  test(
    "course progress persists across a fresh browser context for the same user",
    async ({ page, browser }, testInfo) => {
      // Phase A — A1 added a retrieval-check gate to hello-world, so
      // "Check My Work" now lands on a multiple-choice question instead
      // of the celebration. This spec is about cross-device PROGRESS
      // persistence, not the gate (which has its own spec), so seed the
      // pass for this worker's user and keep the assertion focused.
      await seedAuthedRetrievalPass(page, testInfo.workerIndex);
      // 1. Device A: complete lesson 1 (hello-world) by submitting the golden
      //    solution. The frontend fires a PATCH to /api/user/courses and
      //    /api/user/lessons on completion.
      await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
      await waitForMonacoReady(page);
      await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });
      // Phase A — A1 added `forbidden_in_stdout: "Hello, World!"` to this
      // lesson so a learner has to type something of their own rather
      // than copy the example. The old golden solution printed exactly
      // that string and now fails Check, so use a passing greeting that
      // still satisfies `expected_stdout: "Hello, "`.
      await setMonacoValue(page, 'print("Hello, Maya!")\n');
      await S.lessonRunButton(page).click();
      // Running alone doesn't mark the lesson complete — the learner must
      // click "Check My Work" to trigger the output-match verdict. Wait for
      // it to enable (gated on a successful run), then click it.
      await expect(S.checkMyWorkButton(page)).toBeEnabled({ timeout: 15_000 });
      const lessonSaveAck = waitForJsonApiResponse<
        { status: string; lessonId: string },
        { status?: string }
      >(page, {
        method: "PATCH",
        pathname: `/api/user/lessons/${COURSE_ID}/hello-world`,
        requestMatches: (body) => body?.status === "completed",
      });
      const courseSaveAck = waitForJsonApiResponse<
        { completedLessonIds: string[] },
        { completedLessonIds?: string[] }
      >(page, {
        method: "PATCH",
        pathname: `/api/user/courses/${COURSE_ID}`,
        requestMatches: (body) =>
          body?.completedLessonIds?.includes("hello-world") === true,
      });
      await S.checkMyWorkButton(page).click();
      const [lessonSaved, courseSaved] = await Promise.all([
        lessonSaveAck,
        courseSaveAck,
      ]);
      expect(lessonSaved.responseBody.status).toBe("completed");
      expect(courseSaved.responseBody.completedLessonIds).toContain("hello-world");
      // Completion opens a "Lesson Complete!" alertdialog. Scope to that
      // specifically — there are multiple "Next lesson" buttons in the DOM
      // (recap panel + course nav) once complete.
      await expect(
        page.getByRole("dialog", { name: /lesson complete/i }),
      ).toBeVisible({ timeout: 30_000 });

      // 2. Device B: fresh context, same user.
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      const courseHydrateAck = waitForJsonApiResponse<{
        courses: Array<{ courseId: string; completedLessonIds: string[] }>;
      }>(pageB, {
        method: "GET",
        pathname: "/api/user/courses",
      });
      const lessonHydrateAck = waitForJsonApiResponse<{
        lessons: Array<{ courseId: string; lessonId: string; status: string }>;
      }>(pageB, {
        method: "GET",
        pathname: "/api/user/lessons",
      });
      await pageB.goto(`/learn/course/${COURSE_ID}`);
      const [courses, lessons] = await Promise.all([
        courseHydrateAck,
        lessonHydrateAck,
      ]);
      expect(
        courses.responseBody.courses.find((course) => course.courseId === COURSE_ID)
          ?.completedLessonIds,
      ).toContain("hello-world");
      expect(
        lessons.responseBody.lessons.find(
          (lesson) =>
            lesson.courseId === COURSE_ID && lesson.lessonId === "hello-world",
        )?.status,
      ).toBe("completed");

      // 3. Course overview shows "1/N lessons" on the new device,
      //    confirming server hydration picked up the completed lesson.
      await expect(pageB.getByText(/1\/\d+\s+lessons/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await contextB.close();
    },
  );

  test(
    "onboarding flags persist across a fresh browser context for the same user",
    async ({ browser }, testInfo) => {
      // markOnboardingDone in beforeEach already flipped all three flags
      // server-side. Open a brand-new context and confirm the Welcome
      // overlay doesn't re-appear.
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      const hydrateAck = waitForJsonApiResponse<{ welcomeDone: boolean }>(pageB, {
        method: "GET",
        pathname: "/api/user/preferences",
      });
      await pageB.goto("/start");
      expect((await hydrateAck).responseBody.welcomeDone).toBe(true);
      // The spotlight "Skip onboarding" button never shows because the
      // welcomeDone flag hydrated from server state.
      await expect(
        pageB.getByRole("button", { name: /user menu/i }),
      ).toBeVisible();
      await expect(
        pageB.getByRole("button", { name: /skip onboarding/i }),
      ).toHaveCount(0);
      await contextB.close();
    },
  );

  test(
    "editor project (file contents) persists across a fresh browser context",
    async ({ page, browser }, testInfo) => {
      const stamp = Date.now();
      const IDENTIFIABLE = `print("persisted-editor-${stamp}")\n`;
      await page.goto("/editor");
      await waitForMonacoReady(page);
      const saveAck = waitForJsonApiResponse<
        { files: Record<string, string> },
        { files?: Record<string, string> }
      >(page, {
        method: "PUT",
        pathname: "/api/user/editor-project",
        requestMatches: (body) =>
          Object.values(body?.files ?? {}).join("\n").includes(
            `persisted-editor-${stamp}`,
          ),
      });
      await setMonacoValue(page, IDENTIFIABLE);
      expect(
        Object.values((await saveAck).responseBody.files).join("\n"),
      ).toContain(`persisted-editor-${stamp}`);

      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      const cleanupPageBSessions = trackSessionCleanup(pageB, testInfo.workerIndex);
      try {
        const hydrateAck = waitForJsonApiResponse<{
          files: Record<string, string>;
        }>(pageB, {
          method: "GET",
          pathname: "/api/user/editor-project",
        });
        await pageB.goto("/editor");
        expect(
          Object.values((await hydrateAck).responseBody.files).join("\n"),
        ).toContain(`persisted-editor-${stamp}`);
        await waitForMonacoReady(pageB);

        await expect
          .poll(
            async () =>
              pageB.evaluate(() => {
                const win = window as unknown as {
                  monaco?: {
                    editor?: { getModels: () => Array<{ getValue: () => string }> };
                  };
                };
                return win.monaco?.editor?.getModels()?.[0]?.getValue() ?? "";
              }),
            { timeout: 15_000 },
          )
          .toContain(`persisted-editor-${stamp}`);
      } finally {
        await cleanupPageBSessions();
        await contextB.close();
      }
    },
  );

  test(
    "same-device sign-out → sign-in re-hydrates preferences",
    async ({ page }, testInfo) => {
      // Flip theme + sign out.
      await page.goto("/start");
      await S.openSettings(page, "profile");
      const saveAck = waitForJsonApiResponse<
        { theme: string },
        { theme?: string }
      >(page, {
        method: "PATCH",
        pathname: "/api/user/preferences",
        requestMatches: (body) => body?.theme === "light",
      });
      await page.getByRole("button", { name: /^light$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      expect((await saveAck).responseBody.theme).toBe("light");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /user menu/i }).click();
      await page.getByRole("menuitem", { name: /^sign out$/i }).click();
      await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

      // Sign in again (re-inject session and navigate).
      await loginAsTestUser(page, testInfo.workerIndex);
      const hydrateAck = waitForJsonApiResponse<{ theme: string }>(page, {
        method: "GET",
        pathname: "/api/user/preferences",
      });
      await page.goto("/start");
      expect((await hydrateAck).responseBody.theme).toBe("light");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light", {
        timeout: 10_000,
      });
    },
  );
});
