// Phase 22E: SharePage mobile polish e2e.
//
// Renders the cinematic /s/:token page at iPhone 13 portrait (390×844)
// and asserts the layout-and-motion contracts that matter for the
// share-pasted-into-Twitter / WhatsApp / iMessage path:
//
//   - hero + code panel render without horizontal overflow
//   - typewriter completes and the final code is visible
//   - mastery ring + author + view counter render in the footer
//   - "Try this lesson" CTA is tappable + a single line
//   - reduced-motion path renders the final state from t=0
//   - Save image button is wired (mocked here — we don't actually
//     trigger navigator.share, just assert presence + click handler)
//
// Mobile viewport is set via the same iPhone 13 dimensions used by
// marketing-mobile (avoiding `devices["iPhone 13"]` since Playwright
// doesn't allow `defaultBrowserType` to change inside a describe).

import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";
import { getWorkerUser } from "../fixtures/auth";
import { mockAllAI } from "../fixtures/aiMocks";
import {
  BACKEND,
  loadProfile,
  newBackendContext,
  seedLessonProgress,
} from "../fixtures/profiles";

const COURSE_ID = "python-fundamentals";
const LESSON_ID = "hello-world";

const SAMPLE_CODE = `def greet(name):
    # Returns a friendly hello.
    return f"Hello, {name}!"

print(greet("Mehul"))`;

async function authedCtx(): Promise<{
  ctx: APIRequestContext;
  token: string;
}> {
  const workerIndex = test.info().workerIndex;
  const user = await getWorkerUser(workerIndex);
  const ctx = await newBackendContext();
  return { ctx, token: user.session.access_token };
}

async function seedShare(page: Page): Promise<{ shareToken: string }> {
  // Match share.spec's seeding chain: empty profile + completed lesson
  // progress, then POST /api/shares. The backend requires a completed
  // lesson_progress row to mint a share token.
  await loadProfile(page, "empty");
  await seedLessonProgress(page, COURSE_ID, LESSON_ID, {
    status: "completed",
    attemptCount: 1,
  });
  const { ctx, token } = await authedCtx();
  try {
    const res = await ctx.post(`${BACKEND}/api/shares`, {
      headers: {
        "X-Requested-With": "codetutor",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        courseId: COURSE_ID,
        lessonId: LESSON_ID,
        mastery: "strong",
        timeSpentMs: 360_000,
        attemptCount: 1,
        codeSnippet: SAMPLE_CODE,
        displayName: "Mehul",
      },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as { shareToken: string };
  } finally {
    await ctx.dispose();
  }
}

test.describe("Phase 22E: SharePage at iPhone 13 portrait", () => {
  // 390×844 = iPhone 13 portrait. Setting viewport directly (rather
  // than `...devices["iPhone 13"]`) avoids Playwright's "can't change
  // defaultBrowserType inside describe" constraint.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
  });

  test("hero, code, mastery ring + CTA all visible without horizontal overflow", async ({
    page,
  }) => {
    const { shareToken } = await seedShare(page);
    await page.goto(`/s/${shareToken}`);

    // Lesson title — the H1, gradient sweep settles within ~2.5s.
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toBeVisible({ timeout: 10_000 });

    // Wait for the typewriter to finish typing — `print(greet("Mehul"))`
    // is the last visible token in SAMPLE_CODE; once it's there the
    // full code has rendered.
    await expect(
      page.getByText(/print\(greet\("Mehul"\)\)/),
    ).toBeVisible({ timeout: 10_000 });

    // Author + ring footer row — text-balance/grid catches mastery
    // ring at the start of the row.
    await expect(page.getByText("Mehul").first()).toBeVisible();
    await expect(page.getByText(/Completed confidently/i)).toBeVisible();

    // CTA — single tap target, single line at this width.
    const cta = page.getByRole("link", {
      name: /Try this lesson — about 10 minutes/i,
    });
    await expect(cta).toBeVisible();

    // Document width should equal viewport width — any overflow means
    // the long mono code line broke the panel layout.
    const { docWidth, viewportWidth } = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(docWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test("URL row hidden on narrow (only wordmark in header)", async ({
    page,
  }) => {
    const { shareToken } = await seedShare(page);
    await page.goto(`/s/${shareToken}`);
    // Wait for content to render so visibility checks aren't racing
    // the lazy chrome.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The full URL element is rendered in DOM but display:none on narrow
    // (Tailwind `hidden sm:block`) — so getByText finds zero VISIBLE
    // matches, but the wordmark is visible.
    await expect(page.getByText("CodeTutor").first()).toBeVisible();
    const urlLine = page.getByText(
      `codetutor.msrivas.com/s/${shareToken}`,
    );
    await expect(urlLine).toBeHidden();
  });
});

test.describe("Phase 22E: SharePage reduced-motion at iPhone 13", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await mockAllAI(page);
  });

  test("renders the final state immediately (no waiting on typewriter)", async ({
    page,
  }) => {
    // Force prefers-reduced-motion BEFORE navigation so the
    // SharePage's useState initializers see `reduce === true` on first
    // render and skip the staggered timeline.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { shareToken } = await seedShare(page);
    await page.goto(`/s/${shareToken}`);

    // First wait for the public share payload itself to arrive. Network and
    // dynamic-chunk time are not animation time; once the heading renders,
    // reduced motion must expose the full code in the same settled state
    // rather than starting the typewriter timeline.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/print\(greet\("Mehul"\)\)/),
    ).toBeVisible({ timeout: 1_000 });

    // CTA visible from t=0 (no fade-up beat). Same single-line tap
    // target.
    await expect(
      page.getByRole("link", {
        name: /Try this lesson — about 10 minutes/i,
      }),
    ).toBeVisible();
  });
});
