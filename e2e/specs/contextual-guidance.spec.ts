// Phase 1B — deterministic, authored assistance proof. The guide is enabled
// only through the internal preview flag and must never initiate an AI call.

import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { criticalTest } from "../fixtures/testMetadata";

const PATH = "/try/lesson/python-fundamentals/hello-world?contextGuide=1";

function pythonUnclosedParenthesis(line: number) {
  return {
    stdout: "",
    stderr: `  File "/workspace/main.py", line ${line}\n    print("Hello"\n         ^\nSyntaxError: '(' was never closed\n`,
    exitCode: 1,
    errorType: "runtime",
    durationMs: 4,
    stage: "run",
  };
}

async function installStableTrial(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
    window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
  });
}

async function installRunMock(page: Page) {
  let runCount = 0;
  await page.route("**/api/anon/run", async (route: Route) => {
    runCount += 1;
    // The fourth run changes the allowlisted location. That is a new evidence
    // key, so a prior dismissal must no longer suppress the result bridge.
    const line = runCount >= 4 ? 2 : 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pythonUnclosedParenthesis(line)),
    });
  });
}

async function runCode(page: Page) {
  const run = page.getByRole("button", { name: /^run code/i }).first();
  await expect(run).toBeEnabled();
  await run.click();
  await expect(run).toBeEnabled();
}

test.describe("contextual guidance internal proof", () => {
  test.beforeEach(async ({ page }) => {
    await installStableTrial(page);
    await installRunMock(page);
  });

  test("repeated evidence selects authored guidance without an automatic AI request", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }, testInfo) => {
    let aiCalls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      aiCalls += 1;
      await route.abort();
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);

    const bridge = page.getByTestId("contextual-guide-bridge");
    await expect(bridge).toContainText("Syntax error on line 1");
    await expect(page.getByTestId("contextual-guide-question")).toHaveCount(0);
    await testInfo.attach("phase-1b-before-repeat", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    // Same normalized error, but only after a source revision, reaches the
    // authored threshold. The generic timer coach and AI CTA yield to it.
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await expect(bridge).toHaveCount(0);
    await runCode(page);
    await expect(page.getByTestId("contextual-guide-question")).toHaveText(
      "Which opening parenthesis still needs a closing partner?",
    );
    await expect(
      page.getByRole("region", { name: "Current code guidance" }),
    ).toBeVisible();
    await expect(bridge.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("button", { name: /ask the tutor what went wrong/i })).toHaveCount(0);
    await expect(page.getByText("Been there — let's figure it out.")).toHaveCount(0);
    await expect(page.locator(".contextual-guide-editor-line")).toHaveCount(1);
    expect(aiCalls).toBe(0);

    const accessibility = await new AxeBuilder({ page })
      // Monaco owns a canvas/hidden-textarea accessibility model that the
      // repository's dedicated a11y suite audits separately.
      .exclude(".monaco-editor")
      .analyze();
    expect(accessibility.violations).toEqual([]);

    await bridge.getByRole("button", { name: "View error" }).click();
    await expect(
      page.getByRole("textbox", { name: /guidance targets line 1/i }),
    ).toBeFocused();
    await testInfo.attach("phase-1b-authored-move", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    const dismiss = bridge.getByRole("button", {
      name: "Dismiss current code guidance",
    });
    const dismissBox = await dismiss.boundingBox();
    expect(dismissBox?.height).toBeGreaterThanOrEqual(44);
    expect(dismissBox?.width).toBeGreaterThanOrEqual(44);
    await dismiss.click();
    await expect(bridge).toHaveCount(0);

    // Dismissal survives another edit + the same evidence key.
    await setMonacoValue(page, 'print("Still open"\n');
    await runCode(page);
    await expect(bridge).toHaveCount(0);

    // A changed location is a changed key, so the current bridge may return.
    await setMonacoValue(page, 'name = "Maya"\nprint("Hello"\n');
    await runCode(page);
    await expect(bridge).toContainText("Syntax error on line 2");
    await expect(page.getByTestId("contextual-guide-question")).toHaveCount(0);
    expect(aiCalls).toBe(0);
  });

  test("390px keeps the cue, target, and 44px actions simultaneously usable", criticalTest({
    risk: "p1",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["phone"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PATH);
    await waitForMonacoReady(page);

    const editorSection = page.getByRole("region", { name: "Code editor" });
    await editorSection.scrollIntoViewIfNeeded();
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, phone"\n');
    await runCode(page);

    const bridge = page.getByTestId("contextual-guide-bridge");
    const target = page.locator(".contextual-guide-editor-line");
    await expect(bridge).toBeInViewport();
    await expect(target).toBeInViewport();
    await expect(page.getByTestId("contextual-guide-question")).toBeVisible();

    for (const name of ["View error", "Dismiss current code guidance"]) {
      const control = bridge.getByRole("button", { name });
      const box = await control.boundingBox();
      expect(box?.height, `${name} target height`).toBeGreaterThanOrEqual(44);
      expect(box?.width, `${name} target width`).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("phone keyboard height keeps the current cue and recovery controls reachable", criticalTest({
    risk: "p1",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["phone"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto(PATH);
    await waitForMonacoReady(page);

    const editorSection = page.getByRole("region", { name: "Code editor" });
    await editorSection.scrollIntoViewIfNeeded();
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, keyboard"\n');
    await runCode(page);

    const bridge = page.getByTestId("contextual-guide-bridge");
    await expect(bridge).toBeInViewport();
    await expect(page.locator(".contextual-guide-editor-line")).toBeInViewport();
    await expect(page.getByRole("button", { name: /^run code/i }).first()).toBeInViewport();
    await expect(page.getByRole("button", { name: /check my work/i }).first()).toBeInViewport();
  });
});
