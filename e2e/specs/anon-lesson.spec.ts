// Phase 27 §3a — anonymous lesson 1 e2e.
//
// Exercises the no-signup entry point that lets a TikTok-arrival
// visitor reach lesson 1 without an account. Pure navigation +
// render + sign-up wall coverage; the actual /api/anon/run + the
// /api/anon/ai/ask/stream calls require docker-compose backend +
// platform key and are exercised separately by the sandbox-egress
// spec (run path) and a future anon-AI integration spec.
//
// Anonymous fixture: bare @playwright/test (no auto-login). The
// /try/lesson/* route is OUTSIDE AuthedLayout, so RequireAuth
// never gates this surface — the page renders for unauthenticated
// browsers exactly as Maya would see it from a TikTok link.

import { expect, test } from "@playwright/test";

const ALLOWED_PATH = "/try/lesson/python-fundamentals/hello-world";

test.describe("anonymous lesson 1 (Phase 27 §3a)", () => {
  test("anonymous visitor lands, sees the title + editor + Run button + tutor input", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);

    // Lesson title — uses the same string that lives in the lesson
    // JSON (`Hello, World!`). The h1 from the AnonLessonPage; if a
    // future change demotes the title to h2 or restructures, this
    // assertion fails loudly.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Hello, World!/i,
      { timeout: 10_000 },
    );

    // The "Try it — no signup" badge in the header anchors the
    // anon-mode framing; if it disappears, the page may have
    // accidentally shifted into the authed lesson surface.
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();

    // Run button appears once Monaco mounts. It's labeled with a
    // visible "▶ Run" glyph.
    await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Tutor input — the "Stuck? Ask the tutor" affordance must be
    // reachable without scrolling on desktop. Maya's persona check.
    await expect(page.getByText(/Stuck\? Ask the tutor/i)).toBeVisible();
    await expect(
      page.getByPlaceholder(/What's confusing you\?/i),
    ).toBeVisible();
  });

  test("clicking Save opens the signup wall with the save-frame copy", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The "Save" button at the bottom of the editor column. There's
    // also a top-right "Sign up to save" pill; both should open the
    // wall with reason="save". Click the bottom one — it's the one
    // a user actively trying to keep their work would reach.
    await page.getByRole("button", { name: /^save$/i }).click();

    // Wall renders as role=alertdialog with aria-labelledby targeting
    // the title. The "save" reason title is "Sign up to save?".
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Sign up to save\?/i)).toBeVisible();

    // CTA links to /signup; "Not yet" dismisses.
    await expect(
      dialog.getByRole("link", { name: /sign up for free/i }),
    ).toHaveAttribute("href", "/signup");

    // Esc dismisses (parity with every other modal in the product).
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("clicking 'Next lesson' opens the wall with the keep-going frame", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /next lesson/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // The "next-lesson" reason title is "Keep going?".
    await expect(dialog.getByText(/Keep going\?/i)).toBeVisible();
  });

  test("non-allowlisted lesson path redirects to /", async ({ page }) => {
    // The allowlist locks anon to python-fundamentals/hello-world.
    // Any other (courseId, lessonId) pair short-circuits via Navigate
    // before backend even gets a chance to 403, so the URL ends up at /.
    await page.goto("/try/lesson/python-fundamentals/variables");
    // Marketing page renders at /. The hero claim is the canary.
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });
  });

  test("mobile: instructions collapse by default; toggle expands them", async ({
    browser,
  }) => {
    // iPhone 13 portrait viewport, hasTouch — mirrors the marketing
    // spec's mobile pattern. Maya's actual surface.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(ALLOWED_PATH);

    // Title visible at the top — always.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The full markdown body lives inside #anon-lesson-instructions,
    // which has `hidden md:block` until the toggle is clicked. The
    // mobile toggle "Show instructions ↓" is visible on phone widths.
    const toggle = page.getByRole("button", { name: /show instructions/i });
    await expect(toggle).toBeVisible();

    // Click to expand — the toggle label flips, and the # Hints /
    // ## What you'll learn body becomes visible. Use a known string
    // from the lesson's content.md.
    await toggle.click();
    await expect(
      page.getByRole("button", { name: /hide instructions/i }),
    ).toBeVisible();
    await expect(page.getByText(/What you'll learn/i)).toBeVisible();

    await ctx.close();
  });
});

test.describe("marketing CTA → anonymous lesson (Phase 27 §3a sub-commit 3)", () => {
  test("anonymous visitor on / sees the 'Or try a lesson — no signup →' link pointing at /try/...", async ({
    page,
  }) => {
    await page.goto("/");
    // Wait for hydration so the loading-state spacer resolves.
    const tryLink = page.getByRole("link", {
      name: /or try a lesson — no signup/i,
    });
    await expect(tryLink).toBeVisible({ timeout: 10_000 });
    await expect(tryLink).toHaveAttribute(
      "href",
      "/try/lesson/python-fundamentals/hello-world",
    );
  });

  test("clicking the try-link navigates to the anonymous lesson", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /or try a lesson — no signup/i })
      .click();
    await expect(page).toHaveURL(new RegExp(ALLOWED_PATH.replace(/\//g, "\\/")));
    // And the page actually mounted, not an error fallback.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Hello, World!/i,
      { timeout: 10_000 },
    );
  });
});
