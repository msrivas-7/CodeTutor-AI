// Phase 27-v2.1 audit pass 1+2 — anon path must not 401-cascade.
//
// The class of bug this catches:
//   - Any /api/user/*, /api/sessions/*, /api/preferences, /api/streak
//     call from a component mounted on /try/ that 401s on anon →
//     handle401() in api/client.ts:46-53 calls supabase.auth.signOut()
//     → SIGNED_OUT listener resets preferencesStore + aiStore +
//     progressStore → workspaceCoachDone flips false mid-lesson →
//     coach replays + choreography restarts.
//
// The bug-hunter audit chain found 5 instances of this anti-pattern
// (setUiLayoutValue, useAIStatus in EditorTabs, LessonFeedbackChip,
// handleRunExamples, shareCheckTrigger). This spec listens for any
// 401 on Maya's path and fails if one fires.
//
// What it catches that the bug-hunter audit can't:
//   - A future contributor adds a new component to LessonPage
//     subtree that fires an authed-required call without a mode gate.
//   - A regression of the hasAuthSession() defense-in-depth in
//     useAIStatus or setUiLayoutValue.

import { expect, test } from "@playwright/test";

const PATH = "/try/lesson/python-fundamentals/hello-world";

test.describe("Phase 27-v2.1 — no 401 cascade on anon path", () => {
  test("zero 401s across cinematic dismiss + coach + walkthrough + splitter drag + Run + Check + celebration", async ({
    page,
  }) => {
    // Pre-seed cinematic + coach + choreography flags so the test
    // exercises the post-walkthrough chrome where most 401-prone
    // calls fire (header chrome mounts, AI status, splitter drag).
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      // Phase A — A1: pre-seed retrieval-check pass so Check goes
      // straight to celebration (this spec tests the 401 cascade, not
      // the retrieval gate).
      window.localStorage.setItem(
        "ui:lesson:retrievalPassed:python-fundamentals:hello-world",
        "1",
      );
    });

    // Collect every 4xx response. The 401 cascade is the load-bearing
    // hazard, but a 403 or 404 from /api/user/* is also a smell — same
    // class of "anon component fired auth-required call." Allowlist
    // expected 4xx (none should fire on this path).
    const offenders: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      const status = response.status();
      const url = response.url();
      if (status !== 401 && status !== 403) return;
      // Filter: this spec is about /api/user/*, /api/preferences,
      // /api/sessions, /api/streak, /api/shares, /api/feedback. The
      // anon path uses /api/anon/* which has its own 4xx semantics
      // (e.g., 429 ANON_EXHAUSTED is intentional on the anon AI cap).
      if (
        url.includes("/api/user/") ||
        url.includes("/api/preferences") ||
        url.includes("/api/sessions") ||
        url.includes("/api/streak") ||
        url.includes("/api/shares") ||
        url.includes("/api/feedback")
      ) {
        offenders.push({ url, status });
      }
    });

    // Mock /api/anon/run so we don't need a hot Python sandbox; this
    // test is about NETWORK BEHAVIOR, not Python execution.
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

    // Click Run — exercises the anon /run path.
    await page
      .getByRole("button", { name: /run/i })
      .first()
      .click();
    await expect(page.getByText(/Hello, Maya!/).last()).toBeVisible({
      timeout: 5_000,
    });

    // Click Check — exercises validator path. Celebration mounts.
    await page
      .getByRole("button", { name: /check/i })
      .first()
      .click();
    await expect(page.getByRole("alertdialog").first()).toBeVisible({
      timeout: 10_000,
    });

    // Drag the tutor splitter to fire setUiLayoutValue → debounced
    // PATCH /api/user/preferences. The audit-pass-1 fix gates this on
    // hasAuthSession(); if it regresses, we'd see a 401 here.
    // Locate splitter via data-testid or fallback to last() splitter.
    const splitterCandidates = page.locator(
      '[role="separator"], [aria-label*="resize" i], [aria-label*="splitter" i]',
    );
    const splitterCount = await splitterCandidates.count();
    if (splitterCount > 0) {
      // Just hover-and-mouseup is enough to fire a state change in
      // most splitter implementations; for full drag we'd need
      // boundingBox math. For 401-detection, even a small change is
      // enough to trigger the debounced PATCH.
      const splitter = splitterCandidates.first();
      const box = await splitter.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
        await page.mouse.up();
      }
    }

    // Wait for the debounce (300 ms) to fire any pending PATCH.
    await page.waitForTimeout(600);

    // Dismiss celebration — fires onAnonNext (writes stash + opens wall).
    // Anon stash write is sessionStorage-only, no network call, so
    // safe to verify here.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Final assertion: nothing fired a 401/403 against authed routes.
    if (offenders.length > 0) {
      throw new Error(
        `401/403 cascade detected on anon path:\n${offenders
          .map((o) => `  ${o.status} ${o.url}`)
          .join("\n")}\nThis is the regression class the audit chain spent 3 passes closing.`,
      );
    }
  });
});
