// Phase 27-v2.1 audit pass 1 fix #5 — ANON_EXHAUSTED 429 → SignupWallDialog reason="exhausted".
//
// When the L_anon per-IP daily AI cap (8 questions/IP/day per
// backend/src/routes/anon.ts:198-203) is hit, /api/anon/ai/ask/stream
// returns 429 with body `{"error":"ANON_EXHAUSTED",...}`. Pre-fix
// behavior: the raw error string surfaced in the AskErrorView with a
// Retry button that 429s again — Maya saw a broken tutor instead of
// the wall. Pass-2 P2 #2 also tightened the regex from `/...|429/i`
// to `/ANON_EXHAUSTED/i` to avoid false positives on generic 429s
// from upstream providers.
//
// This spec mocks the SSE response and asserts the wall opens with
// reason="exhausted" copy.

import { expect, test } from "@playwright/test";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";

const PATH = "/try/lesson/python-fundamentals/hello-world";

test.describe("Phase 27-v2.1 — ANON_EXHAUSTED → wall pivot", () => {
  test("hint button hits 429 ANON_EXHAUSTED → SignupWallDialog reason='exhausted' opens", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
    });

    // Mock the anon AI stream to return 429 with the ANON_EXHAUSTED
    // body. The streaming client (askAIStream in api/client.ts) reads
    // the response body for the error message; since it's not a
    // valid SSE stream, the client will raise via the throw path
    // which surfaces the body text into onError.
    await page.route("**/api/anon/ai/ask/stream", (route) => {
      requestCount += 1;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "ANON_EXHAUSTED",
          remainingToday: 0,
          capToday: 8,
        }),
      });
    });

    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Type a question into the tutor textarea and press Enter. This
    // fires submitAsk → useTutorAsk → askAIStream → mocked 429 →
    // useTutorAsk's onError detects /ANON_EXHAUSTED/i → fires
    // opts.onAnonExhausted → AnonLessonPage opens the wall. We can't
    // use the hint button because it only renders below the latest
    // assistant message (no history yet on choreography-done state).
    const textarea = page.getByLabel(/ask the tutor/i);
    await textarea.fill("Why is the sky blue?");
    await textarea.press("Enter");

    // Wall opens with the "exhausted" reason copy. The current copy
    // is "You're getting it." (header) + "free tutor questions for
    // today" body. Match a phrase distinctive enough to not collide
    // with the other reasons but flexible to wording.
    await expect(
      page.getByText(/You're getting it\./i).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText(/free tutor questions/i).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /not yet/i }).click();
    await expect(
      page.getByText(/I couldn't send that because today's free tutor questions are used/i),
    ).toBeVisible();
    await expect(textarea).toBeDisabled();
    await expect(textarea).toHaveAttribute(
      "placeholder",
      /Free tutor questions used today/i,
    );
    await expect(
      page.getByRole("button", { name: /Nudge me/i }),
    ).toBeDisabled();
    expect(requestCount).toBe(1);
  });

  test("phone error help keeps the exhausted tutor response visible after dismissing signup", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
    });
    await page.route("**/api/anon/run", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stdout: "",
          stderr:
            '  File "/workspace/main.py", line 1\n    print(\n         ^\nSyntaxError: \'(\' was never closed\n',
          exitCode: 1,
          errorType: "runtime",
          durationMs: 8,
          stage: "run",
          contextualEvidenceToken: "signed-contextual-evidence",
        }),
      }),
    );
    await page.route("**/api/anon/ai/ask/stream", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "ANON_EXHAUSTED" }),
      }),
    );
    await page.route("**/api/anon/ai-status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contextualTutorEnabled: true,
          contextualTutorModelEligible: true,
        }),
      }),
    );

    await page.goto(PATH);
    await waitForMonacoReady(page);
    await setMonacoValue(page, 'print("Hello"\n');
    await page.getByRole("button", { name: /^run code/i }).first().click();

    // Release 1C replaces the generic error-help CTA with the deterministic
    // evidence bridge. Preserve the same authored error through an edit and
    // second Run to reach the explicit-consent contextual Tutor offer.
    await expect(
      page.getByRole("button", { name: /ask the tutor what went wrong/i }),
    ).toHaveCount(0);
    await setMonacoValue(page, 'print("Hello, learner"\n');
    await page.getByRole("button", { name: /^run code/i }).first().click();

    const contextualHelp = page.getByRole("button", {
      name: "Help me spot it",
    });
    await expect(contextualHelp).toBeVisible();
    await contextualHelp.click();
    await expect(page.getByRole("dialog", { name: /you're getting it/i })).toBeVisible();
    await page.getByRole("button", { name: /not yet/i }).click();

    const quotaMessage = page.getByText(
      /I couldn't send that because today's free tutor questions are used/i,
    );
    await expect(quotaMessage).toBeVisible();
    await expect(quotaMessage).toBeInViewport();
    await expect(page.getByTestId("contextual-guide-bridge")).toBeVisible();
    await expect(page.getByTestId("contextual-guide-ask")).toHaveText("Open Tutor");
    const tutor = page.getByRole("region", { name: "AI tutor" });
    await expect(tutor).toBeInViewport();
    await expect(tutor).toBeFocused();
  });

  test("regex tightening: a generic 429 from a non-ANON_EXHAUSTED upstream does NOT fire the wall", async ({
    page,
  }) => {
    // Pass-2 P2 #2: the original /ANON_EXHAUSTED|anon_exhausted|429/i
    // regex would match upstream proxy 429 messages that happen to
    // mention "429". The tightened /ANON_EXHAUSTED/i avoids that.
    // Mock a 429 with a generic body (no ANON_EXHAUSTED token).
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
    });

    await page.route("**/api/anon/ai/ask/stream", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Too many requests upstream",
          retryAfter: 30,
        }),
      }),
    );

    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const textarea = page.getByLabel(/ask the tutor/i);
    await textarea.fill("Why is the sky blue?");
    await textarea.press("Enter");

    // Give onError + state-update a moment to settle.
    await page.waitForTimeout(800);

    // Wall should NOT open with "exhausted" reason copy.
    await expect(page.getByText(/You're getting it\./i)).toHaveCount(0);
    // The error should surface in the AskErrorView (or similar) — not
    // necessarily visible-text-asserted here, but the wall's absence
    // is the load-bearing assertion.
  });
});
