// Smoke spec — the "does the rig even boot?" baseline. If this fails, the
// harness itself is broken; do not chase a real bug elsewhere.
//
// Assertions are deliberately minimal:
//  - StartPage renders + has a "CodeTutor" or product title
//  - Both top-level routes (/editor, /learn) are reachable
//  - No uncaught page errors fire during a cold boot
//  - localStorage is empty after clearAppStorage — proves the helper works

import { expect, test } from "../fixtures/auth";

import { clearAppStorage, loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { mockAllAI } from "../fixtures/aiMocks";
import { waitForMonacoReady } from "../fixtures/monaco";

test.describe("smoke", () => {
  test("StartPage loads and shows the product title", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    // Broad match: any text containing "CodeTutor" (header, brand badge, etc.)
    await expect(page.getByText(/code ?tutor/i).first()).toBeVisible({ timeout: 15_000 });
    expect(errors, `uncaught page errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("/editor route mounts Monaco", async ({ page }) => {
    await mockAllAI(page); // tutor panel is visible on editor page; prevent real network
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
  });

  test("/learn route mounts the dashboard", async ({ page }) => {
    await page.goto("/learn");
    // The "Guided Learning" header renders in every dashboard state (fresh
    // visit, in-progress, completed) — match on it rather than the body copy
    // which varies with progress bled in from earlier tests in the worker.
    await expect(
      page.getByRole("heading", { name: /guided learning/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("/courses/registry.json serves JSON, not the SPA fallback", async ({ page }) => {
    // Regression: Vite's publicDir hides any `_`-prefixed file, so a manifest
    // named `_registry.json` would silently 200 with index.html (SPA fallback).
    // That shadowed the dashboard in CI even though the file existed on disk.
    // Keep the top-level registry URL on a non-underscore name forever.
    const res = await page.request.get("/courses/registry.json");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body.courses)).toBe(true);
    expect(body.courses.length).toBeGreaterThan(0);
  });

  test("StartPage renders ResumeLearningCard for a returning learner", async ({ page }) => {
    // Phase 20-P3: returning learners with in-progress courseProgress see
    // a Resume card above the cold 2-card grid. mid-course-healthy has 5
    // Python lessons completed → the next unfinished lesson is "functions"
    // (order 6). Either Python or JS can win the updatedAt tiebreak in the
    // seeder, so we pattern-match on shared shape: a Resume button + an
    // "N of M done" momentum headline (Cinema Kit Phase 3.3 reframed
    // the copy from "Continue <course>" to a Fraunces hero count).
    await mockAllAI(page);
    await loadProfile(page, "mid-course-healthy");
    await markOnboardingDone(page);
    await page.goto("/");

    const resumeBtn = page.getByRole("button", { name: /^resume$/i });
    await expect(resumeBtn).toBeVisible({ timeout: 10_000 });
    // The headline shape is "{N} of {M} done" — assert the structural
    // text rather than tying to a specific count, since the seeded
    // profile may evolve.
    await expect(page.getByText(/of\s+\d+\s+done/i)).toBeVisible();

    await resumeBtn.click();
    await expect(page).toHaveURL(
      /\/learn\/course\/(python-fundamentals|javascript-fundamentals)\/lesson\/[a-z0-9-]+$/,
    );
  });

  test("clearAppStorage wipes owned localStorage keys", async ({ page }) => {
    await page.goto("/");
    // Write some owned keys directly, then prove the helper clears them.
    await page.evaluate(() => {
      localStorage.setItem("learner:v1:marker", "hello");
      localStorage.setItem("onboarding:v1:marker", "hello");
      localStorage.setItem("unrelated-app:marker", "keep");
    });
    await clearAppStorage(page);
    const result = await page.evaluate(() => ({
      learner: localStorage.getItem("learner:v1:marker"),
      onboarding: localStorage.getItem("onboarding:v1:marker"),
      unrelated: localStorage.getItem("unrelated-app:marker"),
    }));
    expect(result.learner).toBeNull();
    expect(result.onboarding).toBeNull();
    // Unrelated keys are preserved — allow-list integrity.
    expect(result.unrelated).toBe("keep");
  });
});
