// Domain assertions. Specs should read at a high level; the gritty locator
// wait/expect combinations live here. Each helper is an awaitable that throws
// a Playwright AssertionError on failure (same machinery as `expect(...)`).

import { expect, type Page } from "@playwright/test";

import * as S from "./selectors";

// Waits for the output panel to contain `expected`. Covers the "run code →
// stdout shows up" flow.
export async function expectStdoutContains(page: Page, expected: string | RegExp): Promise<void> {
  await expect(S.outputPanel(page)).toContainText(expected, { timeout: 20_000 });
}

// Duration badge ("123ms") should render after a successful run. Guards
// against regressions where the badge vanishes on re-run.
export async function expectDurationBadgeVisible(page: Page): Promise<void> {
  await expect(page.locator("text=/\\b\\d+\\s*ms\\b/").first()).toBeVisible({ timeout: 20_000 });
}

// Waits for LessonCompletePanel. Used after Check My Work succeeds.
export async function expectLessonComplete(page: Page): Promise<void> {
  await expect(S.lessonCompletePanel(page)).toBeVisible({ timeout: 15_000 });
}

// Waits for FailedTestCallout or the generic validation-failed banner.
export async function expectCheckFailed(page: Page): Promise<void> {
  await expect(
    page
      .locator('[role="status"], [role="alert"]')
      .filter({ hasText: /failed|not quite|try again|doesn'?t match/i })
      .first()
  ).toBeVisible({ timeout: 15_000 });
}

// Waits for the tutor response surface — either the section cards or the raw
// streamed text. Mocked responses typically complete within 200ms; real
// responses can take several seconds.
export async function expectTutorResponse(
  page: Page,
  match: string | RegExp,
  timeout = 20_000
): Promise<void> {
  await expect(page.locator('[data-tutor-response], main, [role="log"]').getByText(match).first()).toBeVisible({
    timeout,
  });
}

// True Monaco-readiness check. The `.monaco-editor` div renders during
// loading too, so presence alone isn't enough — we wait for at least one
// model on `window.monaco` which @monaco-editor/react registers once the
// editor has fully mounted.
export async function expectMonacoReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { monaco?: { editor: { getModels(): Array<unknown> } } };
      return (w.monaco?.editor.getModels?.()?.length ?? 0) > 0;
    },
    undefined,
    { timeout: 15_000 },
  );
}

// Asserts a modal with a given title is present (by accessible title or
// heading text). Works for both <div role="dialog"> and alertdialog variants.
export async function expectModal(page: Page, title: string | RegExp): Promise<void> {
  await expect(page.locator('[role="dialog"], [role="alertdialog"]').filter({ hasText: title }).first()).toBeVisible({
    timeout: 5_000,
  });
}

export async function expectNoModal(page: Page): Promise<void> {
  await expect(page.locator('[role="dialog"], [role="alertdialog"]').first()).toHaveCount(0, { timeout: 2_000 });
}

// Reads a named localStorage key (or returns null). Useful for verifying
// allow-list behavior after a dev-profile swap or progress import.
export async function readLS(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

// Lists all localStorage keys matching a prefix.
export async function listLSPrefix(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate((p) => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(p)) out.push(k);
    }
    return out;
  }, prefix);
}
