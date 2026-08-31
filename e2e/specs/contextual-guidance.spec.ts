// Release 1C — public deterministic guide plus learner-accepted contextual
// Tutor offer. The guide remains local; only an explicit click may spend.

import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { criticalTest } from "../fixtures/testMetadata";

const PATH = "/try/lesson/python-fundamentals/hello-world";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pythonUnclosedParenthesis(line: number, receipt = `line-${line}`) {
  return {
    stdout: "",
    stderr: `  File "/workspace/main.py", line ${line}\n    print("Hello"\n         ^\nSyntaxError: '(' was never closed\n`,
    exitCode: 1,
    errorType: "compile",
    durationMs: 4,
    stage: "compile",
    contextualEvidenceToken: `signed-contextual-evidence-${receipt}`,
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
      body: JSON.stringify(pythonUnclosedParenthesis(line, `run-${runCount}-line-${line}`)),
    });
  });
}

async function runCode(page: Page) {
  const run = page.getByRole("button", { name: /^run code/i }).first();
  await expect(run).toBeEnabled();
  await run.click();
  await expect(run).toBeEnabled();
}

test.describe("contextual guidance and Tutor offer", () => {
  test.beforeEach(async ({ page }) => {
    await installStableTrial(page);
    await installRunMock(page);
    await page.route("**/api/anon/ai-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contextualTutorEnabled: true,
          contextualTutorModelEligible: true,
        }),
      });
    });
  });

  test("learner-authored stderr cannot impersonate a parser diagnostic", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    await page.unroute("**/api/anon/run");
    let aiCalls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      aiCalls += 1;
      await route.abort();
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(
      page,
      "import sys\nsys.stderr.write('File \\\"/workspace/main.py\\\", line 1\\nSyntaxError: \\\'(\\\' was never closed\\n')\nraise SystemExit(1)\n",
    );
    await runCode(page);
    await expect(page.getByRole("region", { name: "Program output" }))
      .toContainText("Runtime error");
    await expect(page.getByTestId("contextual-guide-bridge")).toHaveCount(0);
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);

    await setMonacoValue(page, 'print("alpha"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("beta"\n');
    await runCode(page);
    await expect(page.getByRole("region", { name: "Program output" }))
      .toContainText("Compile error");
    await expect(page.getByTestId("contextual-guide-question")).toHaveText(
      "Which opening parenthesis still needs a closing partner?",
    );
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText(
      "Help me spot it",
    );
    expect(aiCalls).toBe(0);
  });

  test("an authoritative disabled gate keeps anonymous contextual help unavailable", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let aiCalls = 0;
    await page.route("**/api/anon/ai-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contextualTutorEnabled: false,
          contextualTutorModelEligible: true,
        }),
      });
    });
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      aiCalls += 1;
      await route.abort();
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);

    await expect(page.getByTestId("contextual-guide-question")).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    await expect(page.getByText("Help me spot it", { exact: true })).toHaveCount(0);
    expect(aiCalls).toBe(0);

    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
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

    await bridge.getByRole("button", { name: "Jump to line 1" }).click();
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

    for (const name of ["Jump to line 1", "Help me spot it", "Dismiss current code guidance"]) {
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

  test("explicit acceptance makes one contextual call and carries the same evidence", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    const requestBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      // Keep the stream pending long enough to verify the accepted-evidence
      // receipt itself. The receipt intentionally yields to the completed
      // Tutor response, so a near-instant mock can otherwise finish between
      // Playwright assertions without exposing a product failure.
      await new Promise((resolve) => setTimeout(resolve, 750));
      const sections = {
        intent: "debug",
        summary: "The latest run points to a syntax error on line 1.",
        hint: "Look at the opening parenthesis on that line and count its closing partner.",
        checkQuestions: ["Which opening parenthesis still needs a closing partner?"],
      };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          done: true,
          raw: JSON.stringify(sections),
          sections,
          tutorProgressToken: "mock-contextual-progress-proof",
        })}\n\n`,
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    expect(requestBodies).toHaveLength(0);

    const accept = page.getByTestId("contextual-guide-ask");
    await expect(accept).toHaveText("Help me spot it");
    // Same-task double activation before React can remove the control must
    // still enqueue one accepted action and one server request.
    await accept.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(page.getByTestId("contextual-guide-bridge")).toHaveCount(0);
    await expect(page.getByTestId("contextual-tutor-receipt")).toContainText(
      "syntax error on line 1",
    );
    await expect(page.getByTestId("contextual-guide-bridge")).toHaveCount(0);
    await expect(page.getByText(/latest run points to a syntax error on line 1/i)).toBeVisible();
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      tutorAction: "contextual-help",
      question: "Help me spot the issue without giving me the answer.",
      contextualOffer: {
        contextVersion: 0,
        evidenceToken: "signed-contextual-evidence-run-2-line-1",
        evidenceTokens: [
          "signed-contextual-evidence-run-1-line-1",
          "signed-contextual-evidence-run-2-line-1",
        ],
        moveId: "notice-unclosed-parenthesis",
        scaffoldLevel: 1,
        evidence: {
          code: "python-unclosed-parenthesis",
          path: "main.py",
          line: 1,
        },
      },
    });
  });

  test("an edit during generation discards stale content outside the transcript", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const sections = {
        intent: "debug",
        hint: "STALE_CONTEXT_SHOULD_NEVER_RENDER",
      };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ done: true, raw: JSON.stringify(sections), sections })}\n\n`,
      }).catch(() => {});
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();
    await expect.poll(() => calls).toBe(1);
    await setMonacoValue(page, 'print("Now fixed")\n');
    await expect(page.getByText("Code changed", { exact: true })).toBeVisible();
    await expect(page.getByText("Your code changed while I was thinking—ask again when ready.")).toBeVisible();
    await expect(page.getByText("STALE_CONTEXT_SHOULD_NEVER_RENDER")).toHaveCount(0);
  });

  test("a retry remains useful without replaying accepted contextual evidence", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    const requestBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      if (requestBodies.length === 1) {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "provider unavailable" }),
        });
        return;
      }
      const sections = {
        intent: "debug",
        hint: "Count the opening and closing parentheses on the cited line.",
        checkQuestions: ["Which opening parenthesis still needs its partner?"],
      };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ done: true, raw: JSON.stringify(sections), sections })}\n\n`,
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByRole("button", { name: /retry the last question/i })).toBeVisible();
    await expect(page.getByTestId("contextual-guide-bridge")).toHaveCount(0);
    await page.getByRole("button", { name: /retry the last question/i }).click();
    await expect(page.getByText(/count the opening and closing parentheses/i)).toBeVisible();

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]).toMatchObject({
      question: "Help me spot the issue without giving me the answer.",
    });
    expect(requestBodies[1].tutorAction).toBeUndefined();
    expect(requestBodies[1].contextualOffer).toBeUndefined();
  });

  test("a kill-switch refusal preserves the free guide without a retry loop", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "CONTEXTUAL_TUTOR_DISABLED" }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    await expect(page.getByText("Contextual help is paused")).toBeVisible();
    await expect(page.getByText(/latest error is still in Output/i)).toBeVisible();
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    await expect(page.getByText("Help me spot it", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
    expect(calls).toBe(1);

    // The same authored guide remains useful, but its action now opens and
    // focuses the ordinary non-spending Tutor path, even when that path has
    // to cross the collapsed panel's inert boundary first.
    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByRole("button", { name: "Show tutor panel" })).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByLabel(/ask the tutor/i)).toBeFocused();
    expect(calls).toBe(1);
  });

  test("an admission-storage outage preserves the free guide without replaying consent", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "AI_ADMISSION_UNAVAILABLE" }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    await expect(page.getByText("Tutor admission temporarily unavailable")).toBeVisible();
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(page.getByText(/Which opening parenthesis still needs a closing partner/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to line 1" })).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /retry the last question/i })).toHaveCount(0);
    expect(calls).toBe(1);

    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByLabel(/ask the tutor/i)).toBeFocused();
    expect(calls).toBe(1);
  });

  test("a trial pause keeps the authored guide after the signup wall is dismissed", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "ANON_LESSON_DISABLED" }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    const wall = page.getByRole("dialog", { name: "We're catching our breath." });
    await expect(wall).toBeVisible();
    await wall.getByRole("button", { name: "Maybe later" }).click();
    await expect(wall).toHaveCount(0);
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(
      page.getByText(/Which opening parenthesis still needs a closing partner/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to line 1" })).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    expect(calls).toBe(1);

    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
  });

  test("a platform spend refusal preserves the free guide without replaying consent", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "PLATFORM_AI_PAUSED",
          reason: "anon_daily_usd_hit",
        }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    await expect(page.getByText("Free tutor temporarily unavailable")).toBeVisible();
    await expect(page.getByText(/PLATFORM_AI_PAUSED|anon_daily_usd_hit/)).toHaveCount(0);
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to line 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: /retry the last question/i })).toHaveCount(0);
    expect(calls).toBe(1);

    // Responsive policy changes remount the Tutor. A server refusal belongs
    // to the lesson episode, not one panel instance, so compact mode must not
    // resurrect the spending action.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    expect(calls).toBe(1);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByLabel(/ask the tutor/i)).toBeFocused();
    expect(calls).toBe(1);
  });

  test("a responsive Tutor remount refunds pending contextual help and preserves recovery", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    const firstRelease = deferred();
    const firstStarted = deferred();
    let askCalls = 0;
    let cancelCalls = 0;
    await page.route("**/api/anon/ai/ask/cancel", async (route) => {
      cancelCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ canceled: true, refunded: true }),
      });
    });
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      askCalls += 1;
      if (askCalls === 1) {
        firstStarted.resolve();
        await firstRelease.promise;
      }
      const sections = {
        intent: "debug",
        hint: "Count the opening and closing parentheses on the cited line.",
        checkQuestions: ["Which opening parenthesis still needs its partner?"],
      };
      try {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body: `data: ${JSON.stringify({ done: true, raw: JSON.stringify(sections), sections })}\n\n`,
        });
      } catch {
        // The first transport is expected to be gone after the responsive
        // subtree replacement. Callback guards still protect a losing race.
      }
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();
    await firstStarted.promise;
    await expect(page.getByRole("status", { name: /tutor is thinking/i })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    firstRelease.resolve();
    await expect.poll(() => cancelCalls).toBe(1);
    await expect(page.getByText("Tutor view changed", { exact: true })).toBeVisible();
    await expect(page.getByText(/turn was released from your daily allowance/i)).toBeVisible();
    await expect(page.getByTestId("contextual-guide-question")).toBeVisible();
    await expect(page.getByRole("button", { name: /retry the last question/i })).toBeVisible();

    await page.getByRole("button", { name: /retry the last question/i }).click();
    await expect(page.getByText(/count the opening and closing parentheses/i)).toBeVisible();
    expect(askCalls).toBe(2);
    expect(cancelCalls).toBe(1);
  });

  test("a lesson-context refusal preserves the free guide without replaying consent", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "LESSON_CONTEXT_NOT_FOUND" }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    await expect(page.getByText(/LESSON_CONTEXT_NOT_FOUND/)).toHaveCount(0);
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to line 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: /retry the last question/i })).toHaveCount(0);
    expect(calls).toBe(1);

    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByLabel(/ask the tutor/i)).toBeFocused();
    expect(calls).toBe(1);
  });

  test("a runtime model refusal preserves the guide and invalidates contextual spending", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_OFFER" }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    await expect(page.getByText("This model is not ready for contextual help")).toBeVisible();
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
    expect(calls).toBe(1);

    await page.getByRole("button", { name: "Collapse tutor" }).click();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByLabel(/ask the tutor/i)).toBeFocused();
    expect(calls).toBe(1);
  });

  test("expired signed evidence is retired before a fresh attempt chain re-arms the offer", criticalTest({
    risk: "p0",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    let calls = 0;
    // This recovery case needs the same evidence key across both fresh
    // attempts. The suite default intentionally moves the fourth run to line
    // 2 for a separate dismissal test, which would reset this episode here.
    await page.unroute("**/api/anon/run");
    let recoveryRunCount = 0;
    await page.route("**/api/anon/run", async (route) => {
      recoveryRunCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          pythonUnclosedParenthesis(1, `recovery-${recoveryRunCount}`),
        ),
      });
    });
    await page.route("**/api/anon/ai/ask/stream", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "CONTEXTUAL_EVIDENCE_STALE" }),
      });
    });

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await runCode(page);
    await page.getByTestId("contextual-guide-ask").click();

    await expect(page.getByText("Run evidence expired")).toBeVisible();
    await expect(page.getByText(/adjust it and run once more/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
    await expect(page.getByTestId("contextual-guide-bridge")).toHaveCount(0);
    expect(calls).toBe(1);

    await setMonacoValue(page, 'print("Hello again"\n');
    await runCode(page);
    await expect(page.getByTestId("contextual-guide-ask")).toHaveCount(0);
    await setMonacoValue(page, 'print("Hello once more"\n');
    await runCode(page);
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Help me spot it");
    expect(calls).toBe(1);

    // A fresh signed chain for the same code/path/line must be actionable. The
    // stale chain's accepted key cannot leave this replacement button inert.
    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByText("Run evidence expired")).toBeVisible();
    expect(calls).toBe(2);
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

  test("compact Open Tutor recovery scrolls to and focuses the composer", criticalTest({
    risk: "p1",
    owner: "learning",
    browsers: ["chromium", "webkit"],
    devices: ["phone"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.route("**/api/anon/ai-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contextualTutorEnabled: false,
          contextualTutorModelEligible: true,
        }),
      });
    });
    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await runCode(page);
    await setMonacoValue(page, 'print("Hello, compact"\n');
    await runCode(page);

    await page.getByTestId("contextual-guide-ask").click();
    await expect(page.getByLabel(/ask the tutor/i)).toBeFocused();
    await expect(page.getByLabel(/ask the tutor/i)).toBeInViewport();
  });
});
