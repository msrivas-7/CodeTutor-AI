// Phase 22C: marketing page (`/`) e2e. Exercises:
//   - anonymous visitor lands on / and sees the hero claim + nav
//   - CTAs are present, link to /signup
//   - "Sign in" anchor leads to /login
//   - "How it works" anchor smooth-scrolls to the Section 2 content
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

    // Match-cut panel renders a JetBrains Mono code line — the typewriter
    // is mid-animation when the assertion runs, so we assert on the string
    // literal "Maya" we know lands within the first ~250ms (line 1 of
    // the new Python TypeError beat).
    const monoLine = page.getByText(/Maya/, { exact: false });
    await expect(monoLine.first()).toBeVisible({ timeout: 5_000 });

    // Primary CTA (in-hero). Two CTAs on the page (hero + repeat) —
    // both share the label, so .first() is fine.
    const heroCta = page.getByRole("link", { name: /start your first lesson/i });
    await expect(heroCta.first()).toBeVisible();
    const heroHref = await heroCta.first().getAttribute("href");
    expect(heroHref).toMatch(/\/signup/);

    // Top-right Sign in anchor (in the marketing nav).
    const signIn = page.getByRole("link", { name: /^sign in$/i }).first();
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", /\/login/);
  });

  test("clicking the primary CTA navigates to /signup", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: /start your first lesson/i }).first();
    await cta.click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("the three How-it-works beats render below the hero", async ({
    page,
  }) => {
    await page.goto("/");
    // Force the section into viewport for assertion. JSDOM-style hash
    // anchors are flakey under Lenis smooth-scroll; we scroll the
    // element into view directly instead.
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();

    await expect(page.getByRole("heading", { name: "Read." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ask." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check." })).toBeVisible();
  });

  test("essential How-it-works copy is never animation-gated at zero opacity", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#how-it-works");
    const hiddenEssential = await section.locator("h3, p").evaluateAll((nodes) =>
      nodes.filter((node) => Number.parseFloat(getComputedStyle(node).opacity) === 0).length,
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

    // The match-cut panel skips its scheduled beats and renders the
    // final state directly — code visible AND tutor question visible
    // from first paint, no waiting on the ~8.4s play-through.
    await expect(page.getByText(/Maya/).first()).toBeVisible({
      timeout: 3_000,
    });
    await expect(
      page.getByText(/Why does this fail when points is 100\?/),
    ).toBeVisible({ timeout: 3_000 });

    // CTA still functions.
    const cta = page
      .getByRole("link", { name: /start your first lesson/i })
      .first();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("360px viewport has no essential horizontal overflow", async ({ browser }) => {
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
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

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
      .getByRole("link", { name: /start your first lesson/i })
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

  authedTest(
    "clicking Dashboard navigates to /start",
    async ({ page }) => {
      await page.goto("/");
      await page.getByRole("link", { name: /^dashboard/i }).click();
      await authedExpect(page).toHaveURL(/\/start$/, { timeout: 5_000 });
    },
  );

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
