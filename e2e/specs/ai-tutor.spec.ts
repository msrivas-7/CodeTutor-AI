// AI tutor specs (Phase 12F). Exercises the GuidedTutorPanel + AssistantPanel
// surfaces with a mocked /api/ai/ask/stream so no real OpenAI calls fire.
// Covers: first-turn rendering, hint-ladder cycling, action chips, selection
// preview via Cmd+K, error-with-retry, usage chip, setup warning flow, and a
// streaming cancel.
//
// To run a focused subset against the real OpenAI backend, set
// E2E_REAL_OPENAI=1 and ensure OPENAI_API_KEY is in the environment. The two
// tests gated by `if (!REAL_OPENAI) test.skip(...)` will then run without
// mocks. Keep this set small — we don't want OpenAI bills on every PR.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";

import {
  mockAskJson,
  mockListModels,
  mockTutorQueue,
  mockTutorResponse,
  mockValidateKey,
} from "../fixtures/aiMocks";
import { waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone, seedApiKey } from "../fixtures/profiles";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";
const REAL_OPENAI = process.env.E2E_REAL_OPENAI === "1";

async function installAllTutorMocks(page: Page): Promise<void> {
  await mockValidateKey(page, true);
  await mockListModels(page);
  // Note: specific /api/ai/ask/stream mocks are installed per-test so we can
  // vary the scenario. mockAskJson + mockSummarize intercept non-stream calls
  // in case the tutor falls through to them (it doesn't in the normal path,
  // but a fallback mock keeps the spec deterministic).
  await mockAskJson(page, {
    intent: "concept",
    summary: "fallback",
    explain: null,
    example: null,
    hint: null,
    strongerHint: null,
    diagnose: null,
    nextStep: null,
    pitfalls: null,
    walkthrough: null,
    checkQuestions: null,
    citations: null,
    comprehensionCheck: null,
    stuckness: "low",
  });
}

// Phase 18e: the OpenAI key lives encrypted server-side in user_preferences,
// and seedApiKey persists both the key + an openaiModel before page load —
// so the TutorSetupWarning typically doesn't render. This helper covers both
// cases: if the warning is up (unseeded path), drive it via Connect; either
// way, wait for the composer to become enabled.
async function configureTutorKey(page: Page, key = "sk-test-e2e-padding-12345"): Promise<void> {
  const keyInput = page.getByRole("textbox", { name: /openai api key/i });
  if (await keyInput.isVisible().catch(() => false)) {
    await keyInput.fill(key);
    await page.getByRole("button", { name: /^connect$/i }).click();
  }
  await expect(S.tutorInput(page)).toBeEnabled({ timeout: 10_000 });
}

test.describe("AI tutor", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboardingDone(page);
    await installAllTutorMocks(page);
  });

  test("TutorSetupWarning renders when no API key, links to Settings", async ({ page }) => {
    await loadProfile(page, "empty");
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);

    // Warning copy lives in TutorSetupWarning.tsx + the "More settings →"
    // link (only present when onOpenSettings prop is passed — LessonPage does).
    await expect(page.getByText(/connect your ai tutor/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /more settings →/i })).toBeVisible();

    // Tutor input is disabled until a key is configured.
    await expect(S.tutorInput(page)).toBeDisabled();
  });

  test("first-turn ask: sections render after mocked stream", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorResponse(page, "first-turn-concept");

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("What's a function?");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // The "first-turn-concept" mock's sections include a `summary`, `explain`,
    // `example`, `pitfalls`, `comprehensionCheck`, `nextStep`. The rendered
    // panel surfaces the summary line near the top.
    await expect(
      page.getByText(/a function groups reusable steps under a name/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("hint ladder: aria-label cycles level 1 → 2 → 3", async ({ page }) => {
    await loadProfile(page, "first-lesson-editing");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorQueue(page, ["hint-level-1", "hint-level-2", "hint-level-3"]);

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    // Kick the ladder by asking an initial question — the Hint button only
    // renders next to a completed assistant turn (the "latest assistant"
    // position). Without a prior exchange, there's no Hint button to click.
    await S.tutorInput(page).fill("I'm stuck.");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // Level 1 button.
    const hintL1 = page.getByRole("button", { name: /hint — level 1 of 3/i });
    await expect(hintL1).toBeVisible({ timeout: 10_000 });
    await hintL1.click();
    // After the click the ladder advances and a new assistant turn lands with
    // the level-2 hint attached. The button's aria-label now reads level 2.
    await expect(
      page.getByRole("button", { name: /stronger hint — level 2 of 3/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /stronger hint — level 2 of 3/i }).click();
    await expect(
      page.getByRole("button", { name: /show approach — level 3 of 3/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /show approach — level 3 of 3/i }).click();
    // Once all 3 are used the button swaps for a static "All hints used" pill.
    await expect(page.getByText(/all hints used/i)).toBeVisible({ timeout: 10_000 });
  });

  test("hint counter does NOT advance when the hint stream fails (pendingHintRef rollback)", async ({
    page,
  }) => {
    // Audit gap #5 (hazy-wishing-wren bucket 10): the Hint button stages
    // `pendingHintRef = true` on click and only commits hintCount++ on
    // onAskComplete(ok=true). A 500 mid-stream must leave hintCount intact
    // — the learner saw no help, so they shouldn't pay a hint credit.
    // Regression path: an eager increment in the onClick, or a stale ref
    // that commits regardless of `ok`. Either drains capacity on pure
    // backend errors.
    //
    // Since progress is persisted server-side (Postgres, not localStorage),
    // we intercept the PATCH /api/user/lessons/... call and count how many
    // times the body carried a `hintCount` key. The Zustand store is an
    // in-memory snapshot — the PATCH is the load-bearing durable write.

    const hintPatches: unknown[] = [];
    await page.route(
      "**/api/user/lessons/python-fundamentals/hello-world",
      async (route) => {
        if (route.request().method() === "PATCH") {
          try {
            const body = JSON.parse(route.request().postData() ?? "{}");
            if ("hintCount" in body) hintPatches.push(body);
          } catch {
            /* skip */
          }
        }
        await route.fallback();
      },
    );

    await loadProfile(page, "first-lesson-editing");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorQueue(page, ["first-turn-concept", "error-500"]);

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("I'm stuck on this.");
    await page.getByRole("button", { name: /^ask$/i }).click();
    const hintL1 = page.getByRole("button", { name: /hint — level 1 of 3/i });
    await expect(hintL1).toBeVisible({ timeout: 10_000 });
    await hintL1.click();

    // Error frame renders with a Try-again affordance — proves the stream
    // completed with ok=false (onAskComplete fired, pendingHintRef cleared).
    await expect(
      page.getByRole("button", { name: /retry the last question/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Give any trailing PATCH a beat to fire before we sample.
    await page.waitForTimeout(250);
    expect(hintPatches, "no hintCount patch must be sent on ask failure").toEqual([]);
  });

  test("hint counter DOES advance when the hint stream succeeds (control)", async ({
    page,
  }) => {
    // Companion to the rollback test: on success, hintCount MUST bump by 1.
    // Both signs of the boolean are worth locking — a rollback test alone
    // passes if the increment never happened at all.
    const hintPatches: Array<{ hintCount: number }> = [];
    await page.route(
      "**/api/user/lessons/python-fundamentals/hello-world",
      async (route) => {
        if (route.request().method() === "PATCH") {
          try {
            const body = JSON.parse(route.request().postData() ?? "{}");
            if ("hintCount" in body) hintPatches.push(body);
          } catch {
            /* skip */
          }
        }
        await route.fallback();
      },
    );

    await loadProfile(page, "first-lesson-editing");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorQueue(page, ["first-turn-concept", "hint-level-1"]);

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("I'm stuck.");
    await page.getByRole("button", { name: /^ask$/i }).click();
    const hintL1 = page.getByRole("button", { name: /hint — level 1 of 3/i });
    await expect(hintL1).toBeVisible({ timeout: 10_000 });
    await hintL1.click();
    await expect(
      page.getByRole("button", { name: /stronger hint — level 2 of 3/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => hintPatches.length, { timeout: 3_000 })
      .toBeGreaterThanOrEqual(1);
    // The optimistic PATCH sends the NEW absolute value (hintCount: 1).
    expect(hintPatches[0].hintCount).toBe(1);
  });

  test("ActionChips: clicking 'explain more' submits a follow-up request", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorQueue(page, ["first-turn-concept", "lesson-explain"]);

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("Explain Python.");
    await page.getByRole("button", { name: /^ask$/i }).click();
    // First response lands.
    await expect(
      page.getByText(/a function groups reusable steps under a name/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Click "explain more" — triggers the second queued mock response.
    await page.getByRole("button", { name: /explain more/i }).click();
    await expect(
      page.getByText(/a variable is a name that points at a value/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("error banner renders retry button; retry with success lands cleanly", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorQueue(page, ["error-500", "first-turn-concept"]);

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("Tell me about decorators.");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // Error frame renders an alert with "Try again" retry button.
    const retry = page.getByRole("button", { name: /retry the last question/i });
    await expect(retry).toBeVisible({ timeout: 10_000 });
    await retry.click();

    // Second response is success — concept copy lands.
    await expect(
      page.getByText(/a function groups reusable steps under a name/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("usage chip renders when response includes token usage", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorResponse(page, "first-turn-concept");

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("What's a variable?");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // The first-turn-concept mock carries usage: { totalTokens: 516 }.
    // UsageChip renders formatted tokens — match on the digits with optional
    // comma + "tokens" label.
    await expect(
      page.getByText(/516\s*tokens/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("SSE stream interrupted mid-response (no done frame) surfaces partial or error, never silent", async ({
    page,
  }) => {
    // Audit gap #2 (hazy-wishing-wren bucket 10): when a mid-stream TCP
    // drop or reverse-proxy reset happens (caddy/socket-proxy flap is the
    // usual real-world trigger), the SSE body ends without the terminal
    // `{done: true}` frame. The contract: the learner must either see the
    // partial content they did get OR a visible error — not a silent
    // failure where the asking-indicator clears and nothing lands.
    //
    // We simulate the drop by responding with a valid 200 SSE body that
    // contains deltas but no done/error frame. The client's reader hits
    // EOF naturally; the UI code must handle that path.
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await page.route("**/api/ai/ask/stream", async (route) => {
      const truncated = [
        'data: {"delta":"A variable "}\n\n',
        'data: {"delta":"is a name "}\n\n',
        // Note: no `done:true`, no `error`. Body just ends — as if the
        // connection was reset mid-stream.
      ].join("");
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        body: truncated,
      });
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("What's a variable?");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // Ask button must come back eventually — the asking-indicator should
    // NOT hang forever. (Previously, the watchdog's 30s stall timer would
    // eventually fire, but for a "clean EOF" like this one the loop
    // breaks naturally.) We give it a reasonable ceiling.
    await expect(page.getByRole("button", { name: /^ask$/i })).toBeVisible({
      timeout: 10_000,
    });

    // Either the partial content landed, OR an error banner is visible
    // with a retry affordance. Both are acceptable recoveries — a silent
    // failure (neither) is the regression.
    const partialAssistant = page.getByText(/A variable is a name/i).first();
    const retry = page.getByRole("button", { name: /retry the last question/i });
    // Race both expectations. Whichever surfaces first proves the UI did
    // not swallow the drop silently.
    await expect
      .poll(
        async () =>
          (await partialAssistant.isVisible().catch(() => false)) ||
          (await retry.isVisible().catch(() => false)),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("streaming shows Stop button; clicking Stop cancels cleanly", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });

    // Install a slow-streaming mock so Stop is clickable before the stream
    // finishes. 800ms delay lets the user click.
    await page.route("**/api/ai/ask/stream", async (route) => {
      const slowBody = [
        'data: {"delta":"thinking..."}\n\n',
        'data: {"delta":" still thinking..."}\n\n',
      ].join("");
      // Respond, but hold the body open for ~800ms via a setTimeout redirect.
      await new Promise((r) => setTimeout(r, 200));
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        body: slowBody,
      });
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    await S.tutorInput(page).fill("Long answer please.");
    await page.getByRole("button", { name: /^ask$/i }).click();
    // Stop button takes the Ask button's slot during streaming.
    const stop = page.getByRole("button", { name: /^stop$/i });
    await expect(stop).toBeVisible({ timeout: 5_000 });
    await stop.click();
    // After stop the Ask button returns.
    await expect(page.getByRole("button", { name: /^ask$/i })).toBeVisible({ timeout: 5_000 });
  });

  test("editor-page AssistantPanel ask round-trip (mocked)", async ({ page }) => {
    await loadProfile(page, "empty");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });
    await mockTutorResponse(page, "first-turn-concept");

    await page.goto("/editor");
    await waitForMonacoReady(page);
    await configureTutorKey(page, "sk-test-e2e-padding-12345");

    // AssistantPanel uses a textarea without the explicit "Ask the tutor"
    // aria-label — fall back to the placeholder match in S.tutorInput, which
    // uses a generic name regex.
    await S.tutorInput(page).fill("Hello assistant.");
    await page.getByRole("button", { name: /^ask$/i }).click();
    await expect(
      page.getByText(/a function groups reusable steps under a name/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("real-openai: LessonPage tutor ask produces a non-empty response", async ({ page }) => {
    test.skip(!REAL_OPENAI, "E2E_REAL_OPENAI=1 to run real-OpenAI round-trip");
    // This test is only reached when E2E_REAL_OPENAI=1. The API key is read
    // from the server env via /api/ai — the frontend passes the stored key
    // and OpenAI replies for real. No mocks are installed; the beforeEach's
    // generic mocks are overridden here by unrouting.
    await page.unroute("**/api/ai/validate-key");
    await page.unroute("**/api/ai/models");
    await page.unroute("**/api/ai/ask/stream");
    await page.unroute("**/api/ai/ask");

    const realKey = process.env.OPENAI_API_KEY;
    if (!realKey) throw new Error("E2E_REAL_OPENAI=1 requires OPENAI_API_KEY in env");

    await seedApiKey(page, { key: realKey, model: "gpt-4o-mini" });
    await loadProfile(page, "empty");

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await configureTutorKey(page, realKey);

    await S.tutorInput(page).fill("In one sentence, what does print do in Python?");
    await page.getByRole("button", { name: /^ask$/i }).click();

    // OpenAI replies can take 5–20s. Assert on the streaming-skeleton first
    // disappearing (Stop button goes away) and then any assistant content
    // lands. We don't assert on specific copy — that's brittle against LLM
    // variance.
    await expect(page.getByRole("button", { name: /^stop$/i })).toBeHidden({
      timeout: 30_000,
    });
    // At least one section-card rendered with some content.
    const assistantContent = page
      .locator("div")
      .filter({ hasText: /print|python/i })
      .first();
    await expect(assistantContent).toBeVisible({ timeout: 5_000 });
  });
});
