import { expect, test, type Browser } from "@playwright/test";
import { criticalTest } from "../fixtures/testMetadata";

const TRIAL_PATH = "/try/lesson/python-fundamentals/hello-world";
const DISTRIBUTION_ATTRIBUTION_KEY = "codetutor.distribution.firstTouch.v1";

async function verifyZeroStateJourney(
  browser: Browser,
  viewport: { width: number; height: number },
  mobile: boolean,
) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();

  await page.goto("/");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(1);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), DISTRIBUTION_ATTRIBUTION_KEY),
  ).toBe(JSON.stringify({ source: "direct" }));

  const primary = page.getByRole("link", { name: /try your first lesson/i }).first();
  await expect(primary).toBeVisible();
  await expect(primary).toHaveAttribute("href", TRIAL_PATH);
  await primary.click();
  await expect(page).toHaveURL(new RegExp(`${TRIAL_PATH}$`));

  // The named snippet is explicitly presented as an example, never as if the
  // product already knows the visitor.
  await expect(page.getByText(/Example code · Maya/i)).toBeVisible({ timeout: 6_000 });
  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { level: 1, name: /Hello, World!/i })).toBeVisible({
    timeout: 12_000,
  });
  const firstMove = page.getByRole("region", { name: /your first move/i });
  await expect(firstMove).toBeVisible();
  await expect(firstMove).toContainText(/type one line/i);
  await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Sign up to save\?/i)).toHaveCount(0);

  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport + 1);
  await context.close();
}

test.describe("release 0C — true zero-state first journey", () => {
  test(
    "desktop visitor reaches one clear first action without signup",
    criticalTest({
      risk: "p1",
      owner: "learning",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ browser }) => {
      await verifyZeroStateJourney(browser, { width: 1440, height: 900 }, false);
    },
  );

  test(
    "390px visitor reaches the same honest first action",
    criticalTest({
      risk: "p1",
      owner: "learning",
      browsers: ["chromium"],
      devices: ["phone"],
      quarantine: { state: "none" },
    }),
    async ({ browser }) => {
      await verifyZeroStateJourney(browser, { width: 390, height: 844 }, true);
    },
  );
});
