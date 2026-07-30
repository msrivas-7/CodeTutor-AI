// Phase A — A1: lesson 1's retrieval-check gate.
//
// The funnel-edge pedagogy fix introduces a `retrieval_check` completion
// rule on lesson 1: after the learner's stdout passes, they must answer
// a multiple-choice question before the celebration mounts. Without this
// gate the funnel measures clicks (paste → Run → Check → wall) instead
// of learning. This spec is the contract for the gate's behavior on
// the anon `/try/...` surface — celebration MUST NOT appear until the
// learner has answered the question correctly. After they answer, the
// next Check (which the panel re-fires automatically) flips into
// celebration via the existing path.
//
// Tests:
//   1. Gate mounts after Check passes the stdout/forbidden rules.
//   2. Wrong answer keeps the gate up; explanation surfaces.
//   3. Correct answer dismisses the gate, mounts celebration, and
//      persists the pass to localStorage so a returning learner
//      doesn't re-prove it.

import { expect, test } from "@playwright/test";

const PATH = "/try/lesson/python-fundamentals/hello-world";

test.describe("Phase A — A1 retrieval-check gate", () => {
  test.beforeEach(async ({ page }) => {
    // Skip cinematic + coach + walkthrough — the gate fires after Run +
    // Check, which is reachable on the working chrome.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      // Crucially DO NOT pre-seed retrievalPassed — that's exactly what
      // these tests exercise. Phase A scopes the key to the learner and
      // parks the anon variant in sessionStorage, so clear THAT one.
      window.sessionStorage.removeItem(
        "ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world",
      );
    });
    // Mock /api/anon/run with a passing-but-not-canonical greeting so
    // expected_stdout passes ("Hello, ") AND forbidden_in_stdout passes
    // (no literal "Hello, World!").
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

  test("Check pass with retrieval unanswered → celebration does NOT mount; question panel does", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /check/i }).first().click();

    // The retrieval question panel mounts — its question text is pulled
    // from lesson.json. Anchor on the unique substring.
    await expect(
      page.getByText(/what shows up on the screen/i),
    ).toBeVisible({ timeout: 10_000 });

    // Passing code is awaiting a learning checkpoint, not failing. The
    // coding-error banner and its language must stay absent.
    await expect(page.getByText(/not quite right/i)).toHaveCount(0);

    // The celebration alertdialog must NOT mount — its title is "Lesson
    // complete" (LessonCompletePanel). The gate is the only thing on
    // screen at this point.
    await expect(
      page.getByRole("dialog", { name: /lesson complete/i }),
    ).toHaveCount(0);
  });

  test("wrong answer keeps the gate up + surfaces the explanation", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /check/i }).first().click();
    await expect(
      page.getByText(/what shows up on the screen/i),
    ).toBeVisible({ timeout: 10_000 });

    // Wrong choice: lesson.json's correctIndex=1 is "Hello, World!".
    // Anchor on the wrong "Nothing — the quotes hide the text" choice.
    await page
      .getByRole("button", { name: /nothing — the quotes hide the text/i })
      .click();

    // Explanation copy from lesson.json should surface.
    await expect(
      page.getByText(/print\(\) shows the text BETWEEN the quotes/i),
    ).toBeVisible({ timeout: 5_000 });

    // Celebration still NOT mounted.
    await expect(
      page.getByRole("dialog", { name: /lesson complete/i }),
    ).toHaveCount(0);
  });

  test("correct answer dismisses the gate, mounts celebration, persists the pass", async ({
    page,
  }) => {
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /check/i }).first().click();
    await expect(
      page.getByText(/what shows up on the screen/i),
    ).toBeVisible({ timeout: 10_000 });

    // Correct choice — lesson.json's correctIndex=1 corresponds to the
    // literal "Hello, World!" string in the choices array.
    await page
      .getByRole("button", { name: /^Hello, World!$/i })
      .click();

    // Celebration mounts within the panel re-check tick.
    await expect(
      page.getByRole("dialog", { name: /lesson complete/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("dialog", { name: /lesson complete/i }),
    ).toBeVisible();

    // The pass persists so the learner doesn't re-prove it. On the anon
    // path that's sessionStorage under the "anon" scope — anonymous
    // visitors have no stable identity, so a session boundary is the
    // only isolation available and the next person on a shared device
    // answers the check themselves.
    const stored = await page.evaluate(() =>
      window.sessionStorage.getItem(
        "ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world",
      ),
    );
    expect(stored).toBe("1");
  });

  test("returning learner with a persisted pass skips the gate", async ({
    page,
  }) => {
    // Override the beforeEach init-script with a fresh one that DOES
    // pre-seed the pass. Playwright applies init scripts in order, so
    // the second one runs after the first — the first did .removeItem,
    // the second .setItem wins.
    await page.addInitScript(() => {
      window.sessionStorage.setItem(
        "ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world",
        "1",
      );
    });
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: /check/i }).first().click();

    // Celebration mounts immediately — the question panel does NOT
    // appear because the learner has already passed it.
    await expect(
      page.getByRole("dialog", { name: /lesson complete/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/what shows up on the screen/i),
    ).toHaveCount(0);
  });
});
