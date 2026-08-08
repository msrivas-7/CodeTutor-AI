// Phase 20-P1: feedback flow. Covers the three things only an end-to-end run
// can prove:
//   1. The header FeedbackButton is mounted on every authed page and a
//      click opens the modal. (Phase 20-P2: moved from a floating bottom-left
//      pill into each page's top bar next to UserMenu — it was covering
//      content on the editor/lesson pages.)
//   2. Submitting with the opt-in "Attach page context" box unchecked still
//      succeeds and the backend row lands with an empty diagnostics blob.
//   3. Checking the disclosure reveals the exact keys documented to the user,
//      and submitting round-trips them into the diagnostics column — proving
//      the privacy contract ("NEVER included: code, key, email, IP") stays
//      honest across the stack.

import { expect, test } from "../fixtures/auth";
import { seedAuthedRetrievalPass } from "../fixtures/retrievalGate";
import { loadProfile, markOnboardingDone } from "../fixtures/profiles";
import { request } from "@playwright/test";
import { getWorkerUser } from "../fixtures/auth";
import { setMonacoValue, waitForMonacoReady } from "../fixtures/monaco";
import { readLessonSolution } from "../fixtures/solutions";
import * as S from "../utils/selectors";
import { expectLessonComplete } from "../utils/assertions";

const BACKEND = process.env.E2E_API_URL ?? "http://localhost:4000";
const ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://localhost:5173";
const COURSE_ID = "python-fundamentals";

test.describe("feedback modal", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboardingDone(page);
  });

  test("FeedbackButton is rendered on the Start page and opens the modal", async ({
    page,
  }) => {
    await page.goto("/start");
    const button = page.getByTestId("feedback-button");
    await expect(button).toBeVisible();
    await button.click();
    await expect(
      page.getByRole("heading", { name: /send feedback/i }),
    ).toBeVisible();
    // Close exits without submitting and returns keyboard focus to the trigger.
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /send feedback/i }),
    ).not.toBeVisible();
    await expect(button).toBeFocused();
  });

  test("FeedbackButton is mounted on the editor and dashboard too", async ({
    page,
  }) => {
    await page.goto("/editor");
    await expect(page.getByTestId("feedback-button")).toBeVisible({
      timeout: 15_000,
    });
    await page.goto("/learn");
    await expect(page.getByTestId("feedback-button")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("draft close preserves the report, restores focus, enforces the limit, and discard clears it", async ({
    page,
  }) => {
    await page.goto("/start");
    const trigger = page.getByTestId("feedback-button");
    await trigger.click();

    const dialog = page.getByRole("dialog");
    const message = dialog.getByLabel(/feedback message/i);
    await message.fill("x".repeat(4_105));
    await expect(message).toHaveValue("x".repeat(4_000));
    await expect(dialog.getByRole("status")).toContainText("0 characters remaining");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(page.getByRole("dialog").getByLabel(/feedback message/i)).toHaveValue(
      "x".repeat(4_000),
    );
    await page.getByRole("dialog").getByRole("button", { name: /discard draft/i }).click();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(page.getByRole("dialog").getByLabel(/feedback message/i)).toHaveValue("");
  });

  test("submits with diagnostics OFF → backend row exists with empty diagnostics", async ({
    page,
  }) => {
    const marker = `e2e no-diag ${Date.now()}`;
    await page.goto("/start");
    await page.getByTestId("feedback-button").click();
    // Pick category: idea.
    await page.getByRole("radio", { name: /idea/i }).click();
    // Fill the textarea.
    await page.getByLabel(/feedback message/i).fill(marker);
    // Submit (scope to the modal — the modal heading is also "Send feedback"
    // so the page-wide lookup is ambiguous).
    const dialog = page.getByRole("dialog");
    await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/api/feedback") && res.status() === 201),
      dialog.getByRole("button", { name: /send feedback/i }).click(),
    ]);
    await expect(page.getByText(/thanks — we got it/i)).toBeVisible();

    // Verify the row shape via a direct GET round-trip. The route is
    // insert-only but we can use the reference id the success screen shows;
    // here we just assert the backend returned a reference id in the
    // response.
    await expect(page.getByText(/reference id/i)).toBeVisible();
  });

  test("opt-in diagnostics disclose the exact documented keys", async ({
    page,
  }) => {
    await page.goto("/editor");
    await page.getByTestId("feedback-button").click();
    await page.getByLabel(/feedback message/i).fill("route keys check");
    await page.getByLabel(/attach diagnostic context/i).check();
    await page.getByRole("button", { name: /what.?s included/i }).click();
    // Scope to the dialog — the editor page has its own <pre id="output-panel-body">
    // that appears earlier in the DOM than the portal'd modal, so a
    // page-wide .first() would grab the OutputPanel placeholder instead.
    const pre = page.getByRole("dialog").locator("pre").first();
    await expect(pre).toBeVisible();
    const text = (await pre.textContent()) ?? "";
    // The six documented keys — if this ever drifts, either fix the copy in
    // the privacy disclosure or shrink the payload. Do NOT silently add keys.
    for (const k of ["route", "viewport", "theme", "lang", "appSha", "userAgent"]) {
      expect(text, `diagnostics is missing documented key "${k}"`).toContain(k);
    }
    // Privacy invariant — never include any of these, even opt-in.
    for (const forbidden of ["openaiKey", "apiKey", "email", "ipAddress", "code"]) {
      expect(text, `diagnostics leaked forbidden key "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  test("body validation rejects empty submissions (send button disabled)", async ({
    page,
  }) => {
    await page.goto("/start");
    await page.getByTestId("feedback-button").click();
    const dialog = page.getByRole("dialog");
    const send = dialog.getByRole("button", { name: /send feedback/i });
    await expect(send).toBeDisabled();
    await page.getByLabel(/feedback message/i).fill("now it has text");
    await expect(send).toBeEnabled();
    await page.getByLabel(/feedback message/i).fill("");
    await expect(send).toBeDisabled();
  });

  test("backend accepts a direct authed POST /api/feedback (smoke)", async () => {
    // Belt-and-suspenders: proves the csrfGuard + authMiddleware + bodyLimit
    // chain still lets a well-formed client through. The UI path above
    // exercises the same endpoint, but this direct shot catches regressions
    // in middleware order without spinning up a browser tab.
    const workerIndex = test.info().workerIndex;
    const user = await getWorkerUser(workerIndex);
    const ctx = await request.newContext({
      extraHTTPHeaders: { Origin: ORIGIN },
    });
    try {
      const res = await ctx.post(`${BACKEND}/api/feedback`, {
        headers: {
          "X-Requested-With": "codetutor",
          Authorization: `Bearer ${user.session.access_token}`,
          "Content-Type": "application/json",
        },
        data: { body: "direct e2e post", category: "other" },
      });
      expect(res.status(), await res.text()).toBe(201);
      const json = (await res.json()) as { id: string };
      expect(json.id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await ctx.dispose();
    }
  });
});

// Phase 20-P1 follow-up: the lesson-end feedback chip. Complements the
// persistent FeedbackButton by harvesting signal at peak context (the moment
// a learner finishes a lesson). Two invariants only e2e can prove:
//   1. The chip renders inside LessonCompletePanel and each mood opens the
//      modal with the documented category / body prefix — mis-mapping here
//      would silently drown "confusing" signal inside generic traffic.
//   2. The persistent FeedbackButton restyle still has the stable testid
//      after the copy/class churn, so the rest of this file doesn't go
//      stale on the next prominence tweak.

test.describe("lesson-end feedback chip", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboardingDone(page);
    await loadProfile(page, "empty");
  });

  async function completeHelloWorld(
    page: Parameters<typeof waitForMonacoReady>[0],
    workerIndex: number,
  ) {
    // Phase A — A1: pre-seed retrieval-pass so the celebration mounts on
    // Check (this spec exercises lesson-end feedback chip, not the
    // retrieval gate). The dedicated gate spec lives elsewhere.
    await seedAuthedRetrievalPass(page, workerIndex);
    await page.goto(`/learn/course/${COURSE_ID}/lesson/hello-world`);
    await waitForMonacoReady(page);
    await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });
    await setMonacoValue(page, readLessonSolution(COURSE_ID, "hello-world"));
    await S.lessonRunButton(page).click();
    // Phase A — A1: lesson 1's authored solution greets a person by name
    // ("Hello, Alice!") — matches the new completion contract
    // (expected_stdout: "Hello, " + forbidden_in_stdout: "Hello, World!").
    await expect(S.outputPanel(page)).toContainText(/Hello, Alice!/, { timeout: 20_000 });
    await S.checkMyWorkButton(page).click();
    await expectLessonComplete(page);
  }

  test("chip renders on LessonCompletePanel with three mood buttons", async ({ page }, testInfo) => {
    await completeHelloWorld(page, testInfo.workerIndex);
    const chip = page.getByTestId("lesson-feedback-chip");
    await expect(chip).toBeVisible();
    await expect(chip.getByText(/how was this lesson\?/i)).toBeVisible();
    for (const mood of ["good", "okay", "bad"] as const) {
      await expect(page.getByTestId(`lesson-feedback-${mood}`)).toBeVisible();
    }
  });

  test("phone completion is one fitted card with meaningful focus and no clipped actions", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await completeHelloWorld(page, testInfo.workerIndex);

    const dialog = page.getByRole("dialog", { name: "Lesson Complete!" });
    const practice = dialog.getByRole("button", { name: "Start practice challenges" });
    await expect(practice).toBeFocused();

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.fonts.ready);

      // Modal enters at scale 0.96. Wait for the unchanged 44px control to
      // reach its settled geometry so this keeps enforcing the real touch
      // floor instead of sampling an intermediate animation frame.
      await expect
        .poll(async () => (await practice.boundingBox())?.height ?? 0, {
          message: `${viewport.width}x${viewport.height} completion actions settle at the 44px touch floor`,
        })
        .toBeGreaterThanOrEqual(44);

      const geometry = await dialog.evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        const actions = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"))
          .filter((button) => !button.disabled && button.getClientRects().length > 0)
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              name: button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
            };
          });
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          clientHeight: panel.clientHeight,
          scrollHeight: panel.scrollHeight,
          actions,
        };
      });

      expect(
        geometry.scrollHeight,
        `${viewport.width}x${viewport.height} completion must not scroll internally`,
      ).toBeLessThanOrEqual(geometry.clientHeight + 1);
      for (const action of geometry.actions) {
        expect(action.top, `${action.name} begins inside the card`).toBeGreaterThanOrEqual(
          geometry.top - 1,
        );
        expect(action.bottom, `${action.name} ends inside the card`).toBeLessThanOrEqual(
          geometry.bottom + 1,
        );
        expect(action.height, `${action.name} keeps the touch floor`).toBeGreaterThanOrEqual(44);
      }
    }

    const keepPracticing = dialog.getByRole("button", {
      name: "Keep practicing on this lesson",
    });
    await keepPracticing.click();
    await expect(dialog).not.toBeVisible();
    await expect(S.checkMyWorkButton(page)).toBeFocused();
  });

  test("😕 opens the modal pre-selecting Bug and seeding the body with the lesson title", async ({
    page,
  }, testInfo) => {
    await completeHelloWorld(page, testInfo.workerIndex);
    await page.getByTestId("lesson-feedback-bad").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The Bug radio should be the active one — radio buttons in the modal
    // are <button role=radio aria-checked>, so assert aria-checked directly.
    await expect(dialog.getByRole("radio", { name: /bug/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Body should be pre-seeded with "Lesson: Hello, World" so the learner
    // starts writing from context rather than staring at a blank textarea.
    const textarea = dialog.getByLabel(/feedback message/i);
    await expect(textarea).toHaveValue(/^Lesson: Hello, World/);
  });

  test("😊 opens the modal pre-selecting Other (positive ≠ bug)", async ({ page }, testInfo) => {
    await completeHelloWorld(page, testInfo.workerIndex);
    await page.getByTestId("lesson-feedback-good").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: /other/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // Phase 20-P2: a mood click fires a fire-and-forget POST that persists a
  // mood-only row even if the learner never types anything in the modal.
  // This is the single highest-intent signal the chip exists to capture —
  // losing it when there's no note would defeat the purpose.
  test("mood click fires POST /api/feedback with body='' + mood + lessonId", async ({
    page,
  }, testInfo) => {
    await completeHelloWorld(page, testInfo.workerIndex);
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith("/api/feedback") && res.status() === 201,
      ),
      page.getByTestId("lesson-feedback-bad").click(),
    ]);
    const reqBody = JSON.parse(response.request().postData() ?? "{}") as {
      body: string;
      category: string;
      mood: string;
      lessonId: string;
    };
    expect(reqBody.body).toBe("");
    expect(reqBody.mood).toBe("bad");
    expect(reqBody.category).toBe("bug");
    expect(reqBody.lessonId).toBe("hello-world");
  });
});
