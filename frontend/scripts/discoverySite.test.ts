import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderLessonOgPng } from "./discoveryOg";
import {
  generateDiscoverySite,
  loadDiscoveryCatalog,
  renderMarkdown,
  SITE_ORIGIN,
} from "./discoverySite";
import { isReservedDiscoveryPath } from "./vitePluginDiscovery";

const COURSES = path.resolve("public/courses");
let output = "";

beforeAll(async () => {
  output = mkdtempSync(path.join(os.tmpdir(), "codetutor-discovery-"));
  await generateDiscoverySite({ coursesDir: COURSES, outDir: output, renderImages: false });
});

afterAll(() => {
  if (output) rmSync(output, { recursive: true, force: true });
});

describe("B4 discovery build", () => {
  it("derives the complete public catalog and excludes internal fixtures", () => {
    const catalog = loadDiscoveryCatalog(COURSES);
    expect(catalog.publicCourses.map((course) => course.id)).toEqual([
      "python-fundamentals",
      "javascript-fundamentals",
      "python-intermediate",
    ]);
    expect(catalog.publicCourses.flatMap((course) => course.lessons)).toHaveLength(38);
    expect(catalog.internalCourseIds.sort()).toEqual([
      "internal-js-smoke",
      "internal-python-smoke",
    ]);
  });

  it("emits one unique raw document contract for every public lesson", () => {
    const catalog = loadDiscoveryCatalog(COURSES);
    const titles = new Set<string>();
    for (const course of catalog.publicCourses) {
      for (const lesson of course.lessons) {
        const file = path.join(output, "lessons", course.id, lesson.id, "index.html");
        expect(existsSync(file)).toBe(true);
        const html = readFileSync(file, "utf8");
        const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
        expect(title).toContain(lesson.title.replaceAll("&", "&amp;"));
        expect(titles.has(title!)).toBe(false);
        titles.add(title!);
        expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}${lesson.publicPath}">`);
        expect(html).toContain(`<meta property="og:image" content="${SITE_ORIGIN}${lesson.ogPath}">`);
        expect(html).toContain('"@type":"LearningResource"');
        expect(html).toContain(
          course.id === "python-fundamentals" && lesson.id === "hello-world"
            ? "Try lesson 1 — about 10 minutes"
            : "Start with lesson 1 — required first",
        );
        expect(html).toContain('<main id="main" tabindex="-1">');
        expect(html).toContain("event.preventDefault();history.replaceState(null,'','#main')");
        expect(html).toContain("main.focus({preventScroll:true})");
        expect(html).not.toContain(
          `<article class="prose" aria-label="Lesson walkthrough"><h2>${lesson.title}</h2>`,
        );
      }
    }
    expect(titles.size).toBe(38);
  });

  it("keeps internal content out of every production discovery surface", () => {
    const sitemap = readFileSync(path.join(output, "sitemap.xml"), "utf8");
    const category = readFileSync(path.join(output, "learn-to-code/index.html"), "utf8");
    const registry = JSON.parse(
      readFileSync(path.join(output, "courses/registry.json"), "utf8"),
    ) as { courses: Array<{ id: string }> };
    expect(sitemap).not.toContain("_internal");
    expect(category).not.toContain("_internal");
    expect(registry.courses).toHaveLength(3);
    expect(registry.courses.some((course) => course.id.startsWith("_"))).toBe(false);
    expect(readFileSync(path.join(output, "robots.txt"), "utf8")).toContain(
      "Disallow: /courses/",
    );
    expect(category).toContain("Try the first lesson — about 10 minutes");
    expect(category).not.toContain("four-minute");
    expect(category).toContain(">CodeTutor AI</a>");
  });

  it("escapes authored HTML while preserving code-oriented markdown", () => {
    const rendered = renderMarkdown(
      "# Heading\n\n<script>alert(1)</script>\n\n```python\nprint('<safe>')\n```",
    );
    expect(rendered).toContain("<h2>Heading</h2>");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("print(&#39;&lt;safe&gt;&#39;)");
  });

  it("preserves instructional numbering, nested bullets, quotes, and indented code", () => {
    const rendered = renderMarkdown(
      "1. First\n\n   ```python\n   print('one')\n   ```\n\n2. Second\n   - detail\n\n> *Keep thinking.*",
    );
    expect(rendered).toContain("<ol><li>First</li></ol>");
    expect(rendered).toContain('<ol start="2"><li>Second</li></ol>');
    expect(rendered).toContain("<ul><li>detail</li></ul>");
    expect(rendered).toContain("<code>print(&#39;one&#39;)</code>");
    expect(rendered).toContain('<blockquote class="note"><p><em>Keep thinking.</em></p></blockquote>');
  });

  it("renders a real 1200 by 630 PNG for lesson unfurls", async () => {
    const png = await renderLessonOgPng({
      courseTitle: "Python Fundamentals",
      lessonTitle: "Variables",
      lessonOrder: 2,
      totalLessons: 12,
      description: "Store values and use them in a program.",
      language: "python",
      concepts: ["variables", "assignment"],
    });
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it("reserves public-learning paths so unknown records cannot fall through to the SPA", () => {
    expect(isReservedDiscoveryPath("/lessons/internal-python-smoke/test/")).toBe(true);
    expect(isReservedDiscoveryPath("/learn-to-code/not-published/")).toBe(true);
    expect(isReservedDiscoveryPath("/lesson-og/not-published/test.png")).toBe(true);
    expect(isReservedDiscoveryPath("/try/lesson/python-fundamentals/hello-world")).toBe(false);
  });
});
