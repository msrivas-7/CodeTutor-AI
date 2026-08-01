import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { criticalTest } from "../fixtures/testMetadata";

const PATH = "/try/lesson/python-fundamentals/hello-world";

async function installStableTrial(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
    window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
  });
}

async function submitTutorQuestion(page: Page, question: string) {
  const textarea = page.getByLabel(/ask the tutor/i);
  await expect(textarea).toBeEnabled();
  await textarea.fill(question);
  await textarea.press("Enter");
}

function tutorReply(index: number) {
  const sections = index === 0
    ? {
        intent: "socratic",
        checkQuestions: ["What did you expect to happen?"],
      }
    : {
        intent: "debug",
        summary: `Review response ${index}`,
        nextStep: "Compare the result with your expectation.",
      };
  return `data: ${JSON.stringify({
    done: true,
    raw: JSON.stringify(sections),
    sections,
    tutorProgressToken: "mock-anon-signed-progress-proof",
  })}\n\n`;
}

test.describe("B8 governed anonymous eval sampling", () => {
  test.beforeEach(async ({ page }) => {
    await installStableTrial(page);
  });

  test("is off by default and sends consent only between explicit opt-in and deletion", criticalTest({
    risk: "p0",
    owner: "security",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    const askBodies: Array<Record<string, unknown>> = [];
    const deleteBodies: Array<Record<string, unknown>> = [];

    await page.route("**/api/anon/ai/ask/stream", async (route: Route) => {
      askBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: tutorReply(askBodies.length - 1),
      });
    });
    await page.route("**/api/anon/eval-samples", async (route: Route) => {
      deleteBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await page.goto(PATH);
    const control = page.getByTestId("eval-sampling-consent");
    const checkbox = control.getByRole("checkbox", { name: /Improve tutor/i });
    await expect(checkbox).not.toBeChecked();
    await expect(control).toContainText("optional, redacted");

    await submitTutorQuestion(page, "Why is the output empty?");
    await expect.poll(() => askBodies.length).toBe(1);
    expect(askBodies[0]).not.toHaveProperty("evalSamplingConsent");

    await checkbox.check();
    await expect(control).toContainText("Enabled. You can turn it off here at any time.");
    await submitTutorQuestion(page, "What should I compare next?");
    await expect.poll(() => askBodies.length).toBe(2);
    const consent = askBodies[1].evalSamplingConsent as {
      version: number;
      subjectToken: string;
    };
    expect(consent.version).toBe(1);
    expect(consent.subjectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await checkbox.uncheck();
    await expect.poll(() => deleteBodies.length).toBe(1);
    expect(deleteBodies[0]).toEqual({ subjectToken: consent.subjectToken });
    await expect(checkbox).not.toBeChecked();
    await expect(control.getByText(/couldn’t finish deleting/i)).toHaveCount(0);

    await submitTutorQuestion(page, "Can I ask without sharing?");
    await expect.poll(() => askBodies.length).toBe(3);
    expect(askBodies[2]).not.toHaveProperty("evalSamplingConsent");
  });

  test("keeps new sampling off while a failed deletion remains retryable", criticalTest({
    risk: "p0",
    owner: "security",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let deleteAttempts = 0;
    const askBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/anon/eval-samples", async (route) => {
      deleteAttempts += 1;
      await route.fulfill({
        status: deleteAttempts === 1 ? 503 : 200,
        contentType: "application/json",
        body: deleteAttempts === 1 ? '{"error":"temporary"}' : '{"ok":true}',
      });
    });
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      askBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: tutorReply(askBodies.length - 1),
      });
    });

    await page.goto(PATH);
    const control = page.getByTestId("eval-sampling-consent");
    const checkbox = control.getByRole("checkbox", { name: /Improve tutor/i });
    await checkbox.check();
    await checkbox.uncheck();
    await expect(control).toContainText("New turns are off");
    await expect(checkbox).not.toBeChecked();

    await submitTutorQuestion(page, "Does deletion failure block tutoring?");
    await expect.poll(() => askBodies.length).toBe(1);
    expect(askBodies[0]).not.toHaveProperty("evalSamplingConsent");

    await control.getByRole("button", { name: "Retry deletion" }).click();
    await expect.poll(() => deleteAttempts).toBe(2);
    await expect(control.getByRole("button", { name: "Retry deletion" })).toHaveCount(0);
    await expect(checkbox).not.toBeChecked();
  });

  test("keeps disclosure and controls usable at 390px in light reduced-motion mode", criticalTest({
    risk: "p1",
    owner: "accessibility",
    browsers: ["chromium", "webkit"],
    devices: ["phone"],
    quarantine: { state: "none" },
  }), async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PATH);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    });

    const control = page.getByTestId("eval-sampling-consent");
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    const checkbox = control.getByRole("checkbox", { name: /Improve tutor/i });
    await checkbox.focus();
    await expect(checkbox).toBeFocused();

    const disclosure = control.getByText("Privacy", { exact: true });
    await disclosure.click();
    await expect(control).toContainText("Files, code, paths, output, and raw history are never stored.");
    await expect(control).toContainText("BYOK chats are excluded.");

    const labelBox = await control.locator("label").boundingBox();
    const summaryBox = await control.locator("summary").boundingBox();
    expect(labelBox?.height).toBeGreaterThanOrEqual(44);
    expect(summaryBox?.height).toBeGreaterThanOrEqual(44);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="eval-sampling-consent"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await testInfo.attach("b8-consent-phone-light", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    const privacyPagePromise = page.context().waitForEvent("page");
    await control.getByRole("link", { name: "Open full privacy details" }).click();
    const privacyPage = await privacyPagePromise;
    await privacyPage.waitForLoadState();
    await expect(privacyPage).toHaveURL(/\/privacy#ai$/);
    await expect(
      privacyPage.getByRole("heading", { name: "How code and AI requests are used" }),
    ).toBeVisible();
    await expect(privacyPage.getByText(/choice is off by default/i)).toBeVisible();
    await expect(privacyPage.getByText(/expire within 30 days/i)).toBeVisible();
    await expect(privacyPage.getByText(/own API key are never part/i)).toBeVisible();

    // Trust details must not replace or erase the in-progress lesson.
    await expect(page).toHaveURL(PATH);
    await expect(control).toContainText("Privacy");
  });
});
