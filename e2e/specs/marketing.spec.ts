// Public glyph homepage (`/`) e2e. Preserves Phase 22C acquisition contracts:
//   - anonymous visitor lands on / and sees the hero claim + nav
//   - the primary CTA starts the no-signup lesson; signup is secondary
//   - "Sign in" anchor leads to /login
//   - the walkthrough anchor reaches reversible Read / Ask / Check content
//   - logged-in users hitting / are NOT redirected; they see the
//     marketing page with a "Dashboard" affordance and a CTA that
//     points at /start with "Continue learning" copy
//   - reduced-motion path renders the final hero state statically
//   - mobile narrow viewport renders without horizontal overflow
//
// Anon-flow tests use the bare @playwright/test import (no auto-login
// fixture) so the page boots without a seeded Supabase session — the
// same posture a stranger from Product Hunt has. The single authed
// describe imports from ../fixtures/auth so the worker's session is
// injected before the page navigates.

import { expect, test } from "@playwright/test";
import { test as authedTest, expect as authedExpect } from "../fixtures/auth";

// The exact selected hero claim. If the operator picks a different
// candidate from heroCopy.ts, this assertion is the canary — update
// here in lockstep with SELECTED_HERO_INDEX.
const HERO_CLAIM = "AI that builds you, not the code";

test.describe("marketing page (Phase 22C) — anonymous", () => {
  test("anonymous visitor sees the hero claim, subhead, and CTAs", async ({
    page,
  }) => {
    await page.goto("/");

    // Hero claim — pinned to the exact selected text. Loose regex
    // assertions silently accept any candidate; this catches an
    // accidental SELECTED_HERO_INDEX flip.
    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toBeVisible({ timeout: 5_000 });
    await expect(hero).toHaveText(HERO_CLAIM);

    // The linked walkthrough is authored HTML, never a simulated live AI call.
    await expect(
      page.getByText("Illustrative walkthrough · not live AI"),
    ).toBeVisible();
    await expect(page.getByText("average.py", { exact: true })).toBeVisible();

    // Primary CTA (in-hero). Two CTAs on the page (hero + repeat) —
    // both share the label, so .first() is fine.
    const heroCta = page.getByRole("link", { name: /try your first lesson/i });
    await expect(heroCta.first()).toBeVisible();
    const heroHref = await heroCta.first().getAttribute("href");
    expect(heroHref).toMatch(/\/try\/lesson\/python-fundamentals\/hello-world/);
    await expect(
      page.getByRole("link", { name: /create an account/i }),
    ).toHaveAttribute("href", /\/signup/);

    // Top-right Sign in anchor (in the marketing nav).
    const signIn = page.getByRole("link", { name: /^sign in$/i }).first();
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", /\/login/);
  });

  test("clicking the primary CTA navigates directly to the no-signup lesson", async ({
    page,
  }) => {
    await page.goto("/");
    const cta = page
      .getByRole("link", { name: /try your first lesson/i })
      .first();
    await cta.click();
    await expect(page).toHaveURL(
      /\/try\/lesson\/python-fundamentals\/hello-world$/,
    );
  });

  test("cinematic introduction never gates the primary action or traps scrolling", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.goto("/");
    const cta = page
      .getByRole("link", { name: /try your first lesson/i })
      .first();
    await expect(cta).toBeVisible();
    // Approved redesign puts the artwork before the headline/CTA. Verify
    // access instead of retaining the superseded above-the-fold composition.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeInViewport();
    await cta.click();
    await expect(page).toHaveURL(
      /\/try\/lesson\/python-fundamentals\/hello-world$/,
    );
    await context.close();
  });

  test("the linked Read Ask Check walkthrough is reversible and useful", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /See how learning happens/ }).click();
    await expect(page).toHaveURL(/#study-demo$/);
    const stages = page.getByRole("group", { name: "Walkthrough stages" });
    await stages.getByRole("button", { name: /Ask/ }).click();
    await expect(page.getByText(/Trace total after each pass/)).toBeVisible();
    await stages.getByRole("button", { name: /Check/ }).click();
    await expect(page.locator(".study-output samp")).toHaveText("8.0");
    await expect(
      page.getByText(/Assignment kept only the last score/),
    ).toBeVisible();
    await stages.getByRole("button", { name: /Read/ }).click();
    await expect(page.locator(".study-output samp")).toHaveText(
      "3.3333333333333335",
    );
    await expect(stages.getByRole("button", { name: /Read/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("essential How-it-works copy is never animation-gated at zero opacity", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.locator("#study-demo");
    const hiddenEssential = await section
      .locator("h3, p")
      .evaluateAll(
        (nodes) =>
          nodes.filter(
            (node) => Number.parseFloat(getComputedStyle(node).opacity) === 0,
          ).length,
      );
    expect(hiddenEssential).toBe(0);
  });

  test("OG meta and document title carry the new hero claim", async ({
    page,
  }) => {
    await page.goto("/");
    // Title is the hero claim + brand suffix. Drift away from this
    // copy fails the test loud.
    await expect(page).toHaveTitle(/AI that builds you, not the code/);

    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(ogTitle).toMatch(/AI that builds you, not the code/);

    const ogDesc = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    // Description should name the audience, the mechanism, the
    // languages, and a restatement of the USP — the four things a
    // sharer expects in an unfurl.
    expect(ogDesc).toMatch(/beginner/i);
    expect(ogDesc).toMatch(/hints? (and|&) questions?|never gives|walks you/i);
    expect(ogDesc).toMatch(/python.*javascript/i);

    // Cache-busted OG image — bumping ?v= forces social-card crawlers
    // to re-fetch even if they had a stale entry. Verify both meta
    // references stay in lockstep.
    const ogImage = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(ogImage).toMatch(/og-image\.png\?v=/);
    const twImage = await page
      .locator('meta[name="twitter:image"]')
      .getAttribute("content");
    expect(twImage).toBe(ogImage);
  });
});

test.describe("marketing page (Phase 22C) — reduced motion", () => {
  for (const interruption of ["reduced motion", "context loss"] as const) {
    test(`hands focused artwork to the headline on ${interruption}`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto("/");
      const artwork = page.getByRole("button", {
        name: /gently rotate the code glyphs/i,
      });
      await expect(artwork).toBeVisible();
      await artwork.focus();
      await expect(artwork).toBeFocused();
      if (interruption === "reduced motion") {
        await page.emulateMedia({ reducedMotion: "reduce" });
      } else {
        const lost = await page
          .locator(".motion-study-canvas canvas")
          .evaluate((canvas) => {
            const extension = (canvas as HTMLCanvasElement)
              .getContext("webgl2")
              ?.getExtension("WEBGL_lose_context");
            extension?.loseContext();
            return !!extension;
          });
        expect(lost).toBe(true);
      }
      await expect(artwork).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      // macOS WebKit defaults to skipping links with plain Tab; Option-Tab
      // is Apple's documented full-navigation shortcut (Safari cpsh003).
      await page.keyboard.press(
        browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
      );
      await expect(
        page.getByRole("link", { name: /try your first lesson/i }).first(),
      ).toBeFocused();
    });
  }

  test("responds to a live reduced-motion change without losing demo state", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("group", { name: "Walkthrough stages" })
      .getByRole("button", { name: /Check/ })
      .click();
    const check = page.getByRole("button", { name: "03 Check" });
    await check.focus();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".motion-study-canvas canvas")).toHaveCount(0);
    await expect(page.locator("[data-field-interaction]")).toHaveCount(0);
    await expect(page.locator(".study-output samp")).toHaveText("8.0");
    await expect(check).toBeFocused();
    await expect(
      page.getByRole("button", { name: /pause animation/i }),
    ).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator(".study-output samp")).toHaveText("8.0");
    await expect(
      page.getByRole("link", { name: /try your first lesson/i }).first(),
    ).toHaveAttribute("href", /\/try\/lesson\//);
  });

  test("graphics module failure leaves content usable and reload recovers", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.route("**/ParticleField*", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByText(/Motion could not load/)).toBeVisible();
    await page
      .getByRole("group", { name: "Walkthrough stages" })
      .getByRole("button", { name: /Ask/ })
      .click();
    await expect(page.getByText(/Trace total after each pass/)).toBeVisible();
    await page.unroute("**/ParticleField*");
    await page.getByRole("button", { name: "Reload page" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      HERO_CLAIM,
    );
    await expect(page.getByText(/Motion could not load/)).toHaveCount(0);
    await expect(
      page
        .getByRole("group", { name: "Walkthrough stages" })
        .getByRole("button", { name: /Read/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("renders the hero in its final state statically", async ({ page }) => {
    // Force the prefers-reduced-motion media query BEFORE navigation so
    // the very first render of MatchCutHero sees `reduce === true` and
    // skips the timed beat schedule. (A `test.use({ reducedMotion })`
    // fixture wrapper in this describe wasn't always propagating to the
    // page in time — emulateMedia is the explicit hammer.)
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // Hero claim still visible (no fade-in obscuring it).
    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toBeVisible({ timeout: 3_000 });
    await expect(hero).toHaveText(HERO_CLAIM);

    await expect(page.locator(".motion-study-canvas canvas")).toHaveCount(0);
    await expect(page.locator("[data-field-interaction]")).toHaveCount(0);
    await expect(page.locator(".study-still")).toHaveCount(3);
    await expect(
      page.getByRole("heading", { name: "Find the average score" }),
    ).toBeVisible();

    // CTA still functions.
    const cta = page
      .getByRole("link", { name: /try your first lesson/i })
      .first();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("360px viewport has no essential horizontal overflow", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
    await context.close();
  });
});

test.describe("marketing page (Phase 22C) — mobile viewport", () => {
  // iPhone 13 portrait dimensions. Setting just the viewport (rather
  // than `...devices["iPhone 13"]`) sidesteps Playwright's "can't
  // change defaultBrowserType inside describe" constraint.
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("keeps animation across phone sizes and stops only for reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const canvas = page.locator(".motion-study-canvas canvas");
    const artwork = page.getByRole("button", {
      name: /gently rotate the code glyphs/i,
    });
    await expect(artwork).toBeVisible();
    await expect(canvas).toHaveCount(1);
    await artwork.focus();
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 320, height: 568 },
      { width: 320, height: 740 },
      { width: 430, height: 932 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(artwork).toBeFocused();
      await expect(canvas).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (viewport.width <= 640) {
        // UX-224: the old 210px hero collapsed the renderer's departure
        // interval to 1px. Protect usable scroll space, not a CSS constant.
        const pacing = await page.evaluate(() => {
          const hero = document.querySelector(".study-hero-art")!.getBoundingClientRect();
          const copy = document.querySelector(".study-hero-copy")!.getBoundingClientRect();
          const assembledAt = Math.max(0, hero.top + scrollY + hero.height / 2 - innerHeight / 2);
          const clearAt = Math.max(assembledAt + 1, copy.top + scrollY - innerHeight * 0.55);
          return {
            departure: (clearAt - assembledAt) / innerHeight,
            chapters: [...document.querySelectorAll(".study-chapter-art, .study-closing-art")]
              .map(element => element.getBoundingClientRect().height / innerHeight),
          };
        });
        expect(pacing.departure).toBeGreaterThan(0.3);
        expect(pacing.chapters.every(height => height >= 0.6)).toBe(true);
      }
    }
    // The artwork must not capture vertical touch scrolling.
    await expect(artwork).toHaveCSS("touch-action", "pan-y");
    await page.getByRole("button", { name: "03 Check" }).tap();
    await expect(page.locator(".study-output samp")).toHaveText("8.0");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(canvas).toHaveCount(0);
    await expect(artwork).toHaveCount(0);
    await expect(page.locator(".study-still").first()).toBeVisible();
    await expect(page.locator(".study-output samp")).toHaveText("8.0");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(canvas).toHaveCount(1);
    await expect(artwork).toBeVisible();
    await expect(page.locator(".study-output samp")).toHaveText("8.0");
  });

  test("renders without horizontal overflow at iPhone 13 width", async ({
    page,
  }) => {
    await page.goto("/");

    const hero = page.getByRole("heading", { level: 1 });
    await expect(hero).toBeVisible({ timeout: 5_000 });
    await expect(hero).toHaveText(HERO_CLAIM);

    // Document width should equal viewport width — any overflow means
    // the typography clamp or panel layout broke at narrow widths.
    const { docWidth, viewportWidth } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(docWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // CTA is still tappable at the smallest breakpoint.
    const cta = page
      .getByRole("link", { name: /try your first lesson/i })
      .first();
    await expect(cta).toBeVisible();
  });
});

authedTest.describe("marketing page (Phase 22C) — authed nav swap", () => {
  authedTest(
    "logged-in user sees the Dashboard nav button (no redirect)",
    async ({ page }) => {
      // Phase 22C revision: `/` is the marketing page for everyone.
      // Logged-in visitors should NOT be redirected; they should see
      // the marketing surface with a "Dashboard" affordance in the nav
      // instead of "Sign in". Pattern matches Linear / Stripe / Vercel.
      await page.goto("/");
      await authedExpect(page).toHaveURL(/\/$/, { timeout: 5_000 });

      const dashboard = page.getByRole("link", { name: /^dashboard/i });
      await authedExpect(dashboard).toBeVisible({ timeout: 5_000 });
      await authedExpect(dashboard).toHaveAttribute("href", /\/start/);
    },
  );

  authedTest("clicking Dashboard navigates to /start", async ({ page }) => {
    await page.goto("/");
    // The URL assertion below owns navigation readiness. Avoid making the
    // click also wait for every scheduled navigation because the public-app
    // auth handoff can replace the active React subtree during that wait.
    await page.getByRole("link", { name: /^dashboard/i }).click({
      noWaitAfter: true,
    });
    await authedExpect(page).toHaveURL(/\/start$/, { timeout: 5_000 });
  });

  authedTest(
    "primary CTA reads 'Continue learning' and points at /start when authed",
    async ({ page }) => {
      // The hero CTA must mirror the nav's auth-awareness — a returning
      // logged-in user clicking the giant gradient pill should land in
      // the product, not on a redundant signup form.
      await page.goto("/");
      const cta = page
        .getByRole("link", { name: /continue learning/i })
        .first();
      await authedExpect(cta).toBeVisible({ timeout: 5_000 });
      await authedExpect(cta).toHaveAttribute("href", /\/start/);
    },
  );
});
