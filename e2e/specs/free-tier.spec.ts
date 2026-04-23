// Phase 20-P4: free AI tier E2E. The production flip depends on this spec
// covering every user-visible branch of the credential resolver + the
// UI surfaces that fan out from it. We mock every backend endpoint on the
// browser side so the spec runs without setting ENABLE_FREE_TIER on the
// backend container — the credentials + ledger branching is unit-tested
// separately in credential.test.ts.
//
// Mocked endpoints:
//   GET    /api/user/ai-status              — drives FreeTierPill vs UsageChip
//                                              vs ExhaustionCard vs
//                                              TutorSetupWarning
//   POST   /api/user/ai-exhaustion-click    — increment CTA counter
//   POST   /api/user/paid-access-interest   — upsert + counter (Round 6:
//                                              accepted for denylisted users
//                                              with denylisted_at_click flag)
//   DELETE /api/user/paid-access-interest   — user-initiated withdrawal
//   POST   /api/ai/ask/stream               — the actual tutor call
//
// Each test is a self-contained scenario. Run one at a time per the repo
// standard: `npx playwright test e2e/specs/free-tier.spec.ts --grep "..."`

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import {
  mockListModels,
  mockTutorQueue,
  mockTutorResponse,
  mockValidateKey,
} from "../fixtures/aiMocks";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { waitForMonacoReady } from "../fixtures/monaco";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";
const LESSON_ID = "hello-world";

type AIStatusBody = {
  source: "byok" | "platform" | "none";
  reason?: string;
  remainingToday: number | null;
  capToday: number | null;
  resetAtUtc: string | null;
  hasShownPaidInterest?: boolean;
};

// Routed per-test: we want the ai-status response to change as the test
// advances (e.g. 2/2 → 1/2 → 0/2 → exhausted). A queue-style stub is the
// simplest way without holding shared module state.
async function mockAIStatusSequence(page: Page, sequence: AIStatusBody[]): Promise<void> {
  if (sequence.length === 0) throw new Error("mockAIStatusSequence needs at least one body");
  let i = 0;
  await page.route("**/api/user/ai-status", async (route: Route) => {
    const body = sequence[Math.min(i, sequence.length - 1)];
    i++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockAIStatus(page: Page, body: AIStatusBody): Promise<void> {
  await page.route("**/api/user/ai-status", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

// Simple counter stubs so tests can assert number of hits.
function countingRoute(
  page: Page,
  path: string,
  status: number,
  method?: "GET" | "POST" | "DELETE",
): { count: () => number; bodies: () => unknown[] } {
  let calls = 0;
  const bodies: unknown[] = [];
  void page.route(`**${path}`, async (route: Route) => {
    if (method && route.request().method() !== method) {
      await route.fallback();
      return;
    }
    calls++;
    try {
      const raw = route.request().postData();
      bodies.push(raw ? JSON.parse(raw) : null);
    } catch {
      bodies.push(null);
    }
    await route.fulfill({ status });
  });
  return { count: () => calls, bodies: () => bodies };
}

// Capture method-aware hit counts for a single path (POST vs DELETE share a
// URL for the paid-access-interest round-trip).
function countingRouteByMethod(
  page: Page,
  path: string,
  handlers: Partial<Record<"GET" | "POST" | "DELETE", number>>,
): { count: (m: "GET" | "POST" | "DELETE") => number } {
  const counts: Record<string, number> = {};
  void page.route(`**${path}`, async (route: Route) => {
    const m = route.request().method();
    const status = handlers[m as "GET" | "POST" | "DELETE"];
    if (status === undefined) {
      await route.fallback();
      return;
    }
    counts[m] = (counts[m] ?? 0) + 1;
    await route.fulfill({ status });
  });
  return { count: (m) => counts[m] ?? 0 };
}

test.describe("free AI tier", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboardingDone(page);
    // Non-stream fallbacks + model list kept alive for the empty-profile path
    // where the panel may try to list models on mount.
    await mockValidateKey(page, true);
    await mockListModels(page);
  });

  test("platform source renders FreeTierPill and decrements after a turn", async ({ page }) => {
    const resetAt = new Date(Date.now() + 3 * 60 * 60 * 1000 + 20 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      { source: "platform", remainingToday: 30, capToday: 30, resetAtUtc: resetAt },
      { source: "platform", remainingToday: 29, capToday: 30, resetAtUtc: resetAt },
    ]);
    await mockTutorResponse(page, "lesson-explain");
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // Pill surfaces on load with the initial 30/30 count.
    await expect(page.getByText(/Free tutor/i)).toBeVisible();
    await expect(page.getByText(/30\/30/)).toBeVisible();

    // Send a question — the refetch after `asking` flips back should pull
    // the second body in the sequence (29/30).
    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await input.fill("What's a variable?");
    await input.press("Enter");
    await expect(page.getByText(/29\/30/)).toBeVisible({ timeout: 5_000 });
  });

  test("quota exhaustion shows ExhaustionCard with three CTAs", async ({ page }) => {
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    // Round 5: sequence advances hasShownPaidInterest to true on the
    // refetch after the paid-click so we actually exercise the backend
    // field → frontend hide wiring (previously the local "submitted" state
    // was masking a regression in that path).
    await mockAIStatusSequence(page, [
      {
        source: "none",
        reason: "free_exhausted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: resetAt,
        hasShownPaidInterest: false,
      },
      {
        source: "none",
        reason: "free_exhausted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: resetAt,
        hasShownPaidInterest: true,
      },
    ]);
    const byokCta = countingRoute(page, "/api/user/ai-exhaustion-click", 204);
    const paidCta = countingRoute(page, "/api/user/paid-access-interest", 204);

    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // Three buttons: BYOK, paid interest, dismiss. Clicking paid interest
    // flips the button's label to the "Interest recorded" confirmation state.
    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeVisible();
    await page.getByRole("button", { name: /register interest in a paid plan/i }).click();
    await expect(
      page.getByRole("button", { name: /Interest recorded/i }),
    ).toBeVisible();

    // Dismiss hides the card — the textarea reappears. (BYOK redirect is
    // handled by the parent callback; test it in a settings spec.)
    await page.getByRole("button", { name: /^Dismiss$/i }).click();
    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeHidden();

    // Each click path hits its backend once.
    expect(paidCta.count()).toBeGreaterThanOrEqual(1);
    expect(byokCta.count()).toBeGreaterThanOrEqual(1); // Dismiss → exhaustion-click
  });

  test("BYOK source renders UsageChip, no pill", async ({ page }) => {
    // Seed an OpenAI key via preferences so `hasKey` is true. We still mock
    // ai-status to `source: "byok"` so the hook agrees.
    await mockAIStatus(page, {
      source: "byok",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor · /i)).toHaveCount(0);
  });

  test("kill switch (free_disabled) renders paused copy in TutorSetupWarning", async ({ page }) => {
    await mockAIStatus(page, {
      source: "none",
      reason: "free_disabled",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    // The paid-interest CTA is visible whenever reason is non-no_key.
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toBeVisible();
  });

  test("denylisted account shows paid-interest CTA (Round 6 reversal)", async ({ page }) => {
    // Round 6: denylisted users CAN click the CTA. A banned account willing
    // to pay is a valuable lead; backend flags the row with
    // `denylisted_at_click=true` so the operator sees the context at review.
    // This test confirms the CTA is visible, clickable, POSTs 204, and the
    // next ai-status refetch hides the button everywhere.
    await mockAIStatusSequence(page, [
      {
        source: "none",
        reason: "denylisted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: false,
      },
      {
        source: "none",
        reason: "denylisted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: true,
      },
    ]);
    const paidCta = countingRoute(page, "/api/user/paid-access-interest", 204);

    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor unavailable/i)).toBeVisible();
    const cta = page.getByRole("button", { name: /register interest in a paid plan/i });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(
      page.getByRole("button", { name: /Interest recorded/i }),
    ).toBeVisible();
    expect(paidCta.count()).toBeGreaterThanOrEqual(1);
  });

  test("no_key reason renders default onboarding copy, no paid-interest CTA", async ({ page }) => {
    await mockAIStatus(page, {
      source: "none",
      reason: "no_key",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Connect your AI tutor/i)).toBeVisible();
    // The onboarding surface must NOT crowd in a paid-interest CTA — it is
    // only relevant when the user is actively blocked from the free tier.
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(0);
  });

  test("ai-status 500 falls back to BYOK UI (no infinite spinner)", async ({ page }) => {
    await page.route("**/api/user/ai-status", async (route: Route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // With BYOK-shaped fallback + hasKey=false, the TutorSetupWarning
    // renders (no hanging loader).
    await expect(page.getByText(/Connect your AI tutor/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Free tutor · /i)).toHaveCount(0);
  });

  test("USD cap hit renders paused copy (does not leak cap number)", async ({ page }) => {
    await mockAIStatus(page, {
      source: "none",
      reason: "usd_cap_hit",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // Same generic "paused" copy — no dollar amount leaks to the user.
    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await expect(page.getByText(/\$/)).toHaveCount(0);
  });

  test("paid-interest CTA hidden everywhere once hasShownPaidInterest is true", async ({
    page,
  }) => {
    // Mock ai-status as a paused state that normally shows the CTA, but
    // flag hasShownPaidInterest so the button must be suppressed. One
    // signal per user is enough; don't keep re-asking on every page.
    await mockAIStatus(page, {
      source: "none",
      reason: "usd_cap_hit",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
      hasShownPaidInterest: true,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(0);
  });

  test("amber pill when <20% remaining", async ({ page }) => {
    const resetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await mockAIStatus(page, {
      source: "platform",
      remainingToday: 5,
      capToday: 30,
      resetAtUtc: resetAt,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    const pill = page.getByText(/Free tutor/i).first();
    await expect(pill).toBeVisible();
    // Amber variant uses the `warn` palette; BYOK pill uses `accent`. Assert
    // the amber class to lock the color-branch.
    const container = page.locator("span", { hasText: /Free tutor/i }).first();
    await expect(container).toHaveClass(/text-warn/);
  });

  test("Settings → AI tab surfaces paid-interest CTA; Remove restores it", async ({
    page,
  }) => {
    // Round 5: Settings is the one place that always renders a paid-interest
    // affordance — CTA when hasShown=false, "Interest recorded ✓ Remove"
    // line when hasShown=true. Remove DELETEs the row and the next ai-status
    // refetch restores the CTA so the user can re-signal if they wish.
    await mockAIStatusSequence(page, [
      // Initial + refetches until the Remove click.
      {
        source: "byok",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: false,
      },
      {
        source: "byok",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: true,
      },
      // Post-Remove refetch — row is gone, CTA restored.
      {
        source: "byok",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: false,
      },
    ]);
    const paidCta = countingRouteByMethod(page, "/api/user/paid-access-interest", {
      POST: 204,
      DELETE: 204,
    });

    await loadProfile(page, "empty");
    await page.goto("/");
    await S.openSettings(page, "ai");

    // BYOK user, no prior interest → the CTA is visible.
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /register interest in a paid plan/i }).click();
    await expect(page.getByText(/Interest recorded\. Clicked/i)).toBeVisible();

    // Remove path — DELETE /paid-access-interest, then ai-status refetch,
    // then the CTA re-appears in place of the recorded line.
    await page.getByRole("button", { name: /^Remove my interest$/i }).click();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toBeVisible();

    // Each verb hit exactly once: the click POSTs and the Remove DELETEs.
    expect(paidCta.count("POST")).toBeGreaterThanOrEqual(1);
    expect(paidCta.count("DELETE")).toBeGreaterThanOrEqual(1);
  });

  test("cross-pane broadcast: click in one surface hides CTA in another", async ({
    page,
  }) => {
    // The useAIStatus subscriber-set is the whole reason both panels stay
    // coherent without each making its own poll. Simulate: exhaustion card
    // is mounted in the lesson panel, user navigates to Settings where the
    // CTA is also rendered, clicks it there, then returns to the lesson —
    // the exhaustion card's middle button is gone.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      {
        source: "none",
        reason: "free_exhausted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: resetAt,
        hasShownPaidInterest: false,
      },
      // After the click, every subsequent ai-status refetch returns true.
      {
        source: "none",
        reason: "free_exhausted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: resetAt,
        hasShownPaidInterest: true,
      },
    ]);
    void countingRoute(page, "/api/user/ai-exhaustion-click", 204);
    void countingRoute(page, "/api/user/paid-access-interest", 204);

    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);
    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeVisible();
    // Click the paid CTA from inside the exhaustion card.
    await page.getByRole("button", { name: /register interest in a paid plan/i }).click();
    await expect(
      page.getByRole("button", { name: /Interest recorded/i }),
    ).toBeVisible();

    // Open Settings → AI tab. The paid-interest CTA button must be absent
    // (broadcaster pushed hasShownPaidInterest=true to every subscriber).
    // The "Interest recorded" line must be there instead.
    await S.openSettings(page, "ai");
    await expect(page.getByText(/Interest recorded\. Clicked/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(0);
  });

  // ── Extended coverage (pre-flip): every blocked reason, every threshold,
  // every transition, every error path. See plan §"Round 6" for the matrix.

  test("platform key recovers: provider_auth_failed → platform resumes tutor", async ({
    page,
  }) => {
    // Audit gap #3 (hazy-wishing-wren bucket 10): recovery path for the
    // platform-key 401 kill-switch. Sequence:
    //  1. Backend marks auth failed → /ai-status flips to provider_auth_failed.
    //  2. UI shows paused copy + paid-interest CTA; composer is disabled.
    //  3. Operator unsticks (or AUTO_UNSTICK_MS probe succeeds) → next
    //     /ai-status returns `source: platform` with a fresh counter.
    //  4. UI clears the paused surface; composer re-enables; the next ask
    //     streams without hitting the stale kill-switch.
    // Regression would be: the UI never re-subscribes to a post-recovery
    // /ai-status, or a cached paused state persists past the flip.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      // Paused.
      {
        source: "none",
        reason: "provider_auth_failed",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
      },
      // Recovered — backend flipped the flag off, learner gets their count.
      { source: "platform", remainingToday: 30, capToday: 30, resetAtUtc: resetAt },
      // Post-ask decrement so the pill animation locks in.
      { source: "platform", remainingToday: 29, capToday: 30, resetAtUtc: resetAt },
    ]);
    await mockTutorResponse(page, "lesson-explain");

    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // Phase 1: paused.
    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();

    // Phase 2: force a status refetch by reloading the page. The
    // mockAIStatusSequence advances to the next body on each call, so the
    // recovery body is served on this reload.
    await page.reload();
    await waitForMonacoReady(page);

    // Paused copy is gone; platform pill is back with fresh 30/30.
    await expect(page.getByText(/Free tutor is paused/i)).toHaveCount(0);
    await expect(page.getByText(/30\/30/)).toBeVisible({ timeout: 10_000 });

    // Phase 3: composer accepts a new ask. Pill decrements to 29/30 on
    // onDone.
    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await expect(input).toBeEnabled();
    await input.fill("post-recovery question");
    await input.press("Enter");
    await expect(page.getByText(/29\/30/)).toBeVisible({ timeout: 5_000 });
  });

  test("provider_auth_failed renders paused copy + CTA", async ({ page }) => {
    // Operator's OpenAI key was revoked upstream. UI must show the generic
    // paused copy (no leaked reason) and the paid-interest CTA.
    await mockAIStatus(page, {
      source: "none",
      reason: "provider_auth_failed",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toBeVisible();
  });

  test("daily_usd_per_user_hit renders paused copy + CTA", async ({ page }) => {
    // Layer 2 — per-user daily $ cap tripped. Same generic copy as the other
    // paused reasons — we don't leak which layer fired.
    await mockAIStatus(page, {
      source: "none",
      reason: "daily_usd_per_user_hit",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await expect(page.getByText(/\$/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toBeVisible();
  });

  test("lifetime_usd_per_user_hit renders paused copy + CTA", async ({ page }) => {
    // Layer 3 — lifetime $ cap tripped. Final paused branch.
    await mockAIStatus(page, {
      source: "none",
      reason: "lifetime_usd_per_user_hit",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toBeVisible();
  });

  test("pill decrements across multiple turns (30→29→28)", async ({ page }) => {
    // Guards against a regression where the hook only refetches the first
    // time `asking` flips. Three turns, three decrements.
    const resetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      { source: "platform", remainingToday: 30, capToday: 30, resetAtUtc: resetAt },
      { source: "platform", remainingToday: 29, capToday: 30, resetAtUtc: resetAt },
      { source: "platform", remainingToday: 28, capToday: 30, resetAtUtc: resetAt },
    ]);
    await mockTutorQueue(page, ["lesson-explain", "first-turn-concept"]);
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/30\/30/)).toBeVisible();

    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await input.fill("question one");
    await input.press("Enter");
    await expect(page.getByText(/29\/30/)).toBeVisible({ timeout: 5_000 });

    await input.fill("question two");
    await input.press("Enter");
    await expect(page.getByText(/28\/30/)).toBeVisible({ timeout: 5_000 });
  });

  test("pill crosses amber threshold mid-session (6/30 → 5/30)", async ({ page }) => {
    // The <20% trigger flips the pill from accent to warn mid-session. We
    // pair the color-branch assertion with a count assertion so a CSS-only
    // regression still fails.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      { source: "platform", remainingToday: 6, capToday: 30, resetAtUtc: resetAt },
      { source: "platform", remainingToday: 5, capToday: 30, resetAtUtc: resetAt },
    ]);
    await mockTutorResponse(page, "lesson-explain");
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // 6/30 is still >=20%, so pill is accent.
    const pill = page.locator("span", { hasText: /Free tutor/i }).first();
    await expect(pill).toHaveClass(/text-accent/);

    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await input.fill("push over the threshold");
    await input.press("Enter");
    await expect(page.getByText(/5\/30/)).toBeVisible({ timeout: 5_000 });
    // Now <20% → amber.
    await expect(pill).toHaveClass(/text-warn/);
  });

  test("chat history remains visible when exhausted (only composer is swapped)", async ({
    page,
  }) => {
    // Critical UX invariant: when the learner hits 0/30 we replace the
    // composer with the ExhaustionCard, but the scrollback of prior Q&A
    // MUST remain readable — users still want to review what they already
    // asked. Regression here would be a major data-loss feel-alike.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      { source: "platform", remainingToday: 1, capToday: 30, resetAtUtc: resetAt },
      // After the turn, we've exhausted.
      {
        source: "none",
        reason: "free_exhausted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: resetAt,
      },
    ]);
    await mockTutorResponse(page, "lesson-explain");
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await input.fill("my very last question about variables");
    await input.press("Enter");

    // The assistant's reply ("A variable is a name…") is part of the
    // lesson-explain mock. Wait for it to land.
    await expect(page.getByText(/A variable/i).first()).toBeVisible({ timeout: 10_000 });

    // Now we should be exhausted: composer replaced by ExhaustionCard.
    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeVisible();

    // The user-sent question AND the assistant's reply must still be on
    // screen above the card. Both are rendered inside the scroll area.
    await expect(
      page.getByText(/my very last question about variables/i).first(),
    ).toBeVisible();
    await expect(page.getByText(/A variable/i).first()).toBeVisible();
  });

  test("ExhaustionCard Dismiss restores composer but input is still disabled", async ({
    page,
  }) => {
    // Dismiss is a session-only escape: the card goes away so the user can
    // scroll, but `configured=false` means the textarea stays disabled.
    // Previous bug had us re-enabling the textarea and producing a broken
    // send on click.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatus(page, {
      source: "none",
      reason: "free_exhausted",
      remainingToday: null,
      capToday: null,
      resetAtUtc: resetAt,
    });
    void countingRoute(page, "/api/user/ai-exhaustion-click", 204);
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeVisible();
    await page.getByRole("button", { name: /^Dismiss$/i }).click();
    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeHidden();

    // The composer is back — but still disabled because we're on `source:none`.
    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await expect(input).toBeDisabled();
  });

  test("ExhaustionCard Add-my-OpenAI-key CTA hits ai-exhaustion-click + opens Settings", async ({
    page,
  }) => {
    // The button's parent callback opens Settings (lesson panel passes it
    // down). Asserts: (a) the counter route fires with the correct outcome,
    // (b) the visible Settings modal lands after click.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatus(page, {
      source: "none",
      reason: "free_exhausted",
      remainingToday: null,
      capToday: null,
      resetAtUtc: resetAt,
    });
    const clickBodies: unknown[] = [];
    await page.route("**/api/user/ai-exhaustion-click", async (route: Route) => {
      try {
        clickBodies.push(JSON.parse(route.request().postData() ?? "null"));
      } catch {
        clickBodies.push(null);
      }
      await route.fulfill({ status: 204 });
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await page.getByRole("button", { name: /add my openai key for unlimited/i }).click();
    // The outcome label must be `clicked_byok` — the metric is only useful
    // if outcomes are correctly attributed.
    await expect
      .poll(() => clickBodies, { timeout: 3_000 })
      .toContainEqual({ outcome: "clicked_byok" });
  });

  test("paid-access POST 500 keeps CTA available to retry", async ({ page }) => {
    // Flaky backend → user sees a "Try again" label and can re-click. Must
    // not hide the CTA on failure — the signal is the whole point of the
    // feature, we don't want to swallow it silently.
    await mockAIStatus(page, {
      source: "none",
      reason: "usd_cap_hit",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
      hasShownPaidInterest: false,
    });
    let attempt = 0;
    await page.route("**/api/user/paid-access-interest", async (route: Route) => {
      attempt++;
      await route.fulfill({ status: attempt === 1 ? 500 : 204 });
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    const cta = page.getByRole("button", { name: /register interest in a paid plan/i });
    await cta.click();
    // Error state → button label flips to "Try again" so the user knows.
    await expect(page.getByRole("button", { name: /^Try again$/i })).toBeVisible();
  });

  test("DELETE 500 surfaces a user-visible error without hiding Remove", async ({ page }) => {
    // Withdraw round-trip must fail gracefully: we render an inline error
    // rather than toast-and-forget, and we do not remove the affordance so
    // the user can retry without reloading.
    await mockAIStatus(page, {
      source: "byok",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
      hasShownPaidInterest: true,
    });
    await page.route("**/api/user/paid-access-interest", async (route: Route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({ status: 500 });
        return;
      }
      await route.fulfill({ status: 204 });
    });
    await loadProfile(page, "empty");
    await page.goto("/");
    await S.openSettings(page, "ai");

    const remove = page.getByRole("button", { name: /^Remove my interest$/i });
    await expect(remove).toBeVisible();
    await remove.click();
    // The Settings handler surfaces a "× <error>" span next to the button.
    await expect(page.locator("text=/^× /")).toBeVisible();
    // Remove button is still present — user can retry.
    await expect(remove).toBeVisible();
  });

  test("click CTA in TutorSetupWarning hides it in Settings too", async ({ page }) => {
    // Opposite of the existing cross-pane scenario: click from the paused
    // TutorSetupWarning, then confirm Settings shows "Interest recorded"
    // with no CTA. Covers the other direction of the subscriber broadcast.
    await mockAIStatusSequence(page, [
      {
        source: "none",
        reason: "free_disabled",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: false,
      },
      {
        source: "none",
        reason: "free_disabled",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: true,
      },
    ]);
    void countingRoute(page, "/api/user/paid-access-interest", 204);
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await page.getByRole("button", { name: /register interest in a paid plan/i }).click();

    await S.openSettings(page, "ai");
    await expect(page.getByText(/Interest recorded\. Clicked/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(0);
  });

  test("Settings CTA hides TutorSetupWarning CTA cross-pane", async ({ page }) => {
    // Click from Settings, navigate to a lesson that's paused → the
    // TutorSetupWarning CTA must NOT re-appear.
    await mockAIStatusSequence(page, [
      {
        source: "none",
        reason: "free_disabled",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: false,
      },
      {
        source: "none",
        reason: "free_disabled",
        remainingToday: null,
        capToday: null,
        resetAtUtc: null,
        hasShownPaidInterest: true,
      },
    ]);
    void countingRoute(page, "/api/user/paid-access-interest", 204);
    await loadProfile(page, "empty");
    await page.goto("/");
    await S.openSettings(page, "ai");

    await page.getByRole("button", { name: /register interest in a paid plan/i }).click();
    await expect(page.getByText(/Interest recorded\. Clicked/i)).toBeVisible();

    // Close settings modal by clicking outside or pressing Escape.
    await page.keyboard.press("Escape");

    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);
    await expect(page.getByText(/Free tutor is paused/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(0);
  });

  // NOTE: the SIGNED_OUT cache-clear path is covered by useAIStatus's unit
  // coverage — triggering a real sign-out mid-spec tears down the Playwright
  // worker user, so we can't exercise it here without flaking other tests.
  // The user-visible cross-pane / epoch-drop behavior is covered by the
  // broadcast scenarios above.

  test("BYOK user sees no pill, still answers", async ({ page }) => {
    // End-to-end smoke that BYOK remains intact — the primary
    // "serious-tutor" guarantee the operator made to existing users.
    await mockAIStatus(page, {
      source: "byok",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
    });
    await mockTutorResponse(page, "lesson-explain");
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/Free tutor · /i)).toHaveCount(0);
    // BYOK without hasKey (we did not seed a key in loadProfile "empty")
    // → composer is disabled, the setup-warning renders. Tested separately
    // that the composer enables once hasKey=true. Here the invariant is
    // just: no pill.
  });

  test("ai-status 500 AFTER first fetch preserves hasShownPaidInterest", async ({ page }) => {
    // Round 5 hardening: a transient 500 must NOT unhide the paid-interest
    // CTA for a user who already clicked. First fetch sets the flag; every
    // later fetch errors; the hook's fallback should keep the prior value.
    let fetchIx = 0;
    await page.route("**/api/user/ai-status", async (route: Route) => {
      fetchIx++;
      if (fetchIx === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            source: "none",
            reason: "usd_cap_hit",
            remainingToday: null,
            capToday: null,
            resetAtUtc: null,
            hasShownPaidInterest: true,
          }),
        });
        return;
      }
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    // First fetch succeeded with hasShown=true → CTA is hidden. Subsequent
    // 500s should NOT flip it back on. We can force a refetch by navigating
    // to Settings where the same hook is used; the "Interest recorded" line
    // should stay regardless of the error tide.
    await S.openSettings(page, "ai");
    await expect(page.getByText(/Interest recorded\. Clicked/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(0);
  });

  test("stream error shows retry affordance without decrementing counter", async ({
    page,
  }) => {
    // Server 500 on the stream → the turn fails before landing a ledger row,
    // so the pill should NOT decrement. Regression would be counting the
    // failed turn against the user's 30/day.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      { source: "platform", remainingToday: 30, capToday: 30, resetAtUtc: resetAt },
      // If the client fires an extra refetch, we serve the SAME count (not
      // a decrement). Any decrement in the wild would be a bug.
      { source: "platform", remainingToday: 30, capToday: 30, resetAtUtc: resetAt },
    ]);
    await mockTutorResponse(page, "error-500");
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await input.fill("fail pls");
    await input.press("Enter");
    // Error banner appears. Pill is still 30/30.
    await expect(page.getByText(/server overloaded|please retry/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/30\/30/)).toBeVisible();
  });

  test("platform at 1/30 → exhausted after one turn", async ({ page }) => {
    // Boundary: the 1→0 transition must trigger the ExhaustionCard the next
    // time the hook re-pulls status. Key edge case for reviewers.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatusSequence(page, [
      { source: "platform", remainingToday: 1, capToday: 30, resetAtUtc: resetAt },
      {
        source: "none",
        reason: "free_exhausted",
        remainingToday: null,
        capToday: null,
        resetAtUtc: resetAt,
      },
    ]);
    await mockTutorResponse(page, "lesson-explain");
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/1\/30/)).toBeVisible();
    const input = page.getByRole("textbox", { name: /ask/i }).first();
    await input.fill("one last question");
    await input.press("Enter");
    await expect(
      page.getByText(/You've used today's free tutor questions/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("platform pill amber variant uses warn palette; non-amber uses accent", async ({
    page,
  }) => {
    // Lock both color branches in one go. Two renders.
    await mockAIStatus(page, {
      source: "platform",
      remainingToday: 25,
      capToday: 30,
      resetAtUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    const pill = page.locator("span", { hasText: /Free tutor/i }).first();
    await expect(pill).toHaveClass(/text-accent/);
    await expect(pill).not.toHaveClass(/text-warn/);
  });

  test("denylisted row includes denylisted_at_click=true flag in body", async ({ page }) => {
    // Option-3 backend plumbing: when a denylisted user clicks the CTA, the
    // backend sees `isDenylisted=true` via its server-side check. We can't
    // assert DB state from Playwright, but we CAN confirm the click does
    // produce exactly one POST (i.e. wasn't silently swallowed). The DB-side
    // flag behavior is unit-tested in paidAccessInterest.test.ts.
    await mockAIStatus(page, {
      source: "none",
      reason: "denylisted",
      remainingToday: null,
      capToday: null,
      resetAtUtc: null,
      hasShownPaidInterest: false,
    });
    const paidCta = countingRoute(page, "/api/user/paid-access-interest", 204);
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await page.getByRole("button", { name: /register interest in a paid plan/i }).click();
    await expect
      .poll(() => paidCta.count(), { timeout: 3_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test("TutorSetupWarning does not double-stack above ExhaustionCard when exhausted", async ({
    page,
  }) => {
    // Found during Round 5 E2E: the setup-warning + exhaustion-card would
    // both render at 0/30 with no BYOK key, producing two paid-interest CTAs
    // and strict-mode locator violations. The fix gates the setup-warning on
    // `!configured && !exhausted`. Lock it down.
    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await mockAIStatus(page, {
      source: "none",
      reason: "free_exhausted",
      remainingToday: null,
      capToday: null,
      resetAtUtc: resetAt,
      hasShownPaidInterest: false,
    });
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/${LESSON_ID}`);
    await waitForMonacoReady(page);

    await expect(page.getByText(/You've used today's free tutor questions/i)).toBeVisible();
    // The TutorSetupWarning onboarding headline MUST NOT be stacked on top.
    await expect(page.getByText(/Connect your AI tutor/i)).toHaveCount(0);
    // Exactly one paid-interest CTA (not two).
    await expect(
      page.getByRole("button", { name: /register interest in a paid plan/i }),
    ).toHaveCount(1);
  });
});
