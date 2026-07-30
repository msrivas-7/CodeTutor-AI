// Phase 27-v2.1 medium-lock — anon celebration dismiss opens the wall.
//
// Decision context: 4-agent consensus (product-owner, staff-ux,
// staff-qa, creative director) on what happens when Maya dismisses
// the LessonCompletePanel celebration on /try/ without clicking
// "Next Lesson". Soft-lock (current pre-decision) drops her back into
// a working editor — silent bounce. Hard-lock traps her — Alex's
// nightmare. Medium-lock fires the SignupWallDialog (reason="next-
// lesson") on dismiss, but the wall is itself dismissable. She can
// "Maybe later" out of it and keep tinkering on lesson 1.
//
// What this spec verifies:
//   1. Esc on the celebration → wall opens (reason="next-lesson")
//   2. Wall's "Maybe later" closes the wall, returns to lesson chrome
//   3. After the wall is dismissed, lesson chrome is still interactive
//   4. The wall does NOT re-fire on subsequent Esc keystrokes (no
//      re-trap loop) once the celebration is unmounted
//   5. Clicking "Next Lesson →" inside the celebration also opens the
//      wall AND dismisses the celebration (so a 2nd Esc closes wall
//      cleanly without surfacing the celebration underneath)
//
// Driving the celebration via real flow (cinematic → coach →
// walkthrough → Run → edit → Run → Check) is too heavy for this
// spec. We seed sessionStorage to skip cinematic + coach +
// choreography, then drive Run + edit + Check directly via the
// mocked /api/anon/run response.

import { expect, test } from "@playwright/test";

const PATH = "/try/lesson/python-fundamentals/hello-world";

test.describe("Phase 27-v2.1 medium-lock — celebration dismiss", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-seed cinematic + coach + choreography flags so the test
    // lands directly on the working lesson chrome.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      // Phase A — A1: pre-seed the retrieval-check pass so the celebration
      // mounts immediately on Check. Specs that exercise the retrieval
      // gate live in retrieval-check-gate.spec.ts.
      window.localStorage.setItem(
        "ui:lesson:retrievalPassed:python-fundamentals:hello-world",
        "1",
      );
    });

    // Mock /api/anon/run to return a clean "Hello, Maya!" stdout so
    // the validator (substring + forbidden_in_stdout) passes when
    // Check is clicked.
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

  test("Esc on celebration opens wall with reason='next-lesson'", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Type "Maya" into the editor by clicking it then keying. Replace
    // the YOUR_NAME placeholder via select-all + type. (Playwright
    // can't easily reach Monaco's internal model; keyboard-driven
    // overwrite is the most stable path.)
    await page
      .getByRole("button", { name: /run/i })
      .first()
      .click();
    // Wait for the run output then Check.
    // Multiple "Hello, Maya!" matches: the instruction example
    // (inline code), the output panel stdout span. Use last() because
    // the output panel renders below the instructions and is the one
    // we care about (Run actually fired). first() would match the
    // instruction block which is always there.
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page
      .getByRole("button", { name: /check/i })
      .first()
      .click();

    // Celebration mounts. Title is "Your first one" (lesson 1) or
    // generic — either way, role=alertdialog identifies it.
    const celebration = page.getByRole("alertdialog").first();
    await expect(celebration).toBeVisible({ timeout: 10_000 });

    // Esc — celebration dismisses, wall opens.
    await page.keyboard.press("Escape");

    // The wall renders as alertdialog with title "Lesson 2 is queued up."
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toBeVisible({
      timeout: 3_000,
    });
    // "Maybe later" is the medium-lock dismiss copy specifically for
    // reason="next-lesson". If a future change reverts this back to
    // "Not yet", this assertion catches it.
    await expect(
      page.getByRole("button", { name: /maybe later/i }),
    ).toBeVisible();
  });

  test("wall's 'Maybe later' returns to lesson chrome (medium, not hard, lock)", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: /run/i })
      .first()
      .click();
    // Multiple "Hello, Maya!" matches: the instruction example
    // (inline code), the output panel stdout span. Use last() because
    // the output panel renders below the instructions and is the one
    // we care about (Run actually fired). first() would match the
    // instruction block which is always there.
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page
      .getByRole("button", { name: /check/i })
      .first()
      .click();
    await expect(page.getByRole("alertdialog").first()).toBeVisible({
      timeout: 10_000,
    });

    // Dismiss celebration → wall opens.
    await page.keyboard.press("Escape");
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toBeVisible();

    // Click "Maybe later" → wall dismisses.
    await page.getByRole("button", { name: /maybe later/i }).click();
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toHaveCount(0);

    // Lesson chrome is still interactive — the "Lesson 1"
    // header chip is the canary.
    await expect(page.locator("header").getByText("Lesson 1", { exact: true })).toBeVisible();

    // Pressing Esc here does NOT re-fire the wall — celebration is
    // unmounted, no celebration→wall handoff to trigger.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300); // let any wall mount happen
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toHaveCount(0);
  });

  test("Next Lesson → button dismisses celebration AND opens wall (no stacked celebration)", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: /run/i })
      .first()
      .click();
    // Multiple "Hello, Maya!" matches: the instruction example
    // (inline code), the output panel stdout span. Use last() because
    // the output panel renders below the instructions and is the one
    // we care about (Run actually fired). first() would match the
    // instruction block which is always there.
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page
      .getByRole("button", { name: /check/i })
      .first()
      .click();
    await expect(page.getByRole("alertdialog").first()).toBeVisible({
      timeout: 10_000,
    });

    // Click "Next Lesson →" inside the celebration. Two buttons match
    // by text — one in the main content (header chrome), one in the
    // alertdialog. Scope to the alertdialog explicitly.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /next lesson/i })
      .click();

    // Wall opens with the next-lesson copy.
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toBeVisible();

    // Dismiss the wall.
    await page.getByRole("button", { name: /maybe later/i }).click();
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toHaveCount(0);

    // The celebration alertdialog should NOT still be mounted under
    // the wall. Pre-fix: clicking Next-Lesson left the celebration
    // mounted, so "Maybe later" then revealed it again, and the next
    // Esc would re-fire the wall in a re-trap loop. The persistent
    // header "Next Lesson →" button (which the page also renders for
    // an anon user — but routes to the wall on click — see LessonPage
    // showNext branch) doesn't count here; we want the CELEBRATION
    // dialog to be gone, not all next-lesson affordances on the page.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
});
