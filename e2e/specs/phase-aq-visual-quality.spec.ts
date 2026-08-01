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

        for (const action of [
          "Back to course",
          "Sign up to save",
          "combined",
          "stdout",
          "stderr",
          "stdin",
        ]) {
          const role: "tab" | "button" = [
            "combined",
            "stdout",
            "stderr",
            "stdin",
          ].includes(action)
            ? "tab"
            : "button";
          const control = page.getByRole(
            role,
            { name: action, exact: true },
          );
          const box = await control.boundingBox();
          expect(box?.height, `${action} touch target height`).toBeGreaterThanOrEqual(44);
          expect(box?.width, `${action} touch target width`).toBeGreaterThanOrEqual(44);
        }
      }

      // `boundingBox()` may scroll the nearest overflow container just enough
      // to expose a control. On the 360px viewport the output tabs sit close
      // to the fold, so small platform font differences can leave Linux CI
      // scrolled while macOS remains at the top. Compare the same intentional
      // product state everywhere instead of snapshotting that incidental
      // locator side effect.
      await page.locator("#main-content > div").first().evaluate((container) => {
        container.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
      await expect
        .poll(() =>
          page
            .locator("#main-content > div")
            .first()
            .evaluate((container) => container.scrollTop),
        )
        .toBe(0);

      await expect(page).toHaveScreenshot(`${viewport.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.03,
      });
    });
  }

  for (const width of [781, 900]) {
    test(`${width}px keeps instructions and tutor mutually exclusive`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await openStableLesson(page);

      const collapseInstructions = page.getByRole("button", {
        name: "Collapse instructions",
        exact: true,
      });
      if (await collapseInstructions.isVisible()) await collapseInstructions.click();

      const showTutor = page.getByRole("button", {
        name: "Show tutor panel",
        exact: true,
      });
      if (await showTutor.isVisible()) await showTutor.click();

      await page.getByRole("button", {
        name: "Show instructions panel",
        exact: true,
      }).click();
      await expect(collapseInstructions).toBeVisible();
      await expect(showTutor).toBeVisible();
      await expect(page.getByRole("button", {
        name: "Collapse tutor",
        exact: true,
      })).toHaveCount(0);

      await showTutor.click();
      await expect(page.getByRole("button", {
        name: "Show instructions panel",
        exact: true,
      })).toBeVisible();
      await expect(page.getByRole("button", {
        name: "Collapse tutor",
        exact: true,
      })).toBeVisible();
      await expect(collapseInstructions).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
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

  test("phone cinematic skip affordance is a 44px touch target", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PATH);
    const skip = page.getByRole("button", {
      name: "Skip introduction",
      exact: true,
    });
    await expect(skip).toBeVisible({ timeout: 5_000 });
    const box = await skip.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  });
});
