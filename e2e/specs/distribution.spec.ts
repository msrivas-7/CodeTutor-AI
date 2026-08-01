import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { criticalTest } from "../fixtures/testMetadata";

test.describe("B4 public distribution surface", () => {
  test("raw crawler documents are unique, indexable, and exclude internal courses", criticalTest({
    risk: "p1",
    owner: "growth",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ request }) => {
    const lesson = await request.get(
      "/lessons/python-fundamentals/variables/",
      { headers: { "user-agent": "CodeTutorCrawlerContract/1.0" } },
    );
    expect(lesson.status()).toBe(200);
    expect(lesson.headers()["content-type"]).toContain("text/html");
    const html = await lesson.text();
    expect(html).toContain("<title>Variables and Strings — Python Fundamentals lesson | CodeTutor AI</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://codetutor.msrivas.com/lessons/python-fundamentals/variables/">',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://codetutor.msrivas.com/lesson-og/python-fundamentals/variables.png">',
    );
    expect(html).toContain('"@type":"LearningResource"');
    expect(html).toContain("Start with lesson 1 — required first");

    const internal = await request.get(
      "/lessons/internal-python-smoke/multi-file-test/",
    );
    expect(internal.status()).toBe(404);

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain(
      "https://codetutor.msrivas.com/lessons/python-fundamentals/variables/",
    );
    expect(xml).not.toContain("_internal");
  });

  test("category claim and lesson walkthrough stay polished on a 390px viewport", criticalTest({
    risk: "p1",
    owner: "growth",
    browsers: ["chromium", "webkit"],
    devices: ["phone"],
    quarantine: { state: "none" },
  }), async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/learn-to-code/");
    await expect(
      page.getByRole("heading", { name: /built to teach, not to autocomplete/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /try the first lesson — about 10 minutes/i }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      ),
    ).toEqual([]);
    await testInfo.attach("b4-category-phone", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await page.getByRole("link", { name: /python fundamentals/i }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Python Fundamentals" })).toBeVisible();
    await page.getByRole("link", { name: /variables/i }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Variables" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /what you'll learn/i })).toBeVisible();
    await expect(page.locator("pre code").first()).toBeVisible();
    // The production webfont is wider than the fallback font. Wait for it so
    // the assertion catches code blocks that only overflow after font swap.
    await page.evaluate(() => document.fonts.ready);
    const lessonOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(lessonOverflow).toBeLessThanOrEqual(1);
    await testInfo.attach("b4-lesson-phone", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("category first touch survives into the anonymous funnel without URL residue", criticalTest({
    risk: "p1",
    owner: "growth",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
    });
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/telemetry/event", async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 204 });
    });

    await page.goto("/learn-to-code/");
    await page
      .getByRole("link", { name: /try the first lesson — about 10 minutes/i })
      .click();
    await expect(page).toHaveURL(
      /\/try\/lesson\/python-fundamentals\/hello-world$/,
    );
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    expect(bodies[0]).toMatchObject({
      event: "anon_page_view",
      attribution: {
        source: "organic",
        medium: "category_page",
        campaign: "learn-to-code",
      },
    });
    expect(new URL(page.url()).search).toBe("");
  });

  test("a direct first touch cannot be overwritten by a later tagged CTA", criticalTest({
    risk: "p1",
    owner: "growth",
    browsers: ["chromium"],
    devices: ["desktop"],
    quarantine: { state: "none" },
  }), async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("codetutor.anonCinematicSeen", "1");
      window.sessionStorage.setItem("codetutor.anonCoachSeen", "1");
      window.sessionStorage.setItem("codetutor.anonChoreographyDone", "1");
    });
    const bodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/telemetry/event", async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 204 });
    });

    await page.goto("/");
    await page.goto("/learn-to-code/");
    await page
      .getByRole("link", { name: /try the first lesson — about 10 minutes/i })
      .click();
    await expect(page).toHaveURL(
      /\/try\/lesson\/python-fundamentals\/hello-world$/,
    );
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    expect(bodies.at(-1)).toMatchObject({
      event: "anon_page_view",
      attribution: { source: "direct" },
    });
    expect(new URL(page.url()).search).toBe("");
  });
});
