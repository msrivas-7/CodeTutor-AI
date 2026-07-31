// Anonymous handoff stash + B5 inline account-creation contract.
//
// The full flow (cinematic → coach → walkthrough → Run → Check →
// celebration → Next Lesson → wall) splits across multiple specs:
//   - anon-lesson.spec.ts — cinematic + coach mount/dismiss
//   - anon-celebration-dismiss-lock.spec.ts — celebration → wall
//   - anon-handoff-flow.spec.ts — wall → signup → handoff → lesson 2
//
// What this spec covers that NONE of the others do:
//   1. The sessionStorage anon stash is written with the correct
//      schema when Next Lesson is clicked from the celebration
//      (handoff endpoint requires courseId + lessonId + non-empty
//      code + completedAt + flags.welcomeDone).
//   2. The continuation card creates the account inline, makes no auth
//      request before explicit submission, and stays on the lesson while
//      email confirmation is pending.
//
// Driving through the actual cinematic + walkthrough is brittle and
// covered by the broader chrome specs; here we seed flags to land
// directly on the working chrome and drive Run + Check + celebration.

import { expect, test } from "@playwright/test";

const PATH = "/try/lesson/python-fundamentals/hello-world";
const PASSWORD = "E2ePass9!secure";

test.describe("Anonymous stash + B5 inline signup contract", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
      // Phase A — A1: pre-seed the retrieval-check pass so the celebration
      // mounts immediately on Check. The retrieval gate has its own spec
      // (retrieval-check-gate.spec.ts).
      // Phase A: the retrieval pass is scoped to the learner and, for
      // anon, lives in sessionStorage under the "anon" scope.
      window.sessionStorage.setItem("ui:lesson:retrievalPassed:anon:python-fundamentals:hello-world", "1");
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
  });

  test("clicking 'Next Lesson' from celebration writes stash with handoff-endpoint schema", async ({
    page,
  }) => {
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

    // Stash should NOT exist yet (only written on Next-Lesson click).
    const stashBefore = await page.evaluate(() =>
      window.sessionStorage.getItem("codetutor.anonRun"),
    );
    expect(stashBefore).toBeNull();

    // Click Next Lesson.
    await page
      .getByRole("dialog", { name: /lesson complete/i })
      .getByRole("button", { name: /next lesson/i })
      .click();

    // Wall opens (parity with anon-celebration-dismiss-lock spec).
    await expect(page.getByText(/Lesson 2 is queued up\./i)).toBeVisible({
      timeout: 5_000,
    });

    // Stash written. Schema must match what /api/anon/handoff expects:
    // courseId, lessonId, code (non-empty), completedAt, flags.welcomeDone.
    const stashRaw = await page.evaluate(() =>
      window.sessionStorage.getItem("codetutor.anonRun"),
    );
    expect(stashRaw).not.toBeNull();
    const stash = JSON.parse(stashRaw!);
    expect(stash.courseId).toBe("python-fundamentals");
    expect(stash.lessonId).toBe("hello-world");
    expect(typeof stash.code).toBe("string");
    expect(stash.code.length).toBeGreaterThan(0);
    // Audit pass 2 P2 #16: defensive — stash code should never be
    // empty, otherwise handoff POST 400s on z.string().min(1).
    expect(stash.code.trim()).not.toBe("");
    expect(stash.completedAt).toBeTruthy();
    // Verify completedAt parses as ISO 8601.
    expect(() => new Date(stash.completedAt).toISOString()).not.toThrow();
    expect(stash.flags?.welcomeDone).toBe(true);
    expect(typeof stash.flags?.workspaceCoachDone).toBe("boolean");
  });

  test("wall creates the account inline and keeps the lesson in place", async ({
    page,
  }) => {
    const email = "b5-inline@example.com";
    let signupCalls = 0;
    let resendCalls = 0;
    let signupPayload: Record<string, unknown> | null = null;
    await page.route("**/auth/v1/signup**", async (route) => {
      signupCalls += 1;
      signupPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "00000000-0000-0000-0000-000000000005",
          email,
          role: "",
          aud: "authenticated",
          confirmation_sent_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          identities: [],
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
        }),
      });
    });
    await page.route("**/auth/v1/resend**", async (route) => {
      resendCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, error: null }),
      });
    });

    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    // Use the header pill to reach the wall fast (no Run/Check needed).
    await page.getByRole("button", { name: /sign up to save/i }).click();
    const dialog = page.getByRole("dialog", { name: /sign up to save/i });
    await expect(dialog).toBeVisible();
    expect(signupCalls).toBe(0);
    expect(new URL(page.url()).pathname).toBe(PATH);

    await dialog.getByLabel(/first name/i).fill("Maya");
    await dialog.getByLabel(/email/i).fill(email);
    await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await dialog.getByLabel(/confirm password/i).fill(PASSWORD);
    await dialog
      .getByRole("button", { name: /create account & start saving/i })
      .click();

    const confirmation = page.getByRole("dialog", { name: /check your email/i });
    await expect(
      confirmation.getByRole("heading", { name: /check your email/i }),
    ).toBeVisible();
    await expect(confirmation.getByText(email)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(PATH);
    expect(signupCalls).toBe(1);
    expect(
      (signupPayload as { data?: Record<string, unknown> } | null)?.data,
    ).toMatchObject({ first_name: "Maya" });

    await confirmation
      .getByRole("button", { name: /resend confirmation email/i })
      .click();
    await expect.poll(() => resendCalls).toBe(1);
  });
});
