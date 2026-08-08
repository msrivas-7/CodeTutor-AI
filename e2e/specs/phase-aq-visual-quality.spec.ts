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
  test("phone auth and recovery controls keep a 44px interaction floor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");

    for (const [name, control] of [
      ["Google", page.getByRole("button", { name: "Google", exact: true })],
      ["GitHub", page.getByRole("button", { name: "GitHub", exact: true })],
      ["email", page.getByLabel("Email", { exact: true })],
      ["password", page.getByLabel("Password", { exact: true })],
      ["sign in", page.getByRole("button", { name: "Sign in", exact: true })],
      ["magic link", page.getByRole("button", { name: /prefer not to use a password/i })],
      ["forgot password", page.getByRole("link", { name: /forgot password/i })],
      ["create account", page.getByRole("link", { name: /create one/i })],
    ] as const) {
      await expect(control, `${name} is visible`).toBeVisible();
      const box = await control.boundingBox();
      expect(box?.height ?? 0, `${name} touch target height`).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: /forgot password/i }).click();
    await expect(
      page.getByRole("heading", { name: /reset your password/i }),
    ).toBeVisible();
    for (const [name, control] of [
      ["recovery email", page.getByLabel("Email", { exact: true })],
      ["send reset link", page.getByRole("button", { name: /send reset link/i })],
      ["back to sign in", page.getByRole("link", { name: /back to sign in/i })],
    ] as const) {
      await expect(control, `${name} is visible`).toBeVisible();
      const box = await control.boundingBox();
      expect(box?.height ?? 0, `${name} touch target height`).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
  });

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
    test(`${width}px uses the complete single-column lesson flow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await openStableLesson(page);

      await expect(page.getByRole("region", { name: "Lesson instructions" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Code editor" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Program output" })).toBeVisible();
      await expect(page.getByRole("region", { name: "AI tutor" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^run code/i }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /check my work/i }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /show instructions panel/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /show tutor panel/i })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  }

  for (const width of [1366]) {
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
      await expect(collapseInstructions).toBeFocused();
      await expect(showTutor).toBeVisible();
      const tutorRestoreBox = await showTutor.boundingBox();
      expect(tutorRestoreBox?.width ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole("button", {
        name: "Collapse tutor",
        exact: true,
      })).toHaveCount(0);

      await showTutor.click();
      const showInstructions = page.getByRole("button", {
        name: "Show instructions panel",
        exact: true,
      });
      await expect(showInstructions).toBeVisible();
      const instructionsRestoreBox = await showInstructions.boundingBox();
      expect(instructionsRestoreBox?.width ?? 0).toBeGreaterThanOrEqual(44);
      const collapseTutor = page.getByRole("button", {
        name: "Collapse tutor",
        exact: true,
      });
      await expect(collapseTutor).toBeVisible();
      await expect(collapseTutor).toBeFocused();
      await expect(collapseInstructions).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("responsive workspace mode changes preserve the focused pane", async ({ page }) => {
    await page.setViewportSize({ width: 901, height: 863 });
    await openStableLesson(page);

    const showInstructions = page.getByRole("button", {
      name: "Show instructions panel",
      exact: true,
    });
    await showInstructions.click();
    const collapseInstructions = page.getByRole("button", {
      name: "Collapse instructions",
      exact: true,
    });
    await expect(collapseInstructions).toBeFocused();

    await page.setViewportSize({ width: 781, height: 863 });
    await expect(page.getByRole("region", { name: "Lesson instructions" })).toBeFocused();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 901, height: 863 });
    await expect(collapseInstructions).toBeFocused();

    const showTutor = page.getByRole("button", {
      name: "Show tutor panel",
      exact: true,
    });
    await showTutor.click();
    const collapseTutor = page.getByRole("button", {
      name: "Collapse tutor",
      exact: true,
    });
    await expect(collapseTutor).toBeFocused();

    await page.setViewportSize({ width: 781, height: 863 });
    await expect(page.getByRole("region", { name: "AI tutor" })).toBeFocused();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 901, height: 863 });
    await expect(collapseTutor).toBeFocused();
    await expectNoHorizontalOverflow(page);

    // Monaco's hidden native edit-context sits beneath its rendered text
    // layer, so clicking that semantic node directly is not a real pointer
    // path. Click the visible editor canvas, then verify the responsive
    // handoff from the edit context it focuses.
    await page.locator(".monaco-editor").click({ position: { x: 160, y: 80 } });
    await page.setViewportSize({ width: 781, height: 863 });
    await expect(page.getByRole("region", { name: "Code editor" })).toBeFocused();
    await page.setViewportSize({ width: 901, height: 863 });
    await expect(page.getByRole("region", { name: "Code editor" })).toBeFocused();

    await page.getByRole("tab", { name: "stdout", exact: true }).click();
    await page.setViewportSize({ width: 781, height: 863 });
    await expect(page.getByRole("region", { name: "Program output" })).toBeFocused();
    await page.setViewportSize({ width: 901, height: 863 });
    await expect(page.getByRole("region", { name: "Program output" })).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });

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
    const lessonHeading = page.getByRole("heading", {
      name: "Hello, World!",
      level: 1,
    });
    const firstMove = page.getByRole("region", { name: "Your first move" });
    await expect(lessonHeading).toBeVisible();
    await expect(firstMove).toBeVisible();
    for (const control of [
      page.getByRole("button", { name: "Run code", exact: true }),
      page.getByRole("button", {
        name: "Check my work against lesson requirements",
        exact: true,
      }),
      page.getByRole("button", { name: "Reset code to starter", exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
    }
    const contrast = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const token = (name: string) =>
        css.getPropertyValue(name).trim().split(/\s+/).map(Number) as [number, number, number];
      const luminance = ([red, green, blue]: [number, number, number]) => {
        const channel = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
      };
      const ratio = (foreground: [number, number, number], background: [number, number, number]) => {
        const first = luminance(foreground);
        const second = luminance(background);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      };
      const blend = (
        foreground: [number, number, number],
        background: [number, number, number],
        alpha: number,
      ): [number, number, number] =>
        foreground.map((value, index) =>
          value * alpha + background[index]! * (1 - alpha),
        ) as [number, number, number];
      const panel = token("--color-panel");
      const success = token("--color-success");
      const danger = token("--color-danger");
      return {
        accentOnPanel: ratio(token("--color-accent-ink"), panel),
        successOnTint: ratio(success, blend(success, panel, 0.15)),
        dangerOnTint: ratio(danger, blend(danger, panel, 0.1)),
      };
    });
    expect(contrast.accentOnPanel).toBeGreaterThanOrEqual(4.5);
    expect(contrast.successOnTint).toBeGreaterThanOrEqual(4.5);
    expect(contrast.dangerOnTint).toBeGreaterThanOrEqual(4.5);
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
