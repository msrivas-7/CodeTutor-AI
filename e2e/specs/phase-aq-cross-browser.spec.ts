// Phase A-Q cross-browser release gate.
//
// Chromium runs the exhaustive suite and owns screenshot baselines. This
// focused journey protects the highest-value experience in Firefox and
// WebKit (the engine used by Safari): public discovery, anonymous lesson,
// retrieval, completion, stacked sharing, conversion, and phone layout.

import { expect, test, type Page } from "@playwright/test";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { criticalTest } from "../fixtures/testMetadata";

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

test.describe(
  "Phase A-Q — Firefox and WebKit critical journey",
  criticalTest({
    risk: "p1",
    owner: "learning",
    browsers: ["chromium", "firefox", "webkit"],
    devices: ["desktop", "phone"],
    quarantine: { state: "none" },
  }),
  () => {
  test("desktop discovery reaches a usable share artifact and signup", async ({ page }) => {
    const signupEmail = "cross-browser-b5@example.com";
    await seedFirstRun(page, true);
    await mockSuccessfulRun(page);
    await page.route("**/auth/v1/signup**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-000000000006",
          email: signupEmail,
          role: "",
          aud: "authenticated",
          confirmation_sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          identities: [],
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
        }),
      }),
    );
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
    await setMonacoValue(page, 'print("Hello, Maya!")\n');
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

    const continuation = page.getByRole("dialog", {
      name: /your share link is ready/i,
    });
    await expect(continuation.getByLabel(/first name/i)).toHaveValue("Maya");
    expect(new URL(page.url()).pathname).toBe(LESSON_PATH);
    for (const destination of ["Terms", "Privacy notice"]) {
      const link = continuation.getByRole("link", {
        name: destination,
        exact: true,
      });
      await expect(link).toBeVisible();
      await expect
        .poll(
          async () => (await link.boundingBox())?.height ?? 0,
          { message: `${destination} touch target` },
        )
        .toBeGreaterThanOrEqual(44);
    }
    await continuation.getByLabel(/email/i).fill(signupEmail);
    await continuation
      .getByLabel("Password", { exact: true })
      .fill("E2ePass9!secure");
    await continuation
      .getByLabel(/confirm password/i)
      .fill("E2ePass9!secure");
    await continuation
      .getByRole("button", { name: /create account & save progress/i })
      .click();
    const confirmation = page.getByRole("dialog", { name: /check your email/i });
    await expect(
      confirmation.getByRole("heading", { name: /check your email/i }),
    ).toBeVisible();
    await confirmation.getByRole("button", { name: /back to lesson/i }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", "true");
    expect(new URL(page.url()).pathname).toBe(LESSON_PATH);
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

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /sign up to save/i }).click();
    const continuation = page.getByRole("dialog", { name: /sign up to save/i });
    await expect(continuation).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const scroll = await continuation.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    const submit = continuation.getByRole("button", {
      name: /create account & start saving/i,
    });
    await submit.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await submit.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(continuation).toHaveCount(0);
  });

  test("a native viewport reflow consumes Escape before the product modal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedFirstRun(page, true);
    await openLesson(page);
    await page.getByRole("button", { name: /sign up to save/i }).click();
    const continuation = page.getByRole("dialog", { name: /sign up to save/i });
    await expect(continuation).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }));
    });
    await page.setViewportSize({ width: 900, height: 720 });
    await page.waitForTimeout(180);
    await expect(continuation).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(continuation).toHaveCount(0);
  });
  },
);
