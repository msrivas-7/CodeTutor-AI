// Phase 27-v2.1 — SignupWallDialog reasons coverage.
//
// The wall fires from three call sites with three reason codes:
//
//   reason="save"        — header "Sign up to save" pill click. Copy:
//                          "Sign up to save?" / "Takes 10 seconds.
//                          From the moment you sign up, your code and
//                          progress save automatically..." / "Sign up
//                          for free"
//   reason="next-lesson" — celebration dismiss / Next Lesson click /
//                          header in-page Next Lesson click / practice
//                          start (medium-lock). Copy: "Lesson 2 is
//                          queued up." / "Save your spot — takes 10
//                          seconds..." / "Start lesson 2" / "Maybe
//                          later" (dismiss link)
//   reason="exhausted"   — anon AI 429 ANON_EXHAUSTED. Copy: "You're
//                          getting it." / "free tutor questions" /
//                          "Sign up for free"
//
// This spec verifies all three reasons render distinct, on-brand
// copy. It catches:
//   - Copy collision (two reasons accidentally sharing a CTA)
//   - Default-reason fallback bug (an unset reason rendering "save")
//   - Missing route to a reason (e.g., medium-lock dismiss not firing
//     reason="next-lesson")

import { expect, test } from "@playwright/test";

const PATH = "/try/lesson/python-fundamentals/hello-world";

const SEED_FLAGS = `
  window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
  window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
  window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
  // Phase A — A1: pre-seed retrieval-pass so Check goes straight to
  // celebration. The retrieval gate has its own dedicated spec.
  window.localStorage.setItem(
    "ui:lesson:retrievalPassed:python-fundamentals:hello-world",
    "1",
  );
`;

test.describe("Phase 27-v2.1 — SignupWallDialog reasons coverage", () => {
  test("reason='save' from header pill — 'Sign up to save?' headline", async ({
    page,
  }) => {
    await page.addInitScript(SEED_FLAGS);
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /sign up to save/i }).click();
    await expect(page.getByText(/Sign up to save\?/i)).toBeVisible();
    // Different from next-lesson copy.
    await expect(page.getByText(/Lesson 2 is queued up/i)).toHaveCount(0);
  });

  test("reason='next-lesson' from celebration dismiss — 'Lesson 2 is queued up.' headline + 'Maybe later' dismiss", async ({
    page,
  }) => {
    await page.addInitScript(SEED_FLAGS);
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
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: /run/i })
      .first()
      .click();
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
    // Dismiss celebration — wall opens with next-lesson copy.
    await page.keyboard.press("Escape");
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toBeVisible();
    // Specific dismiss copy for THIS reason: "Maybe later" (not "Not yet").
    await expect(
      page.getByRole("button", { name: /maybe later/i }),
    ).toBeVisible();
    // Different from save / exhausted copy.
    await expect(page.getByText(/Sign up to save\?/i)).toHaveCount(0);
    await expect(page.getByText(/You're getting it\./i)).toHaveCount(0);
  });

  test("reason='exhausted' from L_anon 429 — 'You're getting it.' headline", async ({
    page,
  }) => {
    await page.addInitScript(SEED_FLAGS);
    await page.route("**/api/anon/ai/ask/stream", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "ANON_EXHAUSTED" }),
      }),
    );
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    const textarea = page.getByLabel(/ask the tutor/i);
    await textarea.fill("hello");
    await textarea.press("Enter");
    await expect(page.getByText(/You're getting it\./i)).toBeVisible({
      timeout: 5_000,
    });
    // Different from save / next-lesson copy.
    await expect(page.getByText(/Sign up to save\?/i)).toHaveCount(0);
    await expect(page.getByText(/Lesson 2 is queued up/i)).toHaveCount(0);
  });

  test("reason='share' from celebration share card — 'Sign up to share your first program' headline + 'Maybe later' dismiss", async ({
    page,
  }) => {
    // Phase 27-v2.2 Fix 1 — anon share lever. The pre-fix behavior
    // hid the share card on anon entirely (mode === "authed" gate);
    // the fix keeps it visible and pivots clicks to the wall with
    // reason="share". Tests:
    //   1. Share card is reachable on anon celebration
    //   2. Click opens wall with the share copy
    //   3. Dismiss link reads "Maybe later" (continuation framing,
    //      same as next-lesson, not "Not yet" punchier framing)
    //   4. Wall copy is distinct from save / next-lesson / exhausted
    await page.addInitScript(SEED_FLAGS);
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
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: /run/i })
      .first()
      .click();
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
    // Click the share affordance inside the celebration. The
    // LessonCompletePanel renders Share as a button (the "Your first
    // one — Share it" card on lesson 1) — match its accessible name.
    // Scope to the celebration alertdialog so we don't catch a
    // persistent header chip.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /share/i })
      .first()
      .click();
    // Wall opens with the share-specific copy.
    await expect(
      page.getByText(/Sign up to share your first program/i),
    ).toBeVisible({ timeout: 5_000 });
    // "Maybe later" dismiss copy (continuation framing).
    await expect(
      page.getByRole("button", { name: /maybe later/i }),
    ).toBeVisible();
    // Different from the other three reasons.
    await expect(page.getByText(/Sign up to save\?/i)).toHaveCount(0);
    await expect(page.getByText(/Lesson 2 is queued up/i)).toHaveCount(0);
    await expect(page.getByText(/You're getting it\./i)).toHaveCount(0);
  });
});
