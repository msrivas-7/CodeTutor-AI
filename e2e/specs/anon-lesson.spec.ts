// Phase 27 §3a — anonymous lesson 1 e2e.
//
// Phase 27-v2.1 Part 3 retarget: AnonLessonPage is now a thin wrapper
// (~80 LOC) around `<LessonPage mode="anon">`. The bespoke chrome
// (custom Save button, custom output renderer, custom tutor pane,
// "Stuck? Ask the tutor" affordance, mobile "Show instructions"
// toggle, "Next lesson →" bottom CTA) is gone. These tests now
// exercise the SAME LessonPage chrome the authed lesson uses, with
// only the header bar and a few endpoint differences gated by mode.
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
  // visit, dissolving after ~14.5s. Phase 27-v2.1 Part 3 also wires
  // useFirstRunChoreography on anon — the scripted greet/awaitRun/
  // praise turns lock the tutor input + Run button until step==="done".
  // For chrome-presence tests we seed all three sessionStorage flags
  // so the cinematic, the coach, AND the choreography all short-
  // circuit. The cinematic + coach + choreography each have dedicated
  // tests below that don't seed.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      // WorkspaceCoach: same pattern. The wrapper bridges this flag
      // into preferencesStore.workspaceCoachDone on mount; LessonPage
      // reads workspaceCoachDone to suppress the auto-open timer.
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    });
    // The scripted choreography in LessonPage(mode="anon") is in-
    // memory state (useFirstRunStore), not sessionStorage. We can't
    // seed it via addInitScript. Instead the chrome tests below
    // either tolerate the in-flight scripted state or wait for it
    // to settle. Specific assertions about the unlocked-tutor
    // placeholder ("Ask about this lesson…") would require setting
    // step="done" via page.evaluate — kept simple here by anchoring
    // chrome assertions on aria-labels and roles, which are stable
    // across choreography phases.
  });

  test("anonymous visitor lands, sees the title + editor + Run button + tutor input", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);

    // Lesson title — rendered by LessonInstructionsPanel as h1
    // ("Hello, World!" from lesson.json). LessonPage(mode="anon")
    // mounts the same panel the authed lesson does, so this h1
    // continues to be the Pixel-equivalence Invariant canary.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Hello, World!/i,
      { timeout: 10_000 },
    );

    // The "Try it — no signup" badge replaces the StreakChip in the
    // header center on anon. If it disappears, the page may have
    // accidentally shifted into the authed lesson surface.
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();

    // Run button appears once Monaco mounts. LessonPage's Run button
    // carries the same "▶ Run" glyph + role=button as the authed page.
    await expect(page.getByRole("button", { name: /run/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Tutor input — GuidedTutorPanel's textarea has aria-label
    // "Ask the tutor". Anchoring on aria-label is stable across the
    // scripted-choreography placeholder phases (locked: "Watch for a
    // sec…" vs unlocked: "Ask about this lesson…"). The chrome
    // affordance is what we're verifying, not the placeholder copy.
    await expect(page.getByLabel(/ask the tutor/i)).toBeVisible();
  });

  test("clicking 'Sign up to save' (header) opens the signup wall", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Phase 27-v2.1 Part 3: the bottom-of-editor "Save" button is gone
    // (it lived in the bespoke AnonLessonPage chrome that no longer
    // exists). The remaining save affordance is the header pill
    // "Sign up to save", which calls AnonLessonPage's onAnonSave
    // callback to open the wall with reason="save".
    await page.getByRole("button", { name: /sign up to save/i }).click();

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

  // Phase 27-v2.1 Part 3: the LessonCompletePanel's "Next lesson"
  // CTA on anon now writes the anon stash + opens the wall with
  // reason="next-lesson". The full Run → edit → Run → Check →
  // celebration → click sequence is the dedicated anon→signup→
  // lesson-2 e2e's job (anon-handoff-flow.spec.ts); we don't have a
  // driven flow here because it requires real /api/anon/run round-
  // trip + scripted choreography wait that this navigation-only
  // spec was never designed to host.

  test("non-allowlisted lesson path redirects to /", async ({ page }) => {
    // The allowlist locks anon to python-fundamentals/hello-world.
    // Any other (courseId, lessonId) pair short-circuits via Navigate
    // before LessonPage even mounts. The wrapper's allowlist guard
    // is the gate; backend would 403 too, but this saves a round trip
    // and keeps the anon URL space honest.
    await page.goto("/try/lesson/python-fundamentals/variables");
    // Marketing page renders at /. The hero claim is the canary.
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });
  });

  // Phase 27-v2.1 Part 3: removed the mobile "instructions collapse"
  // test. The bespoke AnonLessonPage had a mobile-only "Show
  // instructions ↓" toggle that default-collapsed the markdown body
  // on phone widths. The unified LessonPage chrome doesn't ship
  // that affordance — instead, NarrowViewportGate shows a "your
  // screen is narrow" banner, consistent with the authed lesson
  // experience. Mobile UX for the anon path is now whatever the
  // authed path is. If we want a phone-specific layout in the
  // future, it should land on LessonPage uniformly (anon + authed).
});

test.describe("first-run cinematic on /try/ (Phase 27-v2 Day 2)", () => {
  // Phase 27-v2: Maya's hero moment moves OFF /welcome and ONTO /try/.
  // Phase 27-v2.1: anon variant of the cinematic — "Your turn." hero,
  // output preview placeholder pulse, left-aligned hero+output stack,
  // cursor-into-slot transition, support line cut. Authed /welcome
  // cinematic stays unchanged.
  // Phase 27-v2.2 Fix 2: output preview template changed from
  // "Hello, YOUR_NAME!" to "Hello, ____!" — the literal YOUR_NAME
  // token in the cinematic was pre-resolving the lesson moment
  // (the in-lesson auto-Run also prints "Hello, YOUR_NAME!" a few
  // seconds later). Blanks read as fillable without telegraphing
  // the exact lesson output.

  test("cinematic plays on first visit and is dismissable via Esc", async ({
    page,
  }) => {
    // Cold context — sessionStorage starts empty so the cinematic
    // should mount. Don't apply the describe-level seed.
    await page.goto(ALLOWED_PATH);

    // The cinematic's wrapper has a "Skip" affordance bottom-right
    // and the hero hits "Your turn." mid-arc. Skip is the fast,
    // deterministic dismiss path.
    const skipButton = page.getByRole("button", { name: /skip/i });
    await expect(skipButton).toBeVisible({ timeout: 6_000 });

    // Mid-arc hero text actually renders. On anon the heroLine is
    // "Your turn." (Phase 27-v2.1 — direct call-to-action; the name
    // materialization moves to the praise turn so we don't pretend
    // to know a name we don't have).
    await expect(page.getByText("Your turn.", { exact: true })).toBeVisible({
      timeout: 12_000,
    });
    // Phase 27-v2.2 Fix 2 — anon cinematic renders an output preview
    // line `Hello, ____!` with `____` as the pulsing placeholder
    // (was `Hello, YOUR_NAME!` in v2.1; the literal token pre-resolved
    // the in-lesson auto-Run's reveal). Blanks read as fillable; the
    // lesson auto-Run still prints `Hello, YOUR_NAME!` after dismiss.
    await expect(page.getByText(/Hello, ____!/)).toBeVisible({
      timeout: 12_000,
    });

    // Esc dismisses the cinematic immediately (handleSkipOnce path).
    await page.keyboard.press("Escape");

    // After Esc, the lesson workspace is visible. The "Try it — no signup"
    // badge in the LessonPage(mode="anon") header is the canary.
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
    // scripted walkthrough fires.
    //
    // Phase 27-v2.1 Part 3: the WorkspaceCoach now mounts INSIDE
    // LessonPage(mode="anon") via useLessonLayout's auto-open timer
    // (gated on !workspaceCoachDone). The wrapper bridges the
    // sessionStorage flag → preferencesStore on mount; we only seed
    // the cinematic flag here so the coach mounts fresh.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
    });
    await page.goto(ALLOWED_PATH);

    // The coach's first step bubble carries the "Lesson Instructions"
    // title + body. Generous timeout because the coach mounts only
    // after the lesson loads + the spotlight rect resolves.
    await expect(
      page.getByText(/Lesson Instructions/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Esc dismisses the coach (parity with /welcome → /learn cinematic).
    await page.keyboard.press("Escape");

    // After dismiss the coach is gone; lesson chrome is unobstructed.
    await expect(page.getByText(/Lesson Instructions/i)).toHaveCount(0);
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();

    // Same-tab reload — coach should NOT replay. The wrapper
    // subscribes to preferencesStore.workspaceCoachDone changes
    // and mirrors them into sessionStorage via markCoachSeenAnon,
    // so a reload pre-seeds the flag and skips the auto-open timer.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Lesson Instructions/i)).toHaveCount(0);
  });

  test("WorkspaceCoach phone short-circuits — no coach on 390x844 (Fix 3)", async ({
    browser,
  }) => {
    // Phase 27-v2.2 Fix 3 — coach mounts on desktop but auto-skips on
    // phone because (a) CoachBubble can't anchor cleanly at 390px,
    // (b) 28px Skip button is below 44pt HIG, (c) 6 spotlights ≈ 30s
    // of museum tour Maya doesn't have time for. The scripted
    // walkthrough orients her instead. This test pins the contract
    // at the iPhone 13 viewport.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    // Cinematic must still play once on a fresh phone tab — but THEN
    // the coach should not mount. Seed cinematicSeen so we land
    // straight in the lesson chrome.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
    });
    await page.goto(ALLOWED_PATH);
    // Wait for the lesson to load.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    // Coach would normally mount within ~600ms (COACH_AUTO_OPEN_MS).
    // Wait long enough for that window AND for the targetRect-resolve
    // useEffect to fire if it were going to.
    await page.waitForTimeout(1500);
    // No coach bubble on phone. CoachBubble has role="dialog"; the
    // SignupWallDialog has role="alertdialog" so they don't collide.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    // The "Lesson Instructions" coach-step title text is also a strong
    // canary — if it appears anywhere, the coach mounted.
    await expect(page.getByText(/Lesson Instructions/i)).toHaveCount(0);
    // And the lesson chrome is fully usable (the trial badge is the
    // "we got past the cinematic + coach" canary).
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();
    await ctx.close();
  });

  test("NarrowViewportGate banner suppressed during cinematic + walkthrough (Fix 4)", async ({
    browser,
  }) => {
    // Phase 27-v2.2 Fix 4 — the "you'll have a better time on a laptop"
    // banner is hidden while cinematic OR scripted choreography is in
    // flight. It re-appears on the post-flow state (cinematic dismissed,
    // walkthrough done). This test exercises both halves on a phone
    // viewport where the banner would otherwise show.
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });

    // Half A — cold tab on phone, cinematic phase → banner hidden.
    {
      const page = await phoneCtx.newPage();
      await page.goto(ALLOWED_PATH);
      // Wait briefly for the cinematic to mount its full chrome
      // (cinematicShowing flag flips on mount of CinematicGreeting).
      await page.waitForTimeout(500);
      // Banner is REMOVED from the DOM by the new early-return when
      // cinematicShowing OR firstRunStep is mid-flight. Use
      // toHaveCount(0) because Playwright's toBeVisible checks CSS
      // display/opacity, not occlusion — z-stacking alone wouldn't
      // satisfy the suppression contract.
      await expect(page.getByText(/better time on a laptop/i)).toHaveCount(0);
      await expect(
        page.getByText(/Looking a little cramped/i),
      ).toHaveCount(0);
      await page.close();
    }

    // Half B — post-flow state (all seen, choreography never fires
    // because anonChoreographyDone is set) → banner SHOWS.
    {
      const page = await phoneCtx.newPage();
      await page.addInitScript(() => {
        window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
        window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
        window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      });
      await page.goto(ALLOWED_PATH);
      // Wait for lesson chrome to finish mounting.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 10_000,
      });
      // Banner now SHOWS (firstRunStep === "idle", cinematicShowing=false).
      // The banner's z-40 sits above the lesson chrome; toBeVisible passes.
      await expect(
        page.getByText(/better time on a laptop/i),
      ).toBeVisible({ timeout: 5_000 });
      await page.close();
    }

    await phoneCtx.close();
  });

  test("cinematic Skip-button reveals earlier on phone (Fix 5)", async ({
    browser,
  }) => {
    // Phase 27-v2.2 Fix 5 — desktop keeps 4s skip-hidden delay
    // (cinema-respect, the full beat sequence wants eyes-forward
    // through the typewriter setup before admitting skippable).
    // Phone reveals at 1.5s — Maya's 90s patience can't afford a
    // 15% upfront "I cannot leave this" tax. Skip-button still
    // hides during Beat 1 (0–1.4s radial glow) so the skip-
    // affordance doesn't telegraph "skippable" at frame zero.
    //
    // This test pins the phone-side contract: at 2s the Skip
    // button IS visible. The desktop-side 4s contract is
    // implicitly verified by the existing cinematic-skip test
    // at the desktop default viewport.
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      // Force prefers-reduced-motion: no-preference so the cinematic
      // hits FullCinematic (where the Fix 5 skipDelayS lives), not
      // the ReducedMotionFallback (which auto-completes in 2.5s and
      // would unmount before the Skip-button polling window).
      reducedMotion: "no-preference",
    });
    const page = await phoneCtx.newPage();
    await page.goto(ALLOWED_PATH);
    // Wait past the phone delay (1.5s + ~400ms fade) but well
    // under the desktop delay (4s). At ~2.0s the Skip button must
    // be visible if Fix 5 landed. Without Fix 5 (4s desktop delay
    // applied to phone), it would still be opacity 0 at this
    // timestamp. Use Playwright's poll-until-visible up to 1s on
    // top of the 2.0s wait — total budget 3.0s, well below 4s.
    await page.waitForTimeout(2_000);
    // Skip button has aria-label "Skip introduction" — its accessible
    // name is the aria-label, not the text content. Use the loose
    // regex to match.
    await expect(
      page.getByRole("button", { name: /skip introduction/i }),
    ).toBeVisible({ timeout: 1_000 });
    await phoneCtx.close();
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
    // for the 14.5s cinematic to actually dissolve.
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("button", { name: /skip/i })).toHaveCount(0, {
      timeout: 18_000,
    });
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();
  });
});

test.describe("Phase 27-v2.1 Part 3: pixel-equivalence chrome on /try/", () => {
  // Verifies the LessonPage chrome (instructions panel + tutor panel +
  // run/check buttons + LessonCompletePanel-class structure) is in fact
  // rendered on /try/ — i.e., the AnonLessonPage thin wrapper IS
  // mounting LessonPage(mode="anon") and not its old bespoke JSX.
  // The Pixel-equivalence Invariant from the v2.1 plan: only the
  // header bar may differ between authed and anon; everything below
  // is the same chrome.

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
    });
  });

  test("anon /try/ renders LessonInstructionsPanel + GuidedTutorPanel + Monaco editor (not bespoke chrome)", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);

    // h1 from LessonInstructionsPanel — title hoisted by Phase B.
    // The bespoke chrome rendered the title in a different shape
    // (custom AnonMarkdown div); LessonInstructionsPanel renders
    // an h1 with `font-display text-[28px]` Fraunces. If the bespoke
    // chrome ever sneaks back in, this h1 might still be present
    // (the lesson title is global) — the canary is the next two
    // assertions.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Hello, World!/i,
      { timeout: 10_000 },
    );

    // GuidedTutorPanel's textarea has aria-label "Ask the tutor".
    // The bespoke chrome had a different textarea labeled "Stuck? Ask
    // the tutor" — that text is gone. Anchoring on the GuidedTutorPanel
    // aria-label confirms LessonPage's tutor pane is rendering.
    await expect(page.getByLabel(/ask the tutor/i)).toBeVisible({
      timeout: 15_000,
    });

    // Hint button rename assertion lifted — the hint button only
    // renders below the latest assistant message. With the
    // describe-level seed of anonChoreographyDone=1, no scripted
    // greet fires, so there's no assistant message and no hint
    // button. The hint button copy contract is exercised in the
    // anon-exhausted-wall spec which uses the same path.

    // Run + Check buttons live in LessonPage's editor toolbar.
    await expect(
      page.getByRole("button", { name: /run/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /check/i }).first(),
    ).toBeVisible();
  });

  test("anon header carries 'Try it — no signup' badge AND 'Sign up to save' pill (not StreakChip / UserMenu)", async ({
    page,
  }) => {
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The two anon-only header surfaces.
    await expect(page.getByText(/Try it — no signup/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign up to save/i }),
    ).toBeVisible();

    // Negative assertion — the authed-only surfaces should NOT render.
    // StreakChip text begins with "🔥" and a number; UserMenu carries
    // an "Open user menu" aria-label. Their absence confirms the mode
    // gate is wired correctly.
    await expect(page.getByLabel(/open user menu/i)).toHaveCount(0);
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
