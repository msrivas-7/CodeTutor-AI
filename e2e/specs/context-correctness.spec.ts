// Phase 1A — adversarial lifecycle ordering. These tests deliberately hold
// successful Run, Check, and tutor responses until the project identity has
// changed. The late response must never publish into the new lesson/revision.

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { mockAllAI } from "../fixtures/aiMocks";
import { allPassing } from "../fixtures/harnessResults";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile, markOnboardingDone, seedApiKey } from "../fixtures/profiles";
import { criticalTest } from "../fixtures/testMetadata";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function afterBrowserResponseTurn(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe(
  "context correctness",
  criticalTest({
    risk: "p0",
    owner: "platform",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }),
  () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
    await markOnboardingDone(page);
  });

  test("a Run started in lesson A cannot publish after SPA navigation to lesson B", async ({ page }) => {
    await loadProfile(page, "capstones-pending");

    const release = deferred();
    const started = deferred();
    const settled = deferred();
    await page.route("**/api/execute", async (route) => {
      started.resolve();
      await release.promise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stdout: "STALE_LESSON_A_OUTPUT\n",
          stderr: "",
          exitCode: 0,
          errorType: "none",
          durationMs: 1,
          stage: "run",
        }),
      });
      settled.resolve();
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });

    await S.lessonRunButton(page).click();
    await started.promise;
    await S.nextLessonLessonPageButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/lesson/variables$`));
    await waitForMonacoReady(page);

    release.resolve();
    await settled.promise;
    await afterBrowserResponseTurn(page);
    await expect(page.getByText("STALE_LESSON_A_OUTPUT", { exact: true })).toHaveCount(0);
    await expect(S.outputPanel(page)).not.toContainText("STALE_LESSON_A_OUTPUT");
  });

  test("lesson navigation cancels and refunds a pending Tutor ask before lesson B", async ({ page }) => {
    await loadProfile(page, "capstones-pending");
    await seedApiKey(page, { key: "sk-test-e2e-padding-12345", model: "gpt-4o-mini" });

    const release = deferred();
    const started = deferred();
    const settled = deferred();
    let cancelCalls = 0;
    await page.route("**/api/ai/ask/cancel", async (route) => {
      cancelCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ canceled: true, refunded: true }),
      });
    });
    await page.route("**/api/ai/ask/stream", async (route) => {
      started.resolve();
      await release.promise;
      const sections = {
        intent: "concept",
        summary: "STALE_TUTOR_ANSWER_FROM_LESSON_A",
        explain: "This answer belongs only to lesson A.",
        stuckness: "low",
      };
      try {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
          },
          body: `data: ${JSON.stringify({ delta: "STALE_TUTOR_ANSWER_FROM_LESSON_A" })}\n\ndata: ${JSON.stringify({ done: true, raw: JSON.stringify(sections), sections })}\n\n`,
        });
      } catch {
        // Navigation normally aborts the transport before this delayed mock
        // can fulfill. Callback guards are still tested on engines where the
        // response wins that race.
      } finally {
        settled.resolve();
      }
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await expect(S.tutorInput(page)).toBeEnabled({ timeout: 10_000 });

    await S.tutorInput(page).fill("QUESTION_ONLY_FOR_LESSON_A");
    await page.getByRole("button", { name: /^ask$/i }).click();
    await started.promise;
    await S.nextLessonLessonPageButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/lesson/variables$`));
    await waitForMonacoReady(page);
    await expect.poll(() => cancelCalls).toBe(1);
    await expect(S.tutorInput(page)).toBeEnabled({ timeout: 10_000 });

    release.resolve();
    await settled.promise;
    await afterBrowserResponseTurn(page);
    await expect(page.getByText("QUESTION_ONLY_FOR_LESSON_A", { exact: true })).toHaveCount(0);
    await expect(page.getByText("STALE_TUTOR_ANSWER_FROM_LESSON_A", { exact: true })).toHaveCount(0);
  });

  test("a successful Check cannot complete a revision edited while tests were running", async ({ page }) => {
    await loadProfile(page, "capstones-pending");

    const release = deferred();
    const started = deferred();
    const settled = deferred();
    await page.route("**/api/execute/tests", async (route) => {
      started.resolve();
      await release.promise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(allPassing),
      });
      settled.resolve();
    });

    await page.goto(`/learn/course/${COURSE_ID}/lesson/functions`);
    await waitForMonacoReady(page);
    await expect(S.checkMyWorkButton(page)).toBeEnabled({ timeout: 30_000 });

    await S.checkMyWorkButton(page).click();
    await started.promise;
    await setMonacoValue(page, "def square(n):\n    return\n");
    release.resolve();
    await settled.promise;
    await afterBrowserResponseTurn(page);

    await expect(S.checkMyWorkButton(page)).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole("dialog", { name: /lesson complete/i })).toHaveCount(0);
  });
  },
);
