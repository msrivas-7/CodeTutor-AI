import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import {
  expect,
  seedDueConceptExposureForWorker,
  test,
} from "../fixtures/auth";
import { waitForMonacoReady } from "../fixtures/monaco";
import { loadProfile } from "../fixtures/profiles";
import { criticalTest } from "../fixtures/testMetadata";
import * as S from "../utils/selectors";

const COURSE_ID = "python-fundamentals";

function lessonPath(lessonId: string): string {
  return `/learn/course/${COURSE_ID}/lesson/${lessonId}`;
}

function warmupPayload(lessonId: string, suffix: string) {
  return {
    warmup: {
      episodeId: `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
      courseId: COURSE_ID,
      lessonId,
      warmupId: `e2e-${lessonId}`,
      warmupVersion: 1,
      conceptTags: ["variables"],
      prompt: "If `score` stores 7, which choice reads the stored value?",
      choices: ["score", '"score"', "score()"],
      attemptCount: 0,
    },
  };
}

async function expectLessonUsable(page: Page): Promise<void> {
  await waitForMonacoReady(page);
  await expect(S.lessonRunButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(S.checkMyWorkButton(page)).toBeVisible();
}

test.describe("Phase B1 memory warm-up", () => {
  test.use({ memoryWarmupsEnabled: true });

  test(
    "real server keeps the answer private and records feedback-supported recall",
    criticalTest({
      risk: "p0",
      owner: "learning",
      browsers: ["chromium"],
      devices: ["desktop"],
      quarantine: { state: "none" },
    }),
    async ({ page }) => {
      await loadProfile(page, "mid-course-healthy");
      await seedDueConceptExposureForWorker(test.info().workerIndex, COURSE_ID, [
        "if",
        "elif",
        "else",
        "comparison",
      ]);

      const aiRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/ai/ask")) {
          aiRequests.push(request.url());
        }
      });

      const promptResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === "GET" &&
          url.pathname === "/api/user/memory/warmup" &&
          url.searchParams.get("lessonId") === "functions"
        );
      });
      await page.goto(lessonPath("functions"));
      const promptBody = (await (await promptResponse).json()) as {
        warmup: Record<string, unknown>;
      };

      expect(promptBody.warmup).toBeTruthy();
      expect(promptBody.warmup).not.toHaveProperty("correctIndex");
      expect(promptBody.warmup).not.toHaveProperty("explanation");

      // Vite/nginx may use the SPA fallback for an unknown file, but the
      // private answer bank itself must never be downloadable or JSON-shaped.
      const publicBank = await page.request.get(
        "/courses/python-fundamentals/memory-warmups.json",
      );
      const publicBody = await publicBank.text();
      expect(publicBank.headers()["content-type"] ?? "").not.toContain(
        "application/json",
      );
      expect(publicBody).not.toContain('"correctIndex"');
      expect(publicBody).not.toContain("Only the first matching branch runs");

      const heading = page.getByRole("heading", { name: "Before you jump in" });
      await expect(heading).toBeVisible();
      await expect(heading).toBeFocused();
      await expect(page.getByText("Only the first matching branch runs")).toHaveCount(0);

      await page
        .getByRole("radio", { name: "It runs every branch" })
        .check();
      const wrongResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/answer"),
      );
      await page.getByRole("button", { name: "Check my recall" }).click();
      const wrongBody = (await (await wrongResponse).json()) as {
        isCorrect: boolean;
        attemptNumber: number;
        explanation: string;
      };
      expect(wrongBody).toMatchObject({ isCorrect: false, attemptNumber: 1 });
      const feedback = page.getByRole("status").filter({ hasText: /not quite/i });
      await expect(feedback).toBeVisible();
      await expect(feedback).toContainText(
        wrongBody.explanation.replaceAll("`", ""),
      );

      await page
        .getByRole("radio", {
          name: "It runs that branch and skips the rest",
        })
        .check();
      const correctResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith("/answer"),
      );
      await page.getByRole("button", { name: "Try this answer" }).click();
      const correctBody = (await (await correctResponse).json()) as {
        isCorrect: boolean;
        attemptNumber: number;
        firstAttemptCorrect: boolean;
      };
      expect(correctBody).toMatchObject({
        isCorrect: true,
        attemptNumber: 2,
        firstAttemptCorrect: false,
      });

      const successHeading = page.getByRole("heading", {
        name: "Memory refreshed.",
      });
      await expect(successHeading).toBeFocused();
      await expect(page.getByText(/rebuilt the idea with feedback/i)).toBeVisible();
      expect(aiRequests).toEqual([]);

      await page.getByRole("button", { name: "Continue to lesson" }).click();
      await expectLessonUsable(page);
      expect(aiRequests).toEqual([]);
    },
  );

  test("real first-attempt recall is distinguished from supported practice", async ({
    page,
  }) => {
    await loadProfile(page, "capstones-pending");
    await seedDueConceptExposureForWorker(test.info().workerIndex, COURSE_ID, [
      "def",
      "return",
    ]);
    await page.goto(lessonPath("lists"));

    await expect(
      page.getByRole("heading", { name: "Before you jump in" }),
    ).toBeFocused();
    await page
      .getByRole("radio", {
        name: /sends `?total`? back to the caller and ends the function/i,
      })
      .check();

    const answerResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/answer"),
    );
    await page.getByRole("button", { name: "Check my recall" }).click();
    const answer = (await (await answerResponse).json()) as {
      completed: boolean;
      attemptNumber: number;
      firstAttemptCorrect: boolean;
    };
    expect(answer).toMatchObject({
      completed: true,
      attemptNumber: 1,
      firstAttemptCorrect: true,
    });
    await expect(page.getByText(/recalled it independently/i)).toBeVisible();
  });

  test("load failure offers a real retry and fail-open continuation", async ({
    page,
  }) => {
    await loadProfile(page, "capstones-pending");
    let loadAttempts = 0;
    await page.route("**/api/user/memory/warmup?**", async (route: Route) => {
      loadAttempts += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporarily unavailable" }),
      });
    });

    await page.goto(lessonPath("dictionaries"));
    await expect(page.getByText("Memory check unavailable")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your lesson is ready." })).toBeFocused();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to lesson" })).toBeVisible();

    // React Strict Mode can let the initial effect reach the route once more
    // before its development-only cleanup settles. The product contract is
    // that the explicit retry adds exactly one request, not that the lifetime
    // request count has a particular absolute value.
    await page.waitForLoadState("networkidle");
    const attemptsBeforeRetry = loadAttempts;
    expect(attemptsBeforeRetry).toBeGreaterThanOrEqual(1);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => loadAttempts).toBe(attemptsBeforeRetry + 1);
    await expect(page.getByText("Memory check unavailable")).toBeVisible();

    await page.getByRole("button", { name: "Continue to lesson" }).click();
    await expectLessonUsable(page);
  });

  test("answer retry reuses the idempotency key and completes safely", async ({
    page,
  }) => {
    await loadProfile(page, "capstones-pending");
    const lessonId = "debugging-basics";
    const prompt = warmupPayload(lessonId, "41");
    await page.route("**/api/user/memory/warmup?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(prompt),
      });
    });

    const answerBodies: Array<{ requestId: string; choiceIndex: number }> = [];
    await page.route("**/api/user/memory/warmup/*/answer", async (route) => {
      const body = route.request().postDataJSON() as {
        requestId: string;
        choiceIndex: number;
      };
      answerBodies.push(body);
      if (answerBodies.length === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporarily unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          episodeId: prompt.warmup.episodeId,
          isCorrect: true,
          attemptNumber: 1,
          completed: true,
          firstAttemptCorrect: true,
          explanation: "The unquoted name reads the stored value.",
        }),
      });
    });

    await page.goto(lessonPath(lessonId));
    await page.getByRole("radio", { name: "score", exact: true }).check();
    await page.getByRole("button", { name: "Check my recall" }).click();
    await expect(page.getByRole("alert")).toContainText("Answer not checked");
    await expect(page.getByRole("button", { name: "Retry answer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue anyway" })).toBeVisible();

    await page.getByRole("button", { name: "Retry answer" }).click();
    await expect(page.getByRole("heading", { name: "Memory refreshed." })).toBeFocused();
    expect(answerBodies).toHaveLength(2);
    expect(answerBodies[0]?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(answerBodies[1]).toEqual(answerBodies[0]);
  });

  test(
    "390px keyboard and reduced-motion experience stays accessible and contained",
    criticalTest({
      risk: "p1",
      owner: "accessibility",
      browsers: ["chromium", "webkit"],
      devices: ["phone"],
      quarantine: { state: "none" },
    }),
    async ({ page }) => {
      await loadProfile(page, "capstones-pending");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const lessonId = "mini-project";
      await page.route("**/api/user/memory/warmup?**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(warmupPayload(lessonId, "42")),
        });
      });

      let aiCalls = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/ai/ask")) aiCalls += 1;
      });
      await page.goto(lessonPath(lessonId));

      const heading = page.getByRole("heading", { name: "Before you jump in" });
      await expect(heading).toBeFocused();
      const radios = page.getByRole("radio");
      await radios.first().focus();
      await page.keyboard.press("ArrowDown");
      await expect(radios.nth(1)).toBeChecked();

      for (const control of [
        page.getByRole("button", { name: "Check my recall" }),
        ...await page.locator('label:has(input[name="memory-warmup-choice"])').all(),
      ]) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }

      const layout = await page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        offenders: [...document.querySelectorAll<HTMLElement>("body *")]
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              name:
                element.getAttribute("aria-label") ??
                element.textContent?.trim().slice(0, 60) ??
                "",
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            };
          })
          .filter(
            ({ left, right }) =>
              left < -1 || right > window.innerWidth + 1,
          )
          .slice(0, 10),
      }));
      expect(
        layout.overflow,
        `horizontal overflow offenders: ${JSON.stringify(layout.offenders)}`,
      ).toBeLessThanOrEqual(1);
      const transitionMs = await page
        .locator('label:has(input[name="memory-warmup-choice"])')
        .first()
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000);
      expect(transitionMs).toBeLessThanOrEqual(0.02);

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(aiCalls).toBe(0);
    },
  );
});
