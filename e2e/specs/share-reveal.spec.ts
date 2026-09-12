import { expect, test } from "@playwright/test";

const longCode = Array.from({ length: 9 }, (_, i) =>
  `# Step ${i + 1}: ${"Read, predict, run, and compare. ".repeat(4)}`,
).concat('print("Finished learning")').join("\n");

test("short, empty and truncated shares preserve their content boundaries", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let snippet = 'print("Hi!")';
  await page.route("**/api/shares/bbbbbbbbbbbb", route => route.fulfill({ json: {
    shareToken: "bbbbbbbbbbbb", courseId: "python-fundamentals", lessonId: "hello-world",
    lessonTitle: "Hello, World!", lessonOrder: 1, courseTitle: "Python Fundamentals",
    courseTotalLessons: 12, mastery: "strong", timeSpentMs: 60000, attemptCount: 1,
    codeSnippet: snippet, displayName: null, ogImageUrl: null, ogStoryImageUrl: null,
    viewCount: 1, createdAt: "2026-09-01T00:00:00Z",
  } }));
  const code = page.locator(".public-share-artifact .overflow-x-auto > div");
  for (const source of ['print("Hi!")', "", Array.from({ length: 12 }, (_, i) => `# line ${i + 1}`).join("\n")]) {
    snippet = source;
    await page.goto("/s/bbbbbbbbbbbb");
    await expect(code).toBeVisible();
    await expect(code.locator(".animate-pulse")).toHaveCount(0, { timeout: 4000 });
    if (!source) await expect(code).toHaveText("");
    else if (source.startsWith("print")) await expect(code).toHaveText(source);
    else {
      await expect(code).toContainText("# line 10");
      await expect(code).not.toContainText("# line 11");
      await expect(code.getByText("…", { exact: true })).toBeVisible();
      const height = await code.evaluate(element => element.clientHeight);
      await page.reload();
      await expect(code.locator(".animate-pulse")).toHaveCount(1);
      await expect(code.getByText("…", { exact: true })).toBeHidden();
      expect(await code.evaluate(element => element.clientHeight)).toBe(height);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(code.getByText("…", { exact: true })).toBeVisible();
      expect(await code.evaluate(element => element.clientHeight)).toBe(height);
    }
  }
});

for (const width of [390, 1440]) {
  test(`long shares reserve their footprint and finish typing within five seconds at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.route("**/api/shares/aaaaaaaaaaaa", route => route.fulfill({ json: {
      shareToken: "aaaaaaaaaaaa", courseId: "python-fundamentals", lessonId: "hello-world",
      lessonTitle: "Hello, World!", lessonOrder: 1, courseTitle: "Python Fundamentals",
      courseTotalLessons: 12, mastery: "strong", timeSpentMs: 60000, attemptCount: 1,
      codeSnippet: longCode, displayName: null, ogImageUrl: null, ogStoryImageUrl: null,
      viewCount: 1, createdAt: "2026-09-01T00:00:00Z",
    } }));
    await page.goto("/s/aaaaaaaaaaaa");
    const code = page.locator(".public-share-artifact .overflow-x-auto > div");
    await expect(code).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const cursor = code.locator(".animate-pulse");
    await expect(cursor).toHaveCount(1);
    // Layout coordinates ignore the existing celebratory scale transform.
    const footprint = () => code.evaluate(element => ({
      height: (element as HTMLElement).offsetHeight,
      panelHeight: (element.parentElement!.parentElement as HTMLElement).offsetHeight,
      footerTop: (element.closest(".public-share-artifact")!.querySelector(".border-t") as HTMLElement).offsetTop,
    }));
    const initial = await footprint();
    // Fine-grained observation: the default one-second late polling interval
    // can miss completion near this deliberately tight five-second deadline.
    await expect.poll(() => cursor.count(), { timeout: 5500, intervals: [50] }).toBe(0);
    await expect(code).toContainText('"Finished learning"');
    expect(await footprint()).toEqual(initial);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // Replay must start again with the same reserved footprint.
    await page.reload();
    await expect(cursor).toHaveCount(1);
    expect(await footprint()).toEqual(initial);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(cursor).toHaveCount(0);
    await expect(code).toContainText('"Finished learning"');
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(cursor).toHaveCount(0);
    expect(await footprint()).toEqual(initial);
    const cta = page.getByRole("link", { name: /Try this lesson/ });
    await cta.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/try\/lesson\/python-fundamentals\/hello-world/);
    await expect(page.locator("html")).not.toHaveAttribute("data-public-theme");
  });
}
