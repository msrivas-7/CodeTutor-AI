// Phase A-Q: the completion layer preserves learner agency.
// Escape and "Keep practicing" dismiss only the celebration. The explicit
// "Next Lesson" action is the one route into signup / device handoff.

import { expect, test, type Page } from "@playwright/test";

const PATH = "/try/lesson/python-fundamentals/hello-world";

async function openCelebration(page: Page) {
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /run/i }).first().click();
  await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /check/i }).first().click();
  const celebration = page.getByRole("dialog", { name: /lesson complete/i });
  await expect(celebration).toBeVisible({ timeout: 10_000 });
  return celebration;
}

test.describe("Phase A-Q — celebration dismissal and continuation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      window.sessionStorage.setItem(
        "ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world",
        "1",
      );
    });
    await page.route("**/api/anon/run", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stdout: "Hello, Maya!\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 42,
        }),
      }),
    );
  });

  test("Escape dismisses the celebration without opening a signup wall", async ({ page }) => {
    await openCelebration(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toHaveCount(0);
    await expect(page.getByText(/Lesson 2 is queued up/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /run/i }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: /check/i }).first()).toBeEnabled();
  });

  test("Keep practicing has a distinct outcome from Next Lesson", async ({ page }) => {
    const celebration = await openCelebration(page);
    await celebration.getByRole("button", { name: /keep practicing/i }).click();
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toHaveCount(0);
    await expect(page.getByText(/Lesson 2 is queued up/i)).toHaveCount(0);

    const reopened = await openCelebration(page);
    await reopened.getByRole("button", { name: /next lesson/i }).click();
    await expect(page.getByText(/Lesson 2 is queued up/i)).toBeVisible();
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
});
