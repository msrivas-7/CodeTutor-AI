// Smoke spec — the "does the rig even boot?" baseline. If this fails, the
// harness itself is broken; do not chase a real bug elsewhere.
//
// Assertions are deliberately minimal:
//  - StartPage renders + has a "CodeTutor" or product title
//  - Both top-level routes (/editor, /learn) are reachable
//  - No uncaught page errors fire during a cold boot
//  - localStorage is empty after clearAppStorage — proves the helper works

import { expect, test } from "@playwright/test";

import { clearAppStorage } from "../fixtures/profiles";
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
    // Dashboard has either the welcome banner (first visit) or a continue card.
    await expect(
      page.getByText(/dashboard|continue learning|ready to start|your learning/i).first()
    ).toBeVisible({ timeout: 15_000 });
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
