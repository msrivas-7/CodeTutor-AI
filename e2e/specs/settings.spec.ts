// Settings panel specs. Phase 24A redesign: three tabs — Profile (name +
// theme + sign-out), Tutor (BYOK status card + persona), Account (email
// notifications + replay intro + data export + paid-interest recovery +
// delete account). Each test opens directly into the tab it's exercising
// so assertions can run without a second click.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { getWorkerUser } from "../fixtures/auth";

import { mockAllAI } from "../fixtures/aiMocks";
import {
  loadProfile,
  markOnboardingDone,
  seedApiKey,
} from "../fixtures/profiles";
import * as S from "../utils/selectors";

async function openSettings(
  page: Page,
  tab?: "profile" | "tutor" | "account",
): Promise<void> {
  await S.openSettings(page, tab);
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

test.describe("settings panel", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
    await loadProfile(page, "empty");
  });

  test("phone Start header and Settings controls keep safe spacing and touch targets", async ({
    page,
  }) => {
    await page.route("**/api/user/streak", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current: 3,
          longest: 5,
          lastActiveDate: "2026-08-08",
          lastFreezeUsed: null,
          isActiveToday: true,
          isAtRisk: false,
          resetAtUtc: "2026-08-09T00:00:00.000Z",
          freezeActive: false,
          wasFirstToday: false,
          freezeUsedToday: false,
        }),
      });
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/start");

    const wordmark = page.getByText("CodeTutor AI", { exact: true });
    const userMenu = page.getByRole("button", { name: /user menu/i });
    const wordmarkBox = await wordmark.boundingBox();
    const userMenuBox = await userMenu.boundingBox();
    expect(wordmarkBox).not.toBeNull();
    expect(userMenuBox).not.toBeNull();
    expect(wordmarkBox!.y, "wordmark clears the utility header").toBeGreaterThanOrEqual(
      userMenuBox!.y + userMenuBox!.height + 12,
    );
    await expect(page.getByTestId("ambient-glyph-field")).toBeHidden();

    // The desktop Start layout uses the same absolute utility band, but the
    // centered hero must still reserve its vertical space. UX-115 originally
    // reproduced at this common laptop viewport even after the phone header
    // had enough separation.
    await page.setViewportSize({ width: 1280, height: 720 });
    const desktopWordmarkBox = await wordmark.boundingBox();
    const streakBox = await page
      .getByRole("button", { name: /day streak/i })
      .boundingBox();
    expect(desktopWordmarkBox).not.toBeNull();
    expect(streakBox).not.toBeNull();
    expect(
      desktopWordmarkBox!.y,
      "desktop wordmark clears the centered streak control",
    ).toBeGreaterThanOrEqual(streakBox!.y + streakBox!.height + 12);

    // Native Safari may leave `window.resize` silent when application
    // fullscreen exits via Escape, while visualViewport still reports the
    // reflow. The anchored portal must close on that browser-owned resize.
    const streakControl = page.getByRole("button", { name: /day streak/i });
    await streakControl.click();
    await expect(page.getByRole("dialog", { name: "Streak details" })).toBeVisible();
    await page.evaluate(() => {
      window.visualViewport?.dispatchEvent(new Event("resize"));
    });
    await expect(page.getByRole("dialog", { name: "Streak details" })).toHaveCount(0);

    await page.setViewportSize({ width: 360, height: 800 });

    await userMenu.click();
    await page.getByRole("menuitem", { name: /^settings$/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const buttons = dialog.getByRole("button");
    for (let i = 0; i < await buttons.count(); i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;
      const name = (await button.getAttribute("aria-label")) ?? (await button.innerText());
      await expect
        .poll(async () => (await button.boundingBox())?.height ?? 0, {
          message: `${name} touch target height after the entrance transition`,
        })
        .toBeGreaterThanOrEqual(44);
      await expect
        .poll(async () => (await button.boundingBox())?.width ?? 0, {
          message: `${name} touch target width after the entrance transition`,
        })
        .toBeGreaterThanOrEqual(44);
    }
    for (const field of [
      dialog.getByLabel("First name", { exact: true }),
      dialog.getByLabel(/last name/i),
    ]) {
      await expect
        .poll(async () => (await field.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
    }
    expect(
      await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      "settings horizontal overflow",
    ).toBeLessThanOrEqual(1);

    await dialog.getByRole("button", { name: "Account" }).click();
    const switches = dialog.getByRole("switch");
    await expect(switches).toHaveCount(2);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    for (let i = 0; i < await switches.count(); i += 1) {
      const control = switches.nth(i);
      const name = await control.getAttribute("aria-label");
      const box = await control.boundingBox();
      expect(box, `${name} geometry`).not.toBeNull();
      expect(box!.height, `${name} touch target height`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${name} touch target width`).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width, `${name} stays inside Settings`).toBeLessThanOrEqual(
        dialogBox!.x + dialogBox!.width,
      );
    }
    expect(
      await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
      "Account settings horizontal overflow",
    ).toBeLessThanOrEqual(1);
  });

  test("data export downloads a named JSON file and announces the exact filename", async ({
    page,
  }) => {
    await page.goto("/start");
    await openSettings(page, "account");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /download my data/i }).click(),
    ]);
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^codetutor-export-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByRole("status")).toHaveText(`Downloaded ${filename}`);
    expect(await download.path()).not.toBeNull();
  });

  test("paid-plan dismissal survives Settings reopen and reload for this session", async ({
    page,
  }) => {
    await page.goto("/start");
    await openSettings(page, "account");

    const paidInterest = page.getByRole("region", { name: "Paid plan interest" });
    await expect(paidInterest).toBeVisible();
    await page.getByRole("button", { name: "Dismiss for now" }).click();
    await expect(paidInterest).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Account" })).toBeFocused();

    await page.keyboard.press("Escape");
    await openSettings(page, "account");
    await expect(paidInterest).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.reload();
    await openSettings(page, "account");
    await expect(paidInterest).toHaveCount(0);
  });

  test("hiding streaks turns email nudges off without silently restoring them", async ({
    page,
  }) => {
    await page.goto("/start");
    await openSettings(page, "account");

    const nudgeSwitch = page.getByRole("switch", {
      name: "Toggle streak nudge emails",
    });
    const hideSwitch = page.getByRole("switch", { name: "Toggle hide streaks" });
    await expect(nudgeSwitch).toBeChecked();
    await expect(hideSwitch).not.toBeChecked();

    await hideSwitch.click();
    await expect(hideSwitch).toBeChecked();
    await expect(nudgeSwitch).not.toBeChecked();
    await expect(nudgeSwitch).toBeDisabled();
    await expect(page.getByText(/off while streaks are hidden/i)).toBeVisible();

    await hideSwitch.click();
    await expect(hideSwitch).not.toBeChecked();
    await expect(nudgeSwitch).toBeEnabled();
    await expect(nudgeSwitch).not.toBeChecked();
  });

  test("Theme toggle applies data-theme on <html> and persists pref", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/start");
    await openSettings(page, "profile");

    const glyphField = page.getByTestId("ambient-glyph-field");
    const glyphTokens = glyphField.locator("[data-glyph-token]");

    // Light — Phase 18b: theme persists through `preferences.theme` on the
    // server; the only user-visible effect we can assert here without racing
    // the PATCH is the <html data-theme> attribute. A later reload-persists
    // case is covered by cross-device.spec.ts.
    await page.getByRole("button", { name: /^light$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(glyphField).toBeHidden();

    // Dark
    await page.getByRole("button", { name: /^dark$/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(glyphField).toBeVisible();
    await expect(glyphTokens).toHaveCount(4);
    for (let i = 0; i < await glyphTokens.count(); i += 1) {
      expect((await glyphTokens.nth(i).innerText()).trim().length).toBeGreaterThanOrEqual(2);
    }

    // Close + reopen settings on Appearance — selected button should remain
    // aria-pressed=true.
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() => {
        const tokens = Array.from(
          document.querySelectorAll<HTMLElement>("[data-glyph-token]"),
        )
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => element.getBoundingClientRect());
        const content = Array.from(
          document.querySelectorAll<HTMLElement>("h1,h2,p,button,footer"),
        )
          .filter((element) => getComputedStyle(element).display !== "none")
          .map((element) => element.getBoundingClientRect());
        return tokens.filter((token) =>
          content.some(
            (rect) =>
              token.left < rect.right &&
              token.right > rect.left &&
              token.top < rect.bottom &&
              token.bottom > rect.top,
          ),
        ).length;
      }),
      "dark-theme code tokens stay out of meaningful Start content",
    ).toBe(0);

    await page.setViewportSize({ width: 900, height: 720 });
    for (let i = 0; i < await glyphTokens.count(); i += 1) {
      await expect(glyphTokens.nth(i)).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await openSettings(page, "profile");
    await expect(page.getByRole("button", { name: /^dark$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Persona radio group updates aria-checked and blurb", async ({ page }) => {
    await page.goto("/start");
    await openSettings(page, "tutor");

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
    await page.goto("/start");
    await openSettings(page, "tutor");

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
    await page.goto("/start");
    await openSettings(page, "tutor");

    // Type a key and save — mockAllAI's validate returns {valid:true} and
    // models returns one evaluated model plus two honest unevaluated options.
    // The save button's accessible
    // name is "Validate and save API key" (dynamic aria-label).
    await page
      .locator('input[placeholder="sk-…"]')
      .fill("sk-valid-test-padding-1234567890");
    await page.getByRole("button", { name: /^validate and save api key$/i }).click();

    // Saved pill renders, then the Model picker appears.
    await expect(page.getByText(/● saved/i)).toBeVisible({ timeout: 10_000 });
    const modelSelect = page.getByRole("combobox", { name: /^model$/i });
    await expect(modelSelect).toBeVisible({ timeout: 10_000 });

    await expect(modelSelect.locator("option")).toHaveCount(3);
    await expect(modelSelect.locator("option").nth(0)).toHaveText(
      "GPT-4.1 nano — evaluated",
    );
    await expect(modelSelect.locator("option").nth(1)).toHaveText(
      "GPT-4o mini — not evaluated",
    );
    await expect(page.getByText(/evaluated for codetutor/i)).toBeVisible();

    // Change selection — the <select> reflects the new value synchronously;
    // cross-device persistence is covered in cross-device.spec.ts.
    await modelSelect.selectOption("gpt-4o");
    await expect(modelSelect).toHaveValue("gpt-4o");
    await expect(
      page.getByText(/not evaluated for teaching quality.*contextual lesson guidance is disabled/i),
    ).toBeVisible();
  });

  test("Model quality labels remain readable at 390px", async ({ page }) => {
    await seedApiKey(page, {
      key: "sk-quality-label-padding-1234567890",
      model: "gpt-4.1-nano",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/start");
    await openSettings(page, "tutor");

    const dialog = page.locator('[role="dialog"]');
    const modelSelect = page.getByRole("combobox", { name: /^model$/i });
    await expect(modelSelect).toBeVisible();
    await expect(page.getByText(/evaluated for codetutor/i)).toBeVisible();
    await expect(modelSelect.locator("option").nth(1)).toHaveText(
      "GPT-4o mini — not evaluated",
    );
    const overflow = await dialog.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
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
    await page.goto("/start");
    await openSettings(page, "tutor");

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
    await page.goto("/start");
    await openSettings(page, "tutor");

    // Phase 24A: with a key saved, the BYOK status card header reads
    // "Connected" (green badge) and the Remove API key affordance is
    // available.
    await expect(page.getByText(/^connected$/i)).toBeVisible();

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
    await expect(page.getByText(/^connected$/i)).toBeVisible();

    // Now actually remove it.
    await page.getByRole("button", { name: /^remove api key$/i }).click();
    await page
      .getByRole("button", { name: /^remove$/i })
      .filter({ hasText: /^remove$/i })
      .last()
      .click();

    // Server flips hasOpenaiKey → false. The status badge drops to
    // "Not set up yet" and the Remove affordance is hidden.
    await expect(page.getByText(/not set up yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^remove api key$/i })).toHaveCount(0);
  });

  // Phase 24A: tab structure + BYOK status card coverage.
  // Phase 25: admin tab removed from Settings entirely (moved to /admin route).
  test("Tab structure: Profile, Tutor, Account only; Admin tab fully removed", async ({ page }) => {
    await page.goto("/start");
    await S.openSettings(page);
    const sidenav = page.locator('nav[aria-label="Settings sections"]');
    await expect(sidenav.getByRole("button", { name: /^profile$/i })).toBeVisible();
    await expect(sidenav.getByRole("button", { name: /^tutor$/i })).toBeVisible();
    await expect(sidenav.getByRole("button", { name: /^account$/i })).toBeVisible();
    // Phase 25: Admin tab removed for ALL users (not just non-admins).
    // Admin operators access controls via /admin (link in UserMenu).
    await expect(sidenav.getByRole("button", { name: /^admin$/i })).toHaveCount(0);
    // Old labels are gone.
    await expect(sidenav.getByRole("button", { name: /^ai$/i })).toHaveCount(0);
    await expect(sidenav.getByRole("button", { name: /^appearance$/i })).toHaveCount(0);
    await expect(sidenav.getByRole("button", { name: /^data$/i })).toHaveCount(0);
  });

  test("BYOK card empty state: 'Not set up yet' + Get-a-key link + trust copy", async ({ page }) => {
    // No seedApiKey — the user lands on Tutor with the empty state.
    await page.goto("/start");
    await openSettings(page, "tutor");

    await expect(page.getByText(/not set up yet/i)).toBeVisible();
    const getKeyLink = page.getByRole("link", { name: /get a key from openai/i });
    await expect(getKeyLink).toBeVisible();
    await expect(getKeyLink).toHaveAttribute(
      "href",
      "https://platform.openai.com/api-keys",
    );
    await expect(getKeyLink).toHaveAttribute("target", "_blank");
    // Trust + cost copy is anchored under the input — a beginner reads it
    // in the same glance as the field they're filling.
    await expect(
      page.getByText(
        /tutor requests use your openai account instead of codetutor's included allowance/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/typical cost: a few cents per hour/i),
    ).toBeVisible();
  });

  test("BYOK card connected state: 'Connected' badge + Replace key disclosure", async ({ page }) => {
    await seedApiKey(page, { key: "sk-already-saved-padding-1234567890" });
    await page.goto("/start");
    await openSettings(page, "tutor");

    // Connected → badge visible, the bare input is hidden behind a
    // "Replace key" disclosure (so the connected user is not invited to
    // fiddle with their key without intent).
    await expect(page.getByText(/^connected$/i)).toBeVisible();
    await expect(page.locator('input[placeholder*="enter a new key"]')).toHaveCount(0);

    // Click Replace key — the input form expands.
    await page.getByRole("button", { name: /^replace key$/i }).click();
    const replaceInput = page.locator('input[placeholder*="enter a new key"]');
    await expect(replaceInput).toBeVisible();

    // Cancel collapses it back. The connected badge stays put.
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(replaceInput).toHaveCount(0);
    await expect(page.getByText(/^connected$/i)).toBeVisible();
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

    await page.goto("/start");
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

  // Phase 23 P0 #1: account-delete recent-auth gate.
  test("Delete account: REAUTH_REQUIRED pivots the modal to a sign-out-to-continue prompt", async ({ page }, testInfo) => {
    // Backend rejects a stale JWT with 428 {error:"REAUTH_REQUIRED"}. The
    // modal must pivot to a "Sign out and continue" prompt — same UX for
    // every auth method (password, Google, GitHub, future). We mock the
    // 428 here and assert the modal swap; we DO NOT actually click the
    // sign-out button because that would tear down the worker's Supabase
    // session for the rest of the suite. The button itself is unit-style
    // verified by checking it's visible + enabled.
    const user = await getWorkerUser(testInfo.workerIndex);
    let deleteCalls = 0;
    await page.route("**/api/user/account", async (route) => {
      if (route.request().method() !== "DELETE") {
        return route.continue();
      }
      deleteCalls += 1;
      return route.fulfill({
        status: 428,
        contentType: "application/json",
        body: JSON.stringify({ error: "REAUTH_REQUIRED", reason: "stale_jwt" }),
      });
    });

    await page.goto("/start");
    await openSettings(page, "account");

    const openDelete = page.getByRole("button", { name: /^delete account$/i });
    await openDelete.click();

    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("textbox", { name: /confirm email/i }).fill(user.email);
    await dialog.getByRole("button", { name: /^delete account$/i }).click();

    // Wait for the first 428 to land, then assert the modal pivoted: new
    // heading, copy explaining the sign-out-and-back-in flow, and a
    // visible "Sign out and continue" button. Original Delete-account
    // submit is gone.
    await expect.poll(() => deleteCalls).toBe(1);
    await expect(
      dialog.getByRole("heading", { name: /sign in again to confirm/i }),
    ).toBeVisible();
    await expect(
      dialog.getByText(/settings.*account/i).first(),
    ).toBeVisible();
    const signOutBtn = dialog.getByRole("button", {
      name: /^sign out and continue$/i,
    });
    await expect(signOutBtn).toBeVisible();
    await expect(signOutBtn).toBeEnabled();
    // The original destructive submit is gone (the modal is in reauth
    // mode, not confirm mode).
    await expect(
      dialog.getByRole("button", { name: /^delete account$/i }),
    ).toHaveCount(0);
  });

  test("Modal traps Tab focus inside the panel (Phase 20-P1)", async ({ page }) => {
    // Phase 20-P1: Modal.tsx cycles Tab/Shift+Tab back to the first/last
    // focusable element inside the panel. Without the trap, pressing Tab at
    // the last button would move focus into the page behind (close button in
    // the header, UserMenu avatar, etc.) — a WCAG failure and a confusing
    // UX because the overlay swallows clicks but not keystrokes.
    await page.goto("/start");
    await openSettings(page, "profile");

    // Collect the focusable buttons/inputs inside the dialog. Profile holds
    // a small finite list (name inputs, theme picker, sign out, tab nav,
    // close), enough to verify the trap.
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

  test("'Watch the moment again' preserves onboarding state and replays the cinematic", async ({ page }) => {
    // Replay is deliberately read-only. It uses an explicit query route
    // instead of resetting welcomeDone and entering the destructive true
    // first-run handoff.
    const destructivePreferenceWrites: unknown[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "PATCH" ||
        !request.url().includes("/api/user/preferences")
      ) return;
      try {
        const body = request.postDataJSON() as { welcomeDone?: unknown };
        if (body.welcomeDone === false) destructivePreferenceWrites.push(body);
      } catch {
        // A non-JSON request cannot be the preferences contract under test.
      }
    });

    await page.goto("/learn");
    await openSettings(page, "account");
    await page.getByRole("button", { name: /^watch the moment again$/i }).click();

    // Modal closes and the explicit replay route renders the cinematic. The
    // Skip control is stable while the typewriter text is mid-animation.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/welcome\?replay=1$/);
    await expect(
      page.getByRole("button", { name: /skip introduction/i }),
    ).toBeVisible({ timeout: 5_000 });
    expect(destructivePreferenceWrites).toHaveLength(0);

    // Reload remains an explicit replay, and Skip returns the existing
    // learner to Start instead of seeding lesson-one first-run state.
    await page.reload();
    await expect(page).toHaveURL(/\/welcome\?replay=1$/);
    const skipIntroduction = page.getByRole("button", {
      name: /skip introduction/i,
    });
    await expect(skipIntroduction).toBeVisible({ timeout: 5_000 });
    await skipIntroduction.click();
    await expect(page).toHaveURL(/\/start$/);
    expect(destructivePreferenceWrites).toHaveLength(0);
  });

  test("Escape closes the settings modal cleanly", async ({ page }) => {
    await seedApiKey(page, { key: "sk-escape-test-padding-1234567890" });
    await page.goto("/start");
    await openSettings(page, "tutor");

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Reopening shows the same Connected badge — server state survives the close.
    await openSettings(page, "tutor");
    await expect(page.getByText(/^connected$/i)).toBeVisible();
  });

  test("Phase 22B: profile name save with first-only and with optional last", async ({
    page,
  }) => {
    // Capture both Supabase updateUser PATCH bodies so the test asserts the
    // exact metadata shape — `last_name` MUST only appear when the user
    // typed something. Empty input must be omitted (preserve any legacy
    // last_name on the account), not sent as "".
    const patchBodies: Array<Record<string, unknown>> = [];
    const worker = await getWorkerUser(test.info().workerIndex);
    let mockedUser = worker.session.user;
    await page.route("**/auth/v1/user**", async (route) => {
      if (route.request().method() === "PUT") {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(route.request().postData() ?? "{}");
          patchBodies.push(body);
        } catch {
          patchBodies.push({});
        }
        const data = (body.data ?? {}) as Record<string, unknown>;
        mockedUser = {
          ...mockedUser,
          user_metadata: { ...mockedUser.user_metadata, ...data },
          updated_at: new Date().toISOString(),
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: mockedUser }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/start");
    await openSettings(page, "profile");

    // Round 1: edit firstName only, leave lastName empty. The save should
    // succeed (lastName is optional) and the PATCH `data` block should
    // contain ONLY first_name — no last_name key whatsoever.
    const firstInput = page.getByLabel(/^first name$/i);
    await firstInput.fill("Round1Name");
    const lastInput = page.getByLabel(/last name/i);
    await lastInput.fill(""); // ensure empty
    const save = page.getByRole("button", { name: /^save$/i });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(/changes saved/i)).toBeVisible({ timeout: 5_000 });

    // Round 2: now type a lastName and save again. PATCH should include
    // BOTH first_name and last_name.
    await firstInput.fill("Round2Name");
    await lastInput.fill("Lovelace");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(/changes saved/i)).toBeVisible({ timeout: 5_000 });

    // Inspect the captured PATCH bodies. Two saves → two bodies.
    expect(patchBodies.length).toBeGreaterThanOrEqual(2);
    const round1 = patchBodies[patchBodies.length - 2]?.data as
      | Record<string, unknown>
      | undefined;
    const round2 = patchBodies[patchBodies.length - 1]?.data as
      | Record<string, unknown>
      | undefined;
    expect(round1).toMatchObject({ first_name: "Round1Name" });
    expect(round1).not.toHaveProperty("last_name");
    expect(round2).toMatchObject({
      first_name: "Round2Name",
      last_name: "Lovelace",
    });
  });
});
