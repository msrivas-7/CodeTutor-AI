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
      // Phase A: the retrieval pass is scoped to the learner and, for
      // anon, lives in sessionStorage under the "anon" scope.
      window.sessionStorage.setItem("ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world", "1");
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

  test("reason='next-lesson' from the explicit continuation — distinct copy + dismiss", async ({
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
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toBeVisible({
      timeout: 10_000,
    });
    // Only the explicitly labelled continuation opens the wall.
    await page
      .getByRole("dialog", { name: /lesson complete/i })
      .getByRole("button", { name: /next lesson/i })
      .click();
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

  test("share artifact is usable above completion, then the honest post-share wall opens", async ({
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
    await page.route("**/api/anon/shares", async (route) => {
      const payload = route.request().postDataJSON() as {
        attemptCount: number;
        codeSnippet: string;
        mastery: string;
      };
      expect(payload.attemptCount).toBeGreaterThanOrEqual(1);
      expect(payload.codeSnippet).toContain("Hello, Maya!");
      expect(payload.mastery).toMatch(/strong|okay|shaky/);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          shareToken: "qualityshare1",
          url: "/s/qualityshare1",
        }),
      });
    });
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
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toBeVisible({
      timeout: 10_000,
    });
    // Click the share affordance inside the celebration. The
    // LessonCompletePanel renders Share as a button (the "Your first
    // one — Share it" card on lesson 1) — match its accessible name.
    // Scope to the celebration alertdialog so we don't catch a
    // persistent header chip.
    const celebrationShareButton = page
      .getByRole("dialog", { name: /lesson complete/i })
      .getByRole("button", { name: /share/i })
      .first();
    await celebrationShareButton.click();
    // The public-link dialog sits above the still-mounted completion
    // layer and its primary copy action is operable.
    const shareDialog = page.getByRole("dialog", { name: /your first one/i });
    await expect(shareDialog).toBeVisible({ timeout: 5_000 });
    await expect(shareDialog.getByRole("button", { name: /copy link/i })).toBeEnabled();
    await expect(page.locator('[data-modal-layer="60"]')).toBeVisible();
    await expect(page.locator('[data-modal-layer="55"]')).toBeVisible();

    // Only the top dialog owns the keyboard. Escape removes the share layer,
    // leaves completion intact, and restores focus to the button that opened
    // it. This protects the stacked-modal contract for keyboard users.
    await page.keyboard.press("Tab");
    await expect(shareDialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(shareDialog).toHaveCount(0);
    // The product contract intentionally follows any share-dialog dismissal
    // with the conversion wall. The completion layer must remain mounted under
    // that new top layer; a single Escape must never tear down both dialogs.
    await expect(page.locator('[data-modal-layer="55"]')).toBeVisible();
    await expect(page.getByText(/Your share link is ready/i)).toBeVisible();
    const dismissWall = page.getByRole("button", { name: /maybe later/i });
    await dismissWall.click();
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toBeVisible();
    await expect(celebrationShareButton).toBeFocused();

    await celebrationShareButton.click();
    await expect(shareDialog).toBeVisible({ timeout: 5_000 });
    await shareDialog.getByRole("button", { name: /^done$/i }).click();

    // The conversion ask now acknowledges the link already exists.
    await expect(page.getByText(/Your share link is ready/i)).toBeVisible({ timeout: 5_000 });
    // "Maybe later" dismiss copy (continuation framing).
    await expect(
      page.getByRole("button", { name: /maybe later/i }),
    ).toBeVisible();
    // Different from the other three reasons.
    await expect(page.getByText(/Sign up to save\?/i)).toHaveCount(0);
    await expect(page.getByText(/Lesson 2 is queued up/i)).toHaveCount(0);
    await expect(page.getByText(/You're getting it\./i)).toHaveCount(0);

    // Backdrop dismissal follows the same deterministic share -> wall
    // transition as Escape and Done. Click the exposed corner of the top
    // backdrop so the event target is the backdrop itself, not the panel.
    await page.getByRole("button", { name: /maybe later/i }).click();
    await celebrationShareButton.click();
    await expect(shareDialog).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-modal-layer="60"]').click({ position: { x: 2, y: 2 } });
    await expect(shareDialog).toHaveCount(0);
    await expect(page.getByText(/Your share link is ready/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
