// Settings panel specs. Covers the tabbed modal reached from the UserMenu →
// Settings: Account (profile / sign-out / delete stub), AI (OpenAI key +
// persona), and Appearance (theme). Each test opens directly into the tab
// it's exercising so assertions can run without a second click.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { getWorkerUser } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import { markOnboardingDone, seedApiKey } from "../fixtures/profiles";
import * as S from "../utils/selectors";

async function openSettings(
  page: Page,
  tab?: "account" | "ai" | "appearance",
): Promise<void> {
  await S.openSettings(page, tab);
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.describe("settings panel", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("Theme toggle applies data-theme on <html> and persists pref", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "appearance");

    // Light — Phase 18b: theme persists through `preferences.theme` on the
    // server; the only user-visible effect we can assert here without racing
    // the PATCH is the <html data-theme> attribute. A later reload-persists
    // case is covered by cross-device.spec.ts.
    await page.getByRole("button", { name: /^light$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Dark
    await page.getByRole("button", { name: /^dark$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Close + reopen settings on Appearance — selected button should remain
    // aria-pressed=true.
    await page.keyboard.press("Escape");
    await openSettings(page, "appearance");
    await expect(page.getByRole("button", { name: /^dark$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Persona radio group updates aria-checked and blurb", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "ai");

    const beginner = page.getByRole("radio", { name: /^beginner$/i });
    const advanced = page.getByRole("radio", { name: /^advanced$/i });

    await beginner.click();
    await expect(beginner).toHaveAttribute("aria-checked", "true");
    await expect(advanced).toHaveAttribute("aria-checked", "false");
    // Descriptive blurb flips with the selection. Phase B rewrote the
    // blurbs in the tutor's first-person voice ("I'll explain…",
    // "Short and dense…").
    await expect(page.getByText(/explain things from the ground up/i)).toBeVisible();

    await advanced.click();
    await expect(advanced).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/short and dense/i)).toBeVisible();
  });

  test("Show / hide API key toggle flips the input type on the draft input", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "ai");

    // Phase 18e: the input is a local draft for a new key (the saved key
    // never leaves the server). Reveal flips the draft input's type.
    const keyInput = page.locator('input[placeholder="sk-…"]');
    await keyInput.fill("sk-test-visibility-padding-12345");
    await expect(keyInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: /^show api key$/i }).click();
    await expect(keyInput).toHaveAttribute("type", "text");
    await expect(keyInput).toHaveValue("sk-test-visibility-padding-12345");

    await page.getByRole("button", { name: /^hide api key$/i }).click();
    await expect(keyInput).toHaveAttribute("type", "password");
  });

  test("Save key → model picker loads → model change persists", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "ai");

    // Type a key and save — mockAllAI's validate returns {valid:true} and
    // models returns gpt-4o-mini + gpt-4o. The save button's accessible
    // name is "Validate and save API key" (dynamic aria-label).
    await page
      .locator('input[placeholder="sk-…"]')
      .fill("sk-valid-test-padding-1234567890");
    await page.getByRole("button", { name: /^validate and save api key$/i }).click();

    // Saved pill renders, then the Model picker appears.
    await expect(page.getByText(/● saved/i)).toBeVisible({ timeout: 5_000 });
    const modelSelect = page.getByRole("combobox", { name: /^model$/i });
    await expect(modelSelect).toBeVisible({ timeout: 5_000 });

    // Both mocked options should be there.
    await expect(modelSelect.locator("option")).toHaveCount(2);

    // Change selection — the <select> reflects the new value synchronously;
    // cross-device persistence is covered in cross-device.spec.ts.
    await modelSelect.selectOption("gpt-4o");
    await expect(modelSelect).toHaveValue("gpt-4o");
  });

  test("Invalid key surfaces the error and leaves the saved key untouched", async ({ page }) => {
    // Override the default validate-key mock with an invalid response BEFORE
    // navigating so the route is installed first.
    await page.route("**/api/ai/validate-key", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ valid: false, error: "bad key format" }),
      });
    });
    await page.goto("/");
    await openSettings(page, "ai");

    await page
      .locator('input[placeholder="sk-…"]')
      .fill("sk-nope-padding-1234567890abcdef");
    await page.getByRole("button", { name: /^validate and save api key$/i }).click();

    // Error blurb renders with the message from the mock.
    await expect(page.getByText(/× bad key format/i)).toBeVisible({ timeout: 5_000 });
    // `hasOpenaiKey` on the server remains false → no model picker, no
    // "key saved" status pill.
    await expect(page.getByText(/● saved|● key saved/i)).toHaveCount(0);
  });

  test("Remove API key is a two-step confirm (Cancel keeps, Remove wipes)", async ({ page }) => {
    await seedApiKey(page, { key: "sk-about-to-be-removed-padding-123" });
    await page.goto("/");
    await openSettings(page, "ai");

    // With a key saved server-side, the status pill reads "key saved" and
    // the Remove API key affordance is available.
    await expect(page.getByText(/● key saved/i)).toBeVisible();

    // First click — inline confirm pill appears with Remove + Cancel buttons.
    await page.getByRole("button", { name: /^remove api key$/i }).click();
    await expect(page.getByText(/also clears your tutor chat/i)).toBeVisible();

    // Cancel path — key stays put.
    await page
      .getByRole("button", { name: /^cancel$/i })
      .filter({ hasText: /^cancel$/i })
      .last()
      .click();
    await expect(page.getByText(/also clears your tutor chat/i)).toHaveCount(0);
    await expect(page.getByText(/● key saved/i)).toBeVisible();

    // Now actually remove it.
    await page.getByRole("button", { name: /^remove api key$/i }).click();
    await page
      .getByRole("button", { name: /^remove$/i })
      .filter({ hasText: /^remove$/i })
      .last()
      .click();

    // Server flips hasOpenaiKey → false. The status pill drops to "no key
    // saved" and the Remove affordance is hidden.
    await expect(page.getByText(/no key saved/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^remove api key$/i })).toHaveCount(0);
  });

  test("Danger zone → Delete account modal gates the button on email match", async ({ page }, testInfo) => {
    // Phase 20-P0 #9: the Danger Zone button opens a destructive confirm
    // modal. The Delete button only enables when the typed email matches the
    // logged-in user's email — we intercept the DELETE request and assert
    // the request body carries the confirm email, without ever letting the
    // delete hit the server (that would invalidate the worker's cached
    // session for the rest of the run).
    const user = await getWorkerUser(testInfo.workerIndex);
    let deleteHit = false;
    let capturedBody: unknown = null;
    await page.route("**/api/user/account", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteHit = true;
        capturedBody = route.request().postDataJSON();
        // Fulfill without 200 so signOut doesn't actually run; we assert the
        // request shape but leave the client on the settings page.
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "blocked in test" }),
        });
      }
      return route.continue();
    });

    await page.goto("/");
    await openSettings(page, "account");

    const openDelete = page.getByRole("button", { name: /^delete account$/i });
    await openDelete.click();

    // Modal opens as an alertdialog.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    const confirmInput = dialog.getByRole("textbox", { name: /confirm email/i });
    const submit = dialog.getByRole("button", { name: /^delete account$/i });
    await expect(submit).toBeDisabled();

    // Wrong email keeps the destructive button disabled.
    await confirmInput.fill("wrong@codetutor.test");
    await expect(submit).toBeDisabled();

    // Correct email (case-insensitive per handleDelete + server) enables it.
    await confirmInput.fill(user.email.toUpperCase());
    await expect(submit).toBeEnabled();

    // Cancel closes the modal without touching the API.
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toHaveCount(0);
    expect(deleteHit).toBe(false);

    // Re-open and actually submit to verify the request body.
    await openDelete.click();
    const dialog2 = page.getByRole("alertdialog");
    await dialog2.getByRole("textbox", { name: /confirm email/i }).fill(user.email);
    await dialog2.getByRole("button", { name: /^delete account$/i }).click();
    await expect.poll(() => deleteHit).toBe(true);
    expect((capturedBody as { confirmEmail: string }).confirmEmail).toBe(user.email);
  });

  test("Modal traps Tab focus inside the panel (Phase 20-P1)", async ({ page }) => {
    // Phase 20-P1: Modal.tsx cycles Tab/Shift+Tab back to the first/last
    // focusable element inside the panel. Without the trap, pressing Tab at
    // the last button would move focus into the page behind (close button in
    // the header, UserMenu avatar, etc.) — a WCAG failure and a confusing
    // UX because the overlay swallows clicks but not keystrokes.
    await page.goto("/");
    await openSettings(page, "appearance");

    // Collect the focusable buttons/inputs inside the dialog. "Appearance" is
    // the lightest tab (three theme buttons + tab nav + close), so we can
    // reason about a small finite list.
    const dialog = page.locator('[role="dialog"]');
    const focusables = dialog.locator(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const count = await focusables.count();
    expect(count).toBeGreaterThan(2);

    // Tab from the last focusable must wrap to the first — not escape to
    // page-level elements behind the overlay.
    await focusables.nth(count - 1).focus();
    await page.keyboard.press("Tab");
    // Whatever is focused after the wrap must still be inside the dialog.
    const stillInside = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('[role="dialog"]');
      return !!(active && dlg && dlg.contains(active));
    });
    expect(stillInside).toBe(true);

    // Shift+Tab from the first focusable must wrap to the last.
    await focusables.first().focus();
    await page.keyboard.press("Shift+Tab");
    const stillInsideBack = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('[role="dialog"]');
      return !!(active && dlg && dlg.contains(active));
    });
    expect(stillInsideBack).toBe(true);
  });

  test("'Show intro again' resets onboarding flags, closes modal, and replays the first-run cinematic", async ({ page }) => {
    // Post-first-run-cinematic: Settings → Account → Guided tour lets a
    // re-visiting user replay the opening credits. Clicking the button
    // PATCHes welcomeDone back to false and navigates to / — where
    // StartPage now redirects to /welcome (the cinematic route) instead
    // of remounting the old 3-step spotlight overlay.
    await page.goto("/learn");
    await openSettings(page, "account");
    await page.getByRole("button", { name: /^show intro again$/i }).click();

    // Modal closes; redirect chain ends at /welcome with the cinematic
    // rendering. The Skip link is the stable assertion point — the
    // typewriter text is mid-animation and locator-unfriendly.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(
      page.getByRole("button", { name: /skip introduction/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Server-side persistence: reload and the cinematic is still the
    // first thing the user sees — proves the PATCH actually landed on
    // the server, not just an optimistic client flip.
    await page.reload();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(
      page.getByRole("button", { name: /skip introduction/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Escape closes the settings modal cleanly", async ({ page }) => {
    await seedApiKey(page, { key: "sk-escape-test-padding-1234567890" });
    await page.goto("/");
    await openSettings(page, "ai");

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Reopening on AI shows the same "key saved" status — server state
    // survives the close.
    await openSettings(page, "ai");
    await expect(page.getByText(/● key saved/i)).toBeVisible();
  });
});
