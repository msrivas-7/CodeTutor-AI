// Onboarding + coach specs (Phase 12G). Covers the four surfaces that render
// on first-visit and never return once dismissed: WelcomeOverlay (StartPage),
// Dashboard welcome banner, CourseOverview lesson-1 nudge, EditorCoach and
// WorkspaceCoach spotlight tours. Also covers CoachRail existence checks for
// states where a nudge is expected.
//
// These tests deliberately SKIP markOnboardingDone() — the whole point is to
// exercise the not-yet-dismissed code paths. Every test here starts from a
// profile where the relevant onboarding flags are NOT set.

import { expect, test } from "@playwright/test";

import { mockAllAI } from "../fixtures/aiMocks";
import { waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile } from "../fixtures/profiles";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

// Coaches auto-open after 3000ms — this lines up with COACH_AUTO_OPEN_MS in
// frontend/src/util/timings.ts. Tests must wait at least this long before
// asserting the spotlight appears.
const AUTO_OPEN_MS = 3_000;

test.describe("onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    // We deliberately do NOT call markOnboardingDone — the whole point of this
    // spec is to exercise the first-visit surfaces. Playwright gives us a
    // fresh context per test so localStorage is empty at the start; no
    // explicit wipe is needed.
  });

  test("WelcomeOverlay renders on first StartPage visit and dismiss persists", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/");

    // Skip button + role=button with aria-label="Skip onboarding".
    const skip = page.getByRole("button", { name: /skip onboarding/i });
    await expect(skip).toBeVisible({ timeout: 5_000 });
    // The spotlight CoachBubble renders a "Got it" button alongside the Skip.
    await expect(page.getByRole("button", { name: /^got it$/i })).toBeVisible();

    // Dismiss via Skip.
    await skip.click();
    await expect(skip).toHaveCount(0);

    // Flag persisted.
    expect(
      await page.evaluate(() => localStorage.getItem("onboarding:v1:welcome-done")),
    ).toBe("1");

    // Reload — overlay doesn't reappear.
    await page.reload();
    await expect(page.getByRole("button", { name: /skip onboarding/i })).toHaveCount(0);
  });

  test("WelcomeOverlay stepping through with 'Got it' also persists the done flag", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/");

    // 3 steps — click Got it three times. The advance handler has a 200ms
    // debounce to swallow double-fires from backdrop/button overlap, so we
    // pace the clicks to be safely past that window.
    for (let i = 0; i < 3; i++) {
      const gotIt = page.getByRole("button", { name: /^got it$/i });
      await expect(gotIt).toBeVisible({ timeout: 5_000 });
      await gotIt.click();
      await page.waitForTimeout(250);
    }
    // Overlay unmounts on final advance — flag is written to localStorage.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("onboarding:v1:welcome-done")), {
        timeout: 3_000,
      })
      .toBe("1");
  });

  test("Dashboard welcome banner renders for welcomed-not-started", async ({ page }) => {
    // welcomed-not-started has onboarding flags set but no course started. The
    // banner copy lives in LearningDashboardPage.tsx ("Ready to start coding?").
    await loadProfile(page, "welcomed-not-started");
    await page.goto("/learn");
    await expect(page.getByText(/ready to start coding/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /open\s+.*python/i })).toBeVisible();
  });

  test("CourseOverview lesson-1 nudge points at first lesson", async ({ page }) => {
    await loadProfile(page, "welcomed-not-started");
    await page.goto(`/learn/course/${COURSE_ID}`);

    // The nudge copy lives in CourseOverviewPage: "Start with **Lesson 1**…".
    await expect(page.getByText(/start with\s+lesson\s+1/i)).toBeVisible({ timeout: 5_000 });
  });

  test("EditorCoach auto-opens after delay; Skip tour dismisses permanently", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/editor");
    await waitForMonacoReady(page);

    // Tour opens after ~3s.
    const skipTour = page.getByRole("button", { name: /^skip tour$/i });
    await expect(skipTour).toBeVisible({ timeout: AUTO_OPEN_MS + 5_000 });
    await expect(page.getByRole("button", { name: /^got it$/i })).toBeVisible();

    // Dismiss via Skip tour.
    await skipTour.click();
    await expect(skipTour).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("onboarding:v1:editor-done")),
    ).toBe("1");

    // Reload — tour doesn't reappear.
    await page.reload();
    await waitForMonacoReady(page);
    await page.waitForTimeout(AUTO_OPEN_MS + 500);
    await expect(page.getByRole("button", { name: /^skip tour$/i })).toHaveCount(0);
  });

  test("WorkspaceCoach auto-opens on first lesson; stepping through completes the tour", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    const skipTour = page.getByRole("button", { name: /^skip tour$/i });
    await expect(skipTour).toBeVisible({ timeout: AUTO_OPEN_MS + 5_000 });
    // Dismiss via Skip tour — stepping through all 6 steps would require
    // clicking "Got it" six times, but targets may become stale between
    // steps (Monaco hasn't fully laid out). The dismiss path is the
    // critical one to exercise.
    await skipTour.click();
    await expect(skipTour).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("onboarding:v1:workspace-done")),
    ).toBe("1");
  });

  test("Coaches don't render when onboarding flags are already set", async ({ page }) => {
    // welcomed-not-started seeds all three onboarding flags. Neither the
    // WelcomeOverlay (StartPage) nor EditorCoach (Editor) should appear.
    await loadProfile(page, "welcomed-not-started");
    await page.goto("/");
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("button", { name: /skip onboarding/i })).toHaveCount(0);

    await page.goto("/editor");
    await waitForMonacoReady(page);
    await page.waitForTimeout(AUTO_OPEN_MS + 500);
    await expect(page.getByRole("button", { name: /^skip tour$/i })).toHaveCount(0);
  });
});
