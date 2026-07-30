// Phase A-Q cross-browser release gate.
//
// Chromium runs the exhaustive suite and owns screenshot baselines. This
// focused journey protects the highest-value experience in Firefox and
// WebKit (the engine used by Safari): public discovery, anonymous lesson,
// retrieval, completion, stacked sharing, conversion, and phone layout.

import { expect, test, type Page } from "@playwright/test";
import { waitForMonacoReady } from "../fixtures/monaco";

const LESSON_PATH = "/try/lesson/python-fundamentals/hello-world";
const RETRIEVAL_KEY =
  "ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world";

function seedFirstRun(page: Page, retrievalPassed: boolean) {
  return page.addInitScript(
    ({ key, passed }) => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      if (passed) window.sessionStorage.setItem(key, "1");
      else window.sessionStorage.removeItem(key);
    },
    { key: RETRIEVAL_KEY, passed: retrievalPassed },
  );
}

async function mockSuccessfulRun(page: Page) {
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
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function openLesson(page: Page) {
  await page.goto(LESSON_PATH);
  await waitForMonacoReady(page);
  await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible();
}

test.describe("Phase A-Q — Firefox and WebKit critical journey", () => {
  test("desktop discovery reaches a usable share artifact and signup", async ({ page }) => {
    await seedFirstRun(page, true);
    await mockSuccessfulRun(page);
    await page.route("**/api/anon/shares", async (route) => {
      const payload = route.request().postDataJSON() as {
        attemptCount: number;
        codeSnippet: string;
        mastery: string;
      };
      expect(payload.attemptCount).toBeGreaterThanOrEqual(1);
      expect(payload.codeSnippet).toContain("Hello, Maya!");
      expect(payload.mastery).toMatch(/strong|okay|shaky/);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          shareToken: "crossbrowser-quality",
          url: "/s/crossbrowser-quality",
        }),
      });
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /AI that builds you, not the code/i }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto("/why-not-chatgpt");
    await expect(
      page.getByRole("heading", { name: /Why not just use ChatGPT/i }),
    ).toBeVisible();

    await openLesson(page);
    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible();
    await page.getByRole("button", { name: /check/i }).first().click();

    const completion = page.getByRole("dialog", { name: /lesson complete/i });
    await expect(completion).toBeVisible();
    const shareButton = completion.getByRole("button", { name: /share/i }).first();
    await shareButton.click();

    const shareDialog = page.getByRole("dialog", { name: /your first one/i });
    await expect(shareDialog).toBeVisible();
    await expect(shareDialog.getByRole("button", { name: /copy link/i })).toBeEnabled();
    await expect(page.locator('[data-modal-layer="60"]')).toBeVisible();
    await expect(page.locator('[data-modal-layer="55"]')).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(shareDialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(shareDialog).toHaveCount(0);
    await expect(completion).toBeVisible();
    await expect(shareButton).toBeFocused();

    // Dismissal must return to the completed lesson without converting the
    // user. Conversion is reserved for the explicit save-progress action.
    await shareButton.click();
    await shareDialog
      .getByRole("button", { name: /save this progress with a free account/i })
      .click();
    await expect(page.getByText(/Your share link is ready/i)).toBeVisible();

    const signup = page.getByRole("link", { name: /save my progress/i });
    await expect(signup).toHaveAttribute("href", "/signup");
    await signup.click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", "true");
    await expect(
      page.getByRole("heading", { name: /create your account/i }),
    ).toBeVisible();
    const trustFooter = page.getByRole("contentinfo");
    for (const destination of ["Privacy", "Terms", "Support"]) {
      const link = trustFooter.getByRole("link", { name: destination, exact: true });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box?.height ?? 0, `${destination} touch target`).toBeGreaterThanOrEqual(44);
    }
  });

  test("phone discovery, retrieval, and completion remain usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedFirstRun(page, false);
    await mockSuccessfulRun(page);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /AI that builds you, not the code/i }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const landingCta = page
      .getByRole("link", { name: /try your first lesson/i })
      .first();
    const ctaBox = await landingCta.boundingBox();
    expect(ctaBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await openLesson(page);
    await expectNoHorizontalOverflow(page);
    await expect(
      page.getByRole("button", { name: /collapse (instructions|tutor)/i }),
    ).toHaveCount(0);
    for (const action of [/run/i, /check/i]) {
      const box = await page.getByRole("button", { name: action }).first().boundingBox();
      expect(box?.height ?? 0, `${action} touch target height`).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, `${action} touch target width`).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible();
    await page.getByRole("button", { name: /check/i }).first().click();
    await expect(page.getByText(/what shows up on the screen/i)).toBeVisible();
    await expect(page.getByText(/not quite right/i)).toHaveCount(0);
    await page.getByRole("button", { name: /^Hello, World!$/i }).click();
    await expect(
      page.getByRole("dialog", { name: /lesson complete/i }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
