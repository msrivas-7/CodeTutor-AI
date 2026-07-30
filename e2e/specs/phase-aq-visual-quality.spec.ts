// Phase A-Q AQ5/AQ8: enforce the supported viewport matrix as a maintained
// product-quality floor. These checks deliberately cover the anonymous lesson
// because it combines the densest critical UI: instructions, editor, output,
// action bar, and tutor.

import { expect, test, type Page } from "@playwright/test";
import { waitForMonacoReady } from "../fixtures/monaco";

const PATH = "/try/lesson/python-fundamentals/hello-world";

const VIEWPORTS = [
  { name: "phone-360x800", width: 360, height: 800 },
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
] as const;

async function openStableLesson(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
    window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
  });
  await page.goto(PATH);
  await waitForMonacoReady(page);
  await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document, "document horizontal overflow in CSS pixels").toBeLessThanOrEqual(1);
  expect(overflow.body, "body horizontal overflow in CSS pixels").toBeLessThanOrEqual(1);
}

test.describe("Phase A-Q — visual viewport matrix", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} keeps the lesson coherent`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openStableLesson(page);
      await expectNoHorizontalOverflow(page);

      if (viewport.width <= 390) {
        await expect(
          page.getByRole("button", { name: /collapse (instructions|tutor)/i }),
        ).toHaveCount(0);

        for (const action of [/run/i, /check/i]) {
          const box = await page.getByRole("button", { name: action }).first().boundingBox();
          expect(box?.height, `${action} touch target height`).toBeGreaterThanOrEqual(44);
          expect(box?.width, `${action} touch target width`).toBeGreaterThanOrEqual(44);
        }
      }

      await expect(page).toHaveScreenshot(`${viewport.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.03,
      });
    });
  }

  test("light theme preserves hierarchy and contrast", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await openStableLesson(page);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot("phone-390x844-light-reduced-motion.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.03,
    });
  });

  test("200% zoom keeps the primary lesson actions reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStableLesson(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /check/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("software-keyboard-height viewport keeps tutor input and actions usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await openStableLesson(page);
    const tutorInput = page.getByPlaceholder("Ask about this lesson...");
    await tutorInput.focus();
    await expect(tutorInput).toBeFocused();
    await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
