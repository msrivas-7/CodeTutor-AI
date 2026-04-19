// Editor-mode end-to-end specs. Exercises the non-lesson workspace at /editor:
// run code, edit + re-run, stdin piping, language-switch confirm modal, output
// tabs, session resilience. All network access hits the real Docker backend —
// only AI is mocked (tutor panel renders on this page but we don't drive it).

import { expect, test } from "@playwright/test";

import { mockAllAI } from "../fixtures/aiMocks";
import { getMonacoValue, setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import * as S from "../utils/selectors";
import { expectDurationBadgeVisible, expectStdoutContains } from "../utils/assertions";

test.describe("editor", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await loadProfile(page, "empty");
    // Skip the EditorCoach spotlight tour — its fixed-inset backdrop would
    // otherwise intercept every click in these specs. A dedicated onboarding
    // spec exercises the tour separately.
    await markOnboardingDone(page);
  });

  test("cold load renders Python starter", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    const value = await getMonacoValue(page);
    expect(value.length, "starter should be non-empty").toBeGreaterThan(0);
    // Default starter is Python — should mention print or comment.
    expect(value).toMatch(/print|#/);
  });

  test("run default starter produces stdout + duration badge", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    // Wait for session to be active before clicking Run. Session creation is
    // async — the Run button is disabled until phase === "active".
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });
    await S.runButton(page).click();
    await expectDurationBadgeVisible(page);
  });

  test("edit + re-run updates output", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, 'print("apple")\n');
    await S.runButton(page).click();
    await expectStdoutContains(page, "apple");

    await setMonacoValue(page, 'print(1 + 2)\n');
    await S.runButton(page).click();
    await expectStdoutContains(page, "3");
  });

  test("stdin tab pipes input to the program", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    // Switch to stdin tab, type input, switch back, run a program that reads 2 lines.
    await S.stdinTab(page).click();
    const stdinBox = page.locator("#output-panel-body");
    await stdinBox.click();
    await stdinBox.fill("hello\nworld");
    // Back to combined output so we can assert on stdout.
    await S.outputTab(page).click();

    await setMonacoValue(page, "a = input()\nb = input()\nprint(a + ' and ' + b)\n");
    await S.runButton(page).click();
    await expectStdoutContains(page, "hello and world");
  });

  test("language switch shows confirm modal + cancel preserves code", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, "print('keep me')\n");
    const pyValue = await getMonacoValue(page);

    await S.languagePicker(page).selectOption("javascript");
    // Modal appears — "Switch to JavaScript?"
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // Code preserved — still the Python snippet.
    const after = await getMonacoValue(page);
    expect(after).toBe(pyValue);
    // Language select snapped back to python (visible in the <select>).
    await expect(S.languagePicker(page)).toHaveValue("python");
  });

  test("language switch → confirm replaces code with new starter", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, "print('throwaway')\n");

    await S.languagePicker(page).selectOption("javascript");
    await expect(page.locator('[role="alertdialog"]')).toBeVisible();
    await page.getByRole("button", { name: /^switch$/i }).click();
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // Monaco should now hold the JS starter — no Python print left.
    await waitForMonacoReady(page);
    const after = await getMonacoValue(page);
    expect(after).not.toContain("throwaway");
    expect(after.length).toBeGreaterThan(0);
    await expect(S.languagePicker(page)).toHaveValue("javascript");
  });

  test("run twice in a row replaces output, not appends", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, "print('first')\n");
    await S.runButton(page).click();
    await expectStdoutContains(page, "first");

    await setMonacoValue(page, "print('second')\n");
    await S.runButton(page).click();
    await expectStdoutContains(page, "second");

    // Output panel body should contain "second" but NOT "first" (replacement).
    const text = await page.locator("#output-panel-body").innerText();
    expect(text).toContain("second");
    expect(text).not.toContain("first");
  });

  test("output panel exit code + duration render in status row", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);
    await expect(S.runButton(page)).toBeEnabled({ timeout: 30_000 });

    await setMonacoValue(page, 'print("hi")\n');
    await S.runButton(page).click();
    await expectStdoutContains(page, "hi");

    // Status row shows: "exit 0 · <n>ms · <stage>". Match the "exit 0" + "ms" parts.
    await expect(page.getByText(/exit\s*0/i).first()).toBeVisible();
    await expect(page.getByText(/\b\d+\s*ms\b/).first()).toBeVisible();
  });

  test("SettingsButton opens the Settings modal", async ({ page }) => {
    await page.goto("/editor");
    await waitForMonacoReady(page);

    await S.settingsButton(page).first().click();
    // SettingsModal has no accessible name (no aria-labelledby) so use the
    // raw role attribute instead of getByRole, which needs an accessible name.
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.getByText(/openai api key/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
