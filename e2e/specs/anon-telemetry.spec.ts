// Phase 27-v2.2 Fix 6 — funnel telemetry events.
//
// Verifies the four canonical funnel events fire from the right
// surfaces with the right reasons. The PM audit-lane synthesis flagged
// the absence of any conversion measurement as P0 — without these
// events the team can't tell shipping the trial path from doing
// nothing. This spec pins the contract that the events DO fire.
//
// What this spec does NOT verify:
//   - That the backend correctly inserts rows into phase27_funnel_events.
//     That's a separate backend integration test (or a manual smoke
//     against /api/admin/anon-summary in Fix 7).
//   - That anon_signup_completed fires from the SignupPage's onSuccess.
//     Driving Supabase signup through Playwright is the auth-fixture
//     spec's job; here we mock /api/anon-handoff and verify the
//     downstream lesson2_reached event.
//   - That anon_lesson2_reached fires AFTER signup. Same reason.
//
// What it DOES verify:
//   - anon_page_view fires once on /try/ mount
//   - anon_wall_opened fires with reason="save" on header pill click
//   - anon_wall_opened fires with reason="next-lesson" on celebration dismiss
//   - anon_wall_opened fires with reason="exhausted" on 429 ANON_EXHAUSTED
//   - anon_wall_opened fires with reason="share" on celebration share click
// (anon_lesson2_reached coverage is acknowledged-deferred — it would
// need to extend anon-handoff-flow.spec to add a request listener.)

import { expect, test } from "@playwright/test";

const ALLOWED_PATH = "/try/lesson/python-fundamentals/hello-world";

interface TelemetryEvent {
  event?: string;
  reason?: string;
  outcome?: string;
  surface?: string;
}

// Helper — install a recorder that catches all POST /api/telemetry/event
// payloads. Uses Playwright's request listener (NOT route mocking) so the
// real backend still receives the request and writes the row; we just
// observe the body in-flight. Returns the array (mutated as events fire)
// + a flush helper that drains pending requests so assertions don't race.
async function recordTelemetry(
  page: import("@playwright/test").Page,
): Promise<TelemetryEvent[]> {
  const events: TelemetryEvent[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (!req.url().includes("/api/telemetry/")) return;
    try {
      const body = req.postDataJSON() as TelemetryEvent;
      events.push(body);
    } catch {
      /* skip non-JSON */
    }
  });
  return events;
}

// Wait for an event matching the predicate to land in the list. Polls
// at 100ms cadence up to the timeout. Returns the matched event so
// further field assertions can chain.
async function waitForEvent(
  events: TelemetryEvent[],
  predicate: (e: TelemetryEvent) => boolean,
  timeoutMs = 5_000,
): Promise<TelemetryEvent> {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = events.find(predicate);
    if (found) return found;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Telemetry event not seen within ${timeoutMs}ms. Saw: ${JSON.stringify(events)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

test.describe("Phase 27-v2.2 Fix 6 — funnel telemetry", () => {
  test.beforeEach(async ({ page }) => {
    // Skip cinematic + coach + walkthrough so each test lands fast on
    // the working chrome. The events we're verifying don't depend on
    // first-run flow state.
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      // Phase A — A1: pre-seed retrieval-pass so Check goes straight
      // to celebration (this spec verifies telemetry events, not the
      // retrieval gate behavior).
      // Phase A: the retrieval pass is scoped to the learner and, for
      // anon, lives in sessionStorage under the "anon" scope.
      window.sessionStorage.setItem("ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world", "1");
    });
  });

  test("anon_page_view fires on /try/ mount", async ({ page }) => {
    const events = await recordTelemetry(page);
    await page.goto(ALLOWED_PATH);
    await waitForEvent(events, (e) => e.event === "anon_page_view");
    // Lesson chrome is reachable (sanity).
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("anon_wall_opened fires with reason='save' on header pill click", async ({
    page,
  }) => {
    const events = await recordTelemetry(page);
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /sign up to save/i }).click();
    await waitForEvent(
      events,
      (e) => e.event === "anon_wall_opened" && e.reason === "save",
    );
  });

  test("anon_wall_opened fires with reason='next-lesson' on explicit continuation", async ({
    page,
  }) => {
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
    const events = await recordTelemetry(page);
    await page.goto(ALLOWED_PATH);
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
    await page
      .getByRole("dialog", { name: /lesson complete/i })
      .getByRole("button", { name: /next lesson/i })
      .click();
    await waitForEvent(
      events,
      (e) => e.event === "anon_wall_opened" && e.reason === "next-lesson",
    );
  });

  test("anon_wall_opened fires with reason='exhausted' on 429 ANON_EXHAUSTED", async ({
    page,
  }) => {
    await page.route("**/api/anon/ai/ask/stream", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "ANON_EXHAUSTED" }),
      }),
    );
    const events = await recordTelemetry(page);
    await page.goto(ALLOWED_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    const textarea = page.getByLabel(/ask the tutor/i);
    await textarea.fill("hello");
    await textarea.press("Enter");
    await waitForEvent(
      events,
      (e) => e.event === "anon_wall_opened" && e.reason === "exhausted",
    );
  });

  test("anon_wall_opened fires with reason='share' from the explicit save-progress action", async ({
    page,
  }) => {
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
    await page.route("**/api/anon/shares", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ shareToken: "telemetry-share", url: "/s/telemetry-share" }),
      }),
    );
    const events = await recordTelemetry(page);
    await page.goto(ALLOWED_PATH);
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
    await page
      .getByRole("dialog", { name: /lesson complete/i })
      .getByRole("button", { name: /share/i })
      .first()
      .click();
    const shareDialog = page.getByRole("dialog", { name: /your first one/i });
    await expect(shareDialog).toBeVisible({ timeout: 5_000 });
    // Done is a truthful dismissal. Only the separately labelled save action
    // creates conversion intent and therefore emits the share-wall event.
    await shareDialog
      .getByRole("button", { name: /save this progress with a free account/i })
      .click();
    await waitForEvent(
      events,
      (e) => e.event === "anon_wall_opened" && e.reason === "share",
    );
    await expect(page.getByText(/Your share link is ready/i)).toBeVisible();
  });

  test("share actions keep copied, completed, cancelled, and dismissed distinct", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const target = window as Window & { __shareMode?: "complete" | "cancel" };
      target.__shareMode = "complete";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => undefined },
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => {
          if (target.__shareMode === "cancel") {
            throw new DOMException("cancelled", "AbortError");
          }
        },
      });
    });
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
    await page.route("**/api/anon/shares", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          shareToken: "23456789abcd",
          url: "/s/23456789abcd",
        }),
      }),
    );
    const events = await recordTelemetry(page);
    await page.goto(ALLOWED_PATH);
    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible();
    await page.getByRole("button", { name: /check/i }).first().click();
    const completion = page.getByRole("dialog", { name: /lesson complete/i });
    await expect(completion).toBeVisible();
    await completion.getByRole("button", { name: /share/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /your first one/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /copy link/i }).click();
    await waitForEvent(
      events,
      (event) =>
        event.outcome === "copied" && event.surface === "anonymous",
    );

    await dialog.getByRole("button", { name: /^share/i }).click();
    await waitForEvent(
      events,
      (event) =>
        event.outcome === "share_completed" &&
        event.surface === "anonymous",
    );

    await page.evaluate(() => {
      (window as Window & { __shareMode?: "complete" | "cancel" }).__shareMode =
        "cancel";
    });
    await dialog.getByRole("button", { name: /^share/i }).click();
    await waitForEvent(
      events,
      (event) =>
        event.outcome === "cancelled" && event.surface === "anonymous",
    );

    await dialog.getByRole("button", { name: /^done$/i }).click();
    await waitForEvent(
      events,
      (event) =>
        event.outcome === "dismissed" && event.surface === "anonymous",
    );
    await expect(dialog).toBeHidden();
  });

  test("share recovery stays keyboard-usable at 390px with reduced motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
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
    let createAttempts = 0;
    await page.route("**/api/anon/shares", (route) => {
      createAttempts += 1;
      if (createAttempts === 1) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "share preview temporarily unavailable" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          shareToken: "23456789abcd",
          url: "/s/23456789abcd",
        }),
      });
    });

    await page.goto(ALLOWED_PATH);
    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible();
    await page.getByRole("button", { name: /check/i }).first().click();
    const completion = page.getByRole("dialog", { name: /lesson complete/i });
    await expect(completion).toBeVisible();
    const shareButton = completion
      .getByRole("button", { name: /share/i })
      .first();

    await shareButton.click();
    const fallback = page.getByRole("dialog", {
      name: /your share link is ready/i,
    });
    await expect(fallback).toBeVisible();
    expect(createAttempts).toBe(1);
    await fallback.getByRole("button", { name: /maybe later/i }).click();
    await expect(fallback).toBeHidden();
    await expect(shareButton).toBeFocused();

    await shareButton.click();
    const shareDialog = page.getByRole("dialog", { name: /your first one/i });
    await expect(shareDialog).toBeVisible();
    expect(createAttempts).toBe(2);

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth + 1,
    );
    const panel = await shareDialog.boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(844);
    for (const name of [/copy link/i, /^done$/i]) {
      const box = await shareDialog.getByRole("button", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Tab");
    await expect(shareDialog.locator(":focus")).toHaveCount(1);
  });
});
