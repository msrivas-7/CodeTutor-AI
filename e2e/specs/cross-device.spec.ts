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

import { test as rawTest, expect } from "@playwright/test";
import { loginAsTestUser } from "../fixtures/auth";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { mockAllAI } from "../fixtures/aiMocks";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

rawTest.describe("cross-device persistence (Phase 18b)", () => {
  rawTest.beforeEach(async ({ page }, testInfo) => {
    await loginAsTestUser(page, testInfo.workerIndex);
    await mockAllAI(page);
    await loadProfile(page, "empty");
    await markOnboardingDone(page);
  });

  rawTest(
    "theme change persists across a fresh browser context for the same user",
    async ({ page, browser }, testInfo) => {
      // 1. On device A (pre-authed page), flip to light theme via Settings.
      await page.goto("/start");
      await S.openSettings(page, "profile");
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await page.getByRole("button", { name: /^light$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      // Buffer for the background PATCH to land.
      await page.waitForTimeout(500);

      // 2. Open a fresh context (device B) and log in as the same user.
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      await pageB.goto("/");
      // 3. Server-backed theme hydrates into <html data-theme>.
      await expect(pageB.locator("html")).toHaveAttribute("data-theme", "light", {
        timeout: 10_000,
      });
      await contextB.close();
    },
  );

  rawTest(
    "course progress persists across a fresh browser context for the same user",
    async ({ page, browser }, testInfo) => {
      // 1. Device A: complete lesson 1 (hello-world) by submitting the golden
      //    solution. The frontend fires a PATCH to /api/user/courses and
      //    /api/user/lessons on completion.
      await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
      await waitForMonacoReady(page);
      await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });
      await setMonacoValue(page, 'print("Hello, World!")\n');
      await S.lessonRunButton(page).click();
      // Running alone doesn't mark the lesson complete — the learner must
      // click "Check My Work" to trigger the output-match verdict. Wait for
      // it to enable (gated on a successful run), then click it.
      await expect(S.checkMyWorkButton(page)).toBeEnabled({ timeout: 15_000 });
      await S.checkMyWorkButton(page).click();
      // Completion opens a "Lesson Complete!" alertdialog. Scope to that
      // specifically — there are multiple "Next lesson" buttons in the DOM
      // (recap panel + course nav) once complete.
      await expect(
        page.getByRole("alertdialog", { name: /lesson complete/i }),
      ).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);

      // 2. Device B: fresh context, same user.
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      await pageB.goto(`/learn/course/${COURSE_ID}`);

      // 3. Course overview shows "1/N lessons" on the new device,
      //    confirming server hydration picked up the completed lesson.
      await expect(pageB.getByText(/1\/\d+\s+lessons/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await contextB.close();
    },
  );

  rawTest(
    "onboarding flags persist across a fresh browser context for the same user",
    async ({ browser }, testInfo) => {
      // markOnboardingDone in beforeEach already flipped all three flags
      // server-side. Open a brand-new context and confirm the Welcome
      // overlay doesn't re-appear.
      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      await pageB.goto("/");
      // The spotlight "Skip onboarding" button never shows because the
      // welcomeDone flag hydrated from server state.
      await pageB.waitForTimeout(1_000);
      await expect(
        pageB.getByRole("button", { name: /skip onboarding/i }),
      ).toHaveCount(0);
      await contextB.close();
    },
  );

  rawTest(
    "editor project (file contents) persists across a fresh browser context",
    async ({ page, browser }, testInfo) => {
      const stamp = Date.now();
      const IDENTIFIABLE = `print("persisted-editor-${stamp}")\n`;
      await page.goto("/editor");
      await waitForMonacoReady(page);
      await setMonacoValue(page, IDENTIFIABLE);
      // Editor persistence hook debounces 800ms; give it time to flush.
      await page.waitForTimeout(1_500);

      const contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await loginAsTestUser(pageB, testInfo.workerIndex);
      await pageB.goto("/editor");
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
      await contextB.close();
    },
  );

  rawTest(
    "same-device sign-out → sign-in re-hydrates preferences",
    async ({ page }, testInfo) => {
      // Flip theme + sign out.
      await page.goto("/start");
      await S.openSettings(page, "profile");
      await page.getByRole("button", { name: /^light$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.waitForTimeout(500);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /user menu/i }).click();
      await page.getByRole("menuitem", { name: /^sign out$/i }).click();
      await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });

      // Sign in again (re-inject session and navigate).
      await loginAsTestUser(page, testInfo.workerIndex);
      await page.goto("/start");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light", {
        timeout: 10_000,
      });
    },
  );
});
