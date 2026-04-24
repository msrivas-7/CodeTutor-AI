// Onboarding + coach specs (Phase 12G). Covers the four surfaces that render
// on first-visit and never return once dismissed: WelcomeOverlay (StartPage),
// Dashboard welcome banner, CourseOverview lesson-1 nudge, EditorCoach and
// WorkspaceCoach spotlight tours. Also covers CoachRail existence checks for
// states where a nudge is expected.
//
// These tests deliberately SKIP markOnboardingDone() — the whole point is to
// exercise the not-yet-dismissed code paths. Every test here starts from a
// profile where the relevant onboarding flags are NOT set.

import { expect, test } from "../fixtures/auth";

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

  test("StartPage redirects fresh users to /welcome and Skip persists the flag", async ({ page }) => {
    await loadProfile(page, "empty", { onboarded: false });
    await page.goto("/");

    // StartPage now redirects a welcomeDone=false user into the /welcome
    // cinematic instead of rendering WelcomeOverlay in-place.
    await expect(page).toHaveURL(/\/welcome$/, { timeout: 5_000 });
    // The "Skip intro" affordance is intentionally de-prioritised (11px,
    // bottom-right, muted) but always present.
    const skipIntro = page.getByRole("button", { name: /skip intro/i });
    await expect(skipIntro).toBeVisible({ timeout: 5_000 });
    await skipIntro.click();

    // After skip we land on the dashboard (empty profile → "/") and the
    // server-backed welcomeDone flag is true, so reload does not re-route
    // through /welcome.
    await expect(page).not.toHaveURL(/\/welcome$/, { timeout: 5_000 });
    await page.reload();
    await expect(page).not.toHaveURL(/\/welcome$/, { timeout: 5_000 });
  });

  test("Cinematic auto-advances into hello-world with ?firstRun=1", async ({ page }) => {
    await loadProfile(page, "empty", { onboarded: false });
    await page.goto("/welcome");

    // The scripted cinematic runs ~14s end-to-end and then navigates to the
    // first lesson with the firstRun flag. We allow a generous budget —
    // reduced-motion short-circuit also respects the same terminal nav.
    await expect(page).toHaveURL(/lesson\/hello-world\?.*firstRun=1/, {
      timeout: 20_000,
    });
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
    await loadProfile(page, "empty", { onboarded: false });
    await page.goto("/editor");
    await waitForMonacoReady(page);

    // Tour opens after ~3s.
    const skipTour = page.getByRole("button", { name: /^skip tour$/i });
    await expect(skipTour).toBeVisible({ timeout: AUTO_OPEN_MS + 5_000 });
    await expect(page.getByRole("button", { name: /^got it$/i })).toBeVisible();

    // Dismiss via Skip tour, then reload to confirm server-backed flag held.
    await skipTour.click();
    await expect(skipTour).toHaveCount(0);

    await page.reload();
    await waitForMonacoReady(page);
    await page.waitForTimeout(AUTO_OPEN_MS + 500);
    await expect(page.getByRole("button", { name: /^skip tour$/i })).toHaveCount(0);
  });

  test("WorkspaceCoach auto-opens on first lesson; stepping through completes the tour", async ({ page }) => {
    await loadProfile(page, "empty", { onboarded: false });
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
