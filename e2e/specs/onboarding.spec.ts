// Onboarding + coach specs (Phase 12G). Covers the four surfaces that render
// on first-visit and never return once dismissed: WelcomeOverlay (StartPage),
// Dashboard welcome banner, CourseOverview lesson-1 nudge, EditorCoach and
// contextual EditorCoach guidance. Lesson workspace tours were removed in
// Phase A-Q so the learner can act immediately. Also covers CoachRail checks for
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

// Coaches auto-open after COACH_AUTO_OPEN_MS in frontend/src/util/timings.ts.
// Tests must wait at least this long before asserting the spotlight appears.
// Phase 27: reconciled to 600ms (was 3000ms here, but the source value has
// been 600 for some time — the stale constant inflated test wait budgets
// without changing correctness). We don't import the source value to avoid
// pulling the frontend tsconfig into the e2e build; this fails loud if the
// source value drifts again.
const AUTO_OPEN_MS = 600;

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
    await page.goto("/start");

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
    // Collapse state is browser-local rather than account-scoped. Reproduce a
    // returning-browser/new-account handoff so the tour cannot spotlight an
    // invisible rail inherited from the previous user.
    await page.addInitScript(() => {
      localStorage.setItem("ui:filesCollapsed", "true");
      localStorage.setItem("ui:tutorCollapsed", "true");
    });
    await page.goto("/editor");
    await waitForMonacoReady(page);

    // Tour opens after ~3s.
    const skipTour = page.getByRole("button", { name: /^skip tour$/i });
    await expect(skipTour).toBeVisible({ timeout: AUTO_OPEN_MS + 5_000 });
    await expect(page.getByRole("button", { name: /^got it$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /show files panel/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /show tutor panel/i })).toHaveCount(0);

    // Advance to File Tree and prove the highlighted product control is real,
    // visible, and clickable through the visual coach treatment.
    await page.getByRole("button", { name: /^got it$/i }).click();
    await expect(page.getByRole("heading", { name: "File Tree" })).toBeVisible();
    await page.getByRole("button", { name: "stats.py" }).click();
    await expect(page.getByRole("textbox", { name: /code editor for stats\.py/i })).toBeVisible();

    // Dismiss via Skip tour, then reload to confirm server-backed flag held.
    // The coach hides optimistically, so wait for the exact persistence write
    // instead of racing an immediate reload against the background PATCH.
    const coachSaved = page.waitForResponse(
      (r) => {
        if (
          !r.url().includes("/api/user/preferences") ||
          r.request().method() !== "PATCH" ||
          !r.ok()
        ) {
          return false;
        }
        try {
          const body = r.request().postDataJSON() as {
            editorCoachDone?: boolean;
          };
          return body.editorCoachDone === true;
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    );
    await skipTour.click();
    await expect(skipTour).toHaveCount(0);
    await coachSaved;

    await page.reload();
    await waitForMonacoReady(page);
    await page.waitForTimeout(AUTO_OPEN_MS + 500);
    await expect(page.getByRole("button", { name: /^skip tour$/i })).toHaveCount(0);
  });

  test("first lesson opens without a stacked workspace tour or locked actions", async ({ page }) => {
    await loadProfile(page, "empty", { onboarded: false });
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    await page.waitForTimeout(AUTO_OPEN_MS + 500);
    await expect(page.getByRole("button", { name: /^skip tour$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /run code/i }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: /check/i }).first()).toBeEnabled();
  });

  test("Coaches don't render when onboarding flags are already set", async ({ page }) => {
    // welcomed-not-started seeds all three onboarding flags. Neither the
    // WelcomeOverlay (StartPage) nor EditorCoach (Editor) should appear.
    await loadProfile(page, "welcomed-not-started");
    await page.goto("/start");
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("button", { name: /skip onboarding/i })).toHaveCount(0);

    await page.goto("/editor");
    await waitForMonacoReady(page);
    await page.waitForTimeout(AUTO_OPEN_MS + 500);
    await expect(page.getByRole("button", { name: /^skip tour$/i })).toHaveCount(0);
  });
});
