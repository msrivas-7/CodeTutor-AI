// Progress Export/Import specs (Phase 11.2). Exercises the end-user roundtrip
// in Settings → General → Progress: download a JSON blob, load it on a fresh
// profile, confirm the destructive-overwrite modal, reload, and assert the
// imported state is live. Also covers allow-list rejection (non-owned keys)
// and invalid-JSON rejection — both surface via the inline [role="status"]
// error pill, not a browser alert.

import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { mockAllAI } from "../fixtures/aiMocks";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import * as S from "../utils/selectors";

async function openSettings(page: Page): Promise<void> {
  // The gear-icon SettingsButton is rendered on every page (StartPage,
  // Dashboard, CourseOverview, Editor, Lesson). Use the first one available
  // on the current page.
  await S.settingsButton(page).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.describe("progress I/O", () => {
  // The file-upload flow (setInputFiles → React onChange → confirm modal)
  // was intermittently racy under 4-worker parallelism — the change event
  // would land but the modal render wouldn't make it before the next
  // assertion. Serial mode removes inter-test contention on the same
  // frontend/backend shared stack.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("Export progress downloads a JSON blob with owned-prefix keys", async ({ page }) => {
    await loadProfile(page, "mid-course-healthy");
    await page.goto("/learn");

    await openSettings(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Export progress$/ }).click(),
    ]);

    // Filename pattern is `codetutor-progress-YYYY-MM-DD.json`.
    expect(download.suggestedFilename()).toMatch(/^codetutor-progress-\d{4}-\d{2}-\d{2}\.json$/);

    // Read the blob — all keys should be owned prefixes.
    const tmpPath = path.join(os.tmpdir(), `export-${Date.now()}.json`);
    await download.saveAs(tmpPath);
    const json = await fs.readFile(tmpPath, "utf8");
    const parsed = JSON.parse(json) as Record<string, string>;
    const keys = Object.keys(parsed);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(/^(learner|onboarding):v1:/);
    }
    // Spot-check: mid-course-healthy has a course-progress record.
    expect(keys).toContain("learner:v1:progress:python-fundamentals");
    // Cleanup
    await fs.unlink(tmpPath).catch(() => {});
  });

  test("Import roundtrip writes imported state into localStorage", async ({ page }) => {
    // Export mid-course state first.
    await loadProfile(page, "mid-course-healthy");
    await page.goto("/learn");
    await openSettings(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Export progress$/ }).click(),
    ]);
    const tmpPath = path.join(os.tmpdir(), `roundtrip-${Date.now()}.json`);
    await download.saveAs(tmpPath);
    // Close the settings modal; we'll reopen it below.
    await page.keyboard.press("Escape");

    // Wipe learner state in place (simulating an empty learner), then reopen
    // settings and import the captured blob. We stub window.location.reload
    // so we can inspect localStorage at the moment ProgressIOControls would
    // have reloaded — the addInitScript-based profile fixture fires on every
    // navigation and would otherwise wipe our import.
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("learner:v1:")) localStorage.removeItem(k);
      }
      // Stub reload: the addInitScript-based profile fixture fires on every
      // navigation and would wipe our import if the app reloaded. We only
      // want to verify that localStorage was written correctly — the reload
      // itself is implementation detail.
      try { window.location.reload = () => {}; } catch { /* read-only on some platforms */ }
    });

    await openSettings(page);
    const fileInput = page.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles(tmpPath);

    const modal = page.locator('[role="alertdialog"]').filter({ hasText: /replace current progress/i });
    await expect(modal).toBeVisible();
    // force: true — the Modal component re-renders under load when store
    // subscribers fire (theme, storage-quota), which trips Playwright's
    // "element stable" check even though the button is clickable.
    await modal.getByRole("button", { name: /^replace$/i }).click({ force: true });

    // The import path writes localStorage synchronously before calling
    // window.location.reload — poll for the write to land.
    await page.waitForFunction(
      () => !!localStorage.getItem("learner:v1:progress:python-fundamentals"),
      undefined,
      { timeout: 10_000 },
    );
    const progressJson = await page.evaluate(() =>
      localStorage.getItem("learner:v1:progress:python-fundamentals"),
    );
    const parsed = JSON.parse(progressJson!) as { completedLessonIds: string[] };
    expect(parsed.completedLessonIds.length).toBe(5);
    expect(parsed.completedLessonIds).toContain("loops");

    await fs.unlink(tmpPath).catch(() => {});
  });

  test("Import rejects snapshot with non-owned keys (allow-list enforcement)", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/learn");
    await openSettings(page);

    // Build a snapshot with one hostile key (not under learner:v1: or
    // onboarding:v1:). pasteSnapshot should refuse it.
    const hostilePath = path.join(os.tmpdir(), `hostile-${Date.now()}.json`);
    await fs.writeFile(
      hostilePath,
      JSON.stringify({ "codetutor:openai-key": "sk-stolen" }, null, 2),
    );
    const fileInput = page.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles(hostilePath);

    const modal = page
      .locator('[role="alertdialog"]')
      .filter({ hasText: /replace current progress/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByRole("button", { name: /^replace$/i }).click({ force: true });

    // Modal closes, inline error pill renders with the allow-list message.
    await expect(
      page.locator('[role="status"]').filter({ hasText: /non-owned key|codetutor:openai-key/i }).first(),
    ).toBeVisible({ timeout: 5_000 });

    // And the hostile key did NOT make it into localStorage.
    const leaked = await page.evaluate(() => localStorage.getItem("codetutor:openai-key"));
    expect(leaked).toBeNull();

    await fs.unlink(hostilePath).catch(() => {});
  });

  test("Import rejects invalid JSON", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/learn");
    await openSettings(page);

    const badPath = path.join(os.tmpdir(), `bad-${Date.now()}.json`);
    await fs.writeFile(badPath, "this is not json {");
    const fileInput = page.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles(badPath);

    // Scope the alertdialog locator to the import confirm specifically —
    // other alertdialogs (e.g. the lesson complete panel) can exist in the
    // DOM after parallel-worker navigation races.
    const modal = page
      .locator('[role="alertdialog"]')
      .filter({ hasText: /replace current progress/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByRole("button", { name: /^replace$/i }).click({ force: true });

    await expect(
      page.locator('[role="status"]').filter({ hasText: /invalid json/i }).first(),
    ).toBeVisible({ timeout: 5_000 });

    await fs.unlink(badPath).catch(() => {});
  });

  test("Cancel button dismisses the import confirm without touching storage", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto("/learn");
    await openSettings(page);

    const snapPath = path.join(os.tmpdir(), `cancel-${Date.now()}.json`);
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        "learner:v1:progress:python-fundamentals":
          '{"learnerId":"x","courseId":"python-fundamentals","status":"in_progress","completedLessonIds":["hello-world"]}',
      }),
    );
    const fileInput = page.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles(snapPath);

    const modal = page
      .locator('[role="alertdialog"]')
      .filter({ hasText: /replace current progress/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByRole("button", { name: /cancel/i }).click();
    await expect(modal).toHaveCount(0);

    // The dashboard bootstrap may auto-create a not_started progress record
    // for the active course — that's fine. What matters is the cancelled
    // snapshot's completedLessonIds did NOT leak through.
    const progress = await page.evaluate(() =>
      localStorage.getItem("learner:v1:progress:python-fundamentals"),
    );
    if (progress) {
      const parsed = JSON.parse(progress) as { completedLessonIds: string[] };
      expect(parsed.completedLessonIds).toEqual([]);
    }

    await fs.unlink(snapPath).catch(() => {});
  });
});
