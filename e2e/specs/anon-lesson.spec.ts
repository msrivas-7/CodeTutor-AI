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
  // Phase 27-v2 Day 2: AnonLessonPage now mounts the full first-run
  // CinematicGreeting overlay (fixed inset-0 z-[60]) on first /try/
  // visit, dissolving after ~14.5s. That overlay obstructs every
  // click target the lesson-1 specs care about — Save / Next-lesson
  // buttons, the mobile instructions toggle, and so on. Pre-set the
  // sessionStorage flag the page reads so the cinematic short-circuits
  // before mount; the cinematic itself gets its own dedicated test
  // below ("plays full cinematic on first visit"). Using addInitScript
  // (not localStorage) so each Playwright context, which gets a fresh
  // sessionStorage, starts in the "already seen" state — matching the
  // behaviour of a same-tab reload after the cinematic dismissed.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      // Phase 27-v2 Day 6: WorkspaceCoach now also fires on /try/
      // after the cinematic. Seed its sessionStorage flag too so
      // the chrome-presence tests below aren't obstructed by the
      // 6-step tour. The coach's own behavior is exercised by the
      // dedicated "first-run cinematic on /try/" test below.
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    });
  });

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
    // Phase 27-v2 Day 3b: choreography fires synchronously after the
    // cinematic seed short-circuits, so during the scripted greet/run/
    // praise arc the placeholder reads "Tutor's mid-thought — give
    // them a sec…". After step==="done" it falls back to "What's
    // confusing you?". Either string is acceptable for this test —
    // we're verifying the input affordance is present, not which
    // scripted phase Maya happens to be in when Playwright assertions
    // hit. The Esc-skip cinematic test (`first-run cinematic on /try/`
    // describe below) covers the dismissed-state flow explicitly.
    await expect(
      page.getByPlaceholder(/What's confusing you|Tutor's mid-thought/i),
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

  // Phase 27-v2 Day 3c: the "Next lesson →" button was removed from
  // the bottom CTA row. Post-completion the celebration block's
  // "Sign up to keep going →" CTA writes the anon stash and opens
  // the wall with reason="next-lesson". The full Run → edit → Run →
  // Check → celebration → click sequence is the Day 5 anon→signup→
  // lesson-2 e2e's job; we don't have a driven flow here today
  // because it requires a real /api/anon/run round-trip + scripted
  // choreography wait that this navigation-only spec was never
  // designed to host. The previous test that asserted the bottom-row
  // "Next lesson →" button was deleted with this commit — it tested
  // a button that no longer exists. Day 5 adds the replacement.

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
    // The describe-level beforeEach pre-seeds the test-fixture page
    // via addInitScript; this test uses a freshly-created context so
    // we must reapply the seed manually. Same purpose: short-circuit
    // the cinematic so the lesson-chrome assertions can run.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      // Phase 27-v2 Day 6: WorkspaceCoach now also fires on /try/
      // after the cinematic. Seed its sessionStorage flag too so
      // the chrome-presence tests below aren't obstructed by the
      // 6-step tour. The coach's own behavior is exercised by the
      // dedicated "first-run cinematic on /try/" test below.
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    });
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

test.describe("first-run cinematic on /try/ (Phase 27-v2 Day 2)", () => {
  // Phase 27-v2: Maya's hero moment moves OFF /welcome and ONTO /try/.
  // The full 14.2s CinematicGreeting (mode="full", firstName="there",
  // heroLine="Hello, there!") plays inline, then dissolves to reveal the
  // lesson workspace below. Once dismissed (auto or skip), the
  // sessionStorage flag prevents replay on same-tab nav. A NEW tab
  // gets a fresh cinematic — that's the design.

  test("cinematic plays on first visit and is dismissable via Esc", async ({
    page,
  }) => {
    // Cold context — sessionStorage starts empty so the cinematic
    // should mount. Don't apply the describe-level seed.
    await page.goto(ALLOWED_PATH);

    // The cinematic's wrapper has a "Skip" affordance bottom-right
    // and the hero hits "Hello, there!" mid-arc. Skip is the fast,
    // deterministic dismiss path.
    const skipButton = page.getByRole("button", { name: /skip/i });
    await expect(skipButton).toBeVisible({ timeout: 6_000 });

    // Mid-arc hero text actually renders. The hero string types in
    // around the 7.3s mark of the FULL_TIMELINE; assert on it to
    // catch any future regression that ships the cinematic mount
    // without populating the heroLine prop. Generous timeout because
    // typewriter beat lands ~9.3s in (heroType + heroGlow + heroHold
    // are spread across that window). On anon path heroLine is
    // "Hello, there!" — matches lesson 1's stdout shape, not a name
    // (option d in v2 plan: name lands at the praise turn instead).
    await expect(page.getByText("Hello, there!", { exact: true })).toBeVisible({
      timeout: 12_000,
    });

    // Esc dismisses the cinematic immediately (handleSkipOnce path).
    await page.keyboard.press("Escape");

    // After Esc, the lesson workspace is visible. The "Try it — no signup"
    // badge in the header is the canary that anon-mode is now active.
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible({
      timeout: 5_000,
    });

    // Same-tab reload — cinematic should NOT replay because the
    // markCinematicSeen() flag was stamped on dismiss.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    // Skip button should NOT be present after reload (cinematic short-
    // circuited by sessionStorage flag).
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0);
  });

  test("WorkspaceCoach auto-opens on /try/ after cinematic dismisses", async ({
    page,
  }) => {
    // Phase 27-v2 Day 6: brand-new tab → cinematic plays → cinematic
    // dismisses → WorkspaceCoach 6-step tour mounts BEFORE the
    // scripted walkthrough fires. The plan calls this "no
    // orientation surface fires twice for the same user": coach
    // shows once on anon (now), gets stashed as workspaceCoachDone,
    // and lesson 2 (post-signup) does NOT replay it.
    //
    // Seed the cinematic-seen flag (skip the 14s) but NOT the
    // coach-seen flag, so we land directly on the coach's first
    // step.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
    });
    await page.goto(ALLOWED_PATH);

    // The coach's first step bubble carries the "Lesson Instructions"
    // title + body — assert on the title text. Generous timeout
    // because the coach mounts only after lesson loads + the
    // useEffect-driven spotlight rect resolves on the instructions
    // anchor element.
    await expect(
      page.getByText(/Lesson Instructions/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Esc dismisses the coach (parity with /welcome → /learn cinematic).
    await page.keyboard.press("Escape");

    // After dismiss the coach is gone; lesson chrome is unobstructed.
    await expect(page.getByText(/Lesson Instructions/i)).toHaveCount(0);
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();

    // Same-tab reload — coach should NOT replay (markCoachSeenAnon
    // stamps sessionStorage).
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Lesson Instructions/i)).toHaveCount(0);
  });

  test("cinematic auto-completes within budget, revealing the lesson workspace", async ({
    page,
  }) => {
    // The full timeline is 14_200ms + 300ms exit blur. If a future
    // refactor strips the setTimeout that fires onComplete, the
    // Esc-dismiss test still passes (user clicks). This test exercises
    // the natural-completion path so the auto-reveal contract has
    // direct coverage. 18s budget is the timeline + exit + safety.
    //
    // Ordering matters: assert the Skip button disappears FIRST with
    // the 18s timeout. The "Try it — no signup" header badge sits in
    // the DOM behind the cinematic overlay (z-[60] fixed inset-0 does
    // NOT make the badge invisible to Playwright's toBeVisible — it
    // only obstructs clicks). If we asserted the badge first, that
    // assertion passes immediately on lesson load (~2-3s) and the
    // following Skip-count check would then retry only against the
    // global expect.timeout (10s in playwright.config.ts) — too short
    // for the 14.5s cinematic to actually dissolve. Flip-flop.
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0, {
      timeout: 18_000,
    });
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();
  });
});

test.describe("marketing CTA → anonymous lesson (Phase 27 §3a sub-commit 3)", () => {
  // Same cinematic-suppression seed as the lesson-chrome describe.
  // The h1 text-content assertions below would technically pass even
  // with the cinematic mounted (heading is in the DOM behind the
  // overlay), but seeding makes the suite uniformly fast and avoids
  // anyone reading these tests assuming "h1 visible" includes
  // "h1 unobstructed."
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      // Phase 27-v2 Day 6: WorkspaceCoach now also fires on /try/
      // after the cinematic. Seed its sessionStorage flag too so
      // the chrome-presence tests below aren't obstructed by the
      // 6-step tour. The coach's own behavior is exercised by the
      // dedicated "first-run cinematic on /try/" test below.
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    });
  });

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
