import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { renderLessonOgPng } from "./discoveryOg";

export const SITE_ORIGIN = "https://codetutor.msrivas.com";
export const CATEGORY_PATH = "/learn-to-code/";

interface CourseJson {
  id: string;
  title: string;
  description: string;
  language: string;
  lessonOrder: string[];
  displayOrder?: number;
  internal?: boolean;
}

interface LessonJson {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  language: string;
  estimatedMinutes: number;
  objectives: string[];
  teachesConceptTags: string[];
}

export interface DiscoveryLesson extends LessonJson {
  content: string;
  publicPath: string;
  ogPath: string;
}

export interface DiscoveryCourse extends CourseJson {
  internal: false;
  lessons: DiscoveryLesson[];
  publicPath: string;
}

export interface DiscoveryCatalog {
  publicCourses: DiscoveryCourse[];
  internalCourseIds: string[];
}

const SIMPLE_ID = /^[a-z0-9][a-z0-9_-]*$/;

function parseJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${(error as Error).message}`);
  }
}

function assertSimpleId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SIMPLE_ID.test(value)) {
    throw new Error(`${label} must be a simple lowercase identifier`);
  }
}

export function loadDiscoveryCatalog(coursesDir: string): DiscoveryCatalog {
  const publicCourses: DiscoveryCourse[] = [];
  const internalCourseIds: string[] = [];

  for (const folder of readdirSync(coursesDir).sort()) {
    const courseDir = path.join(coursesDir, folder);
    const courseFile = path.join(courseDir, "course.json");
    if (!statSync(courseDir).isDirectory() || !existsSync(courseFile)) continue;
    const course = parseJson<CourseJson>(courseFile);
    if (course.internal === true) {
      internalCourseIds.push(folder);
      continue;
    }
    assertSimpleId(course.id, `Course id in ${courseFile}`);
    if (course.id !== folder) throw new Error(`Course id does not match folder: ${folder}`);
    if (!Array.isArray(course.lessonOrder) || course.lessonOrder.length === 0) {
      throw new Error(`Public course ${course.id} has no ordered lessons`);
    }

    const lessons = course.lessonOrder.map((lessonId) => {
      assertSimpleId(lessonId, `Lesson id in ${course.id}`);
      const lessonDir = path.join(courseDir, "lessons", lessonId);
      const lessonFile = path.join(lessonDir, "lesson.json");
      const contentFile = path.join(lessonDir, "content.md");
      if (!existsSync(lessonFile) || !existsSync(contentFile)) {
        throw new Error(`Public lesson ${course.id}/${lessonId} is incomplete`);
      }
      const lesson = parseJson<LessonJson>(lessonFile);
      if (lesson.id !== lessonId || lesson.courseId !== course.id) {
        throw new Error(`Lesson identity mismatch at ${lessonFile}`);
      }
      return {
        ...lesson,
        content: readFileSync(contentFile, "utf8"),
        publicPath: `/lessons/${course.id}/${lesson.id}/`,
        ogPath: `/lesson-og/${course.id}/${lesson.id}.png`,
      } satisfies DiscoveryLesson;
    });

    publicCourses.push({
      ...course,
      internal: false,
      lessons,
      publicPath: `${CATEGORY_PATH}${course.id}/`,
    });
  }

  publicCourses.sort((a, b) => {
    const ao = a.displayOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.displayOrder ?? Number.POSITIVE_INFINITY;
    return ao === bo ? a.title.localeCompare(b.title) : ao - bo;
  });
  return { publicCourses, internalCourseIds };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function dedentCode(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const indent = indents.length ? Math.min(...indents) : 0;
  return indent > 0 ? lines.map((line) => line.slice(indent)) : lines;
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^ {0,3}```([^`]*)$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      out.push(`<pre data-language="${escapeHtml(fence[1].trim())}"><code>${escapeHtml(dedentCode(code).join("\n"))}</code></pre>`);
    } else if (/^###\s+/.test(line)) {
      out.push(`<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^#{1,2}\s+/.test(line)) {
      // The lesson title is the page h1, so every authored heading begins at h2.
      out.push(`<h2>${inlineMarkdown(line.replace(/^#{1,2}\s+/, ""))}</h2>`);
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      out.push(`<blockquote class="note"><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      index -= 1;
      out.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    } else if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      const start = Number(line.match(/^(\d+)\./)?.[1] ?? "1");
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      index -= 1;
      out.push(`<ol${start === 1 ? "" : ` start="${start}"`}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
    } else if (line.trim()) {
      const paragraph = [line.trim()];
      while (
        index + 1 < lines.length &&
        (lines[index + 1] ?? "").trim() &&
        !/^(#{1,3}\s+|\s*[-*]\s+|\d+\.\s+|>\s?| {0,3}```)/.test(lines[index + 1] ?? "")
      ) {
        index += 1;
        paragraph.push((lines[index] ?? "").trim());
      }
      out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }
    index += 1;
  }
  return out.join("\n");
}

const DISCOVERY_CSS = `
:root{color-scheme:dark;--bg:#080d1b;--panel:#0f172a;--ink:#ecf1f8;--muted:#94a3b8;--faint:#7a8ba3;--line:#293752;--accent:#38bdf8;--success:#34d399;--violet:#c084fc;--paper:#f2efe7}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 82% 0%,rgba(56,189,248,.11),transparent 28rem),radial-gradient(circle at 12% 20%,rgba(192,132,252,.07),transparent 24rem),var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.65;letter-spacing:-.005em}a{color:inherit}.skip{position:fixed;left:1rem;top:-4rem;z-index:20;background:var(--paper);color:#1c1917;padding:.65rem 1rem;border-radius:.5rem}.skip:focus{top:1rem}.shell{width:min(1120px,calc(100% - 2rem));margin:auto}.site-nav{display:flex;align-items:center;justify-content:space-between;min-height:76px;border-bottom:1px solid rgba(41,55,82,.7)}.wordmark{font-family:Fraunces,Georgia,serif;font-size:1.22rem;font-weight:650;text-decoration:none}.nav-links{display:flex;align-items:center;gap:.5rem}.quiet-link,.primary-link{display:inline-flex;align-items:center;min-height:44px;padding:.55rem .9rem;border-radius:999px;text-decoration:none;font-size:.83rem;font-weight:650}.quiet-link{color:var(--muted)}.primary-link{background:var(--accent);color:#07101d}.quiet-link:hover{color:var(--ink)}.primary-link:hover{background:#7dd3fc}.quiet-link:focus-visible,.primary-link:focus-visible,a:focus-visible{outline:3px solid rgba(56,189,248,.62);outline-offset:3px}.hero{padding:5.8rem 0 4.5rem;border-bottom:1px solid rgba(41,55,82,.7)}.eyebrow{font:600 .72rem/1.3 "JetBrains Mono",ui-monospace,monospace;text-transform:uppercase;letter-spacing:.14em;color:var(--accent)}h1,h2,h3{font-family:Fraunces,Georgia,serif;letter-spacing:-.025em;line-height:1.08}h1{font-size:clamp(2.65rem,7vw,5.7rem);max-width:13ch;margin:.7rem 0 1.25rem}h2{font-size:clamp(1.65rem,3vw,2.35rem);margin:2.8rem 0 1rem}h3{font-size:1.28rem;margin:2rem 0 .7rem}.lede{max-width:62ch;color:var(--muted);font-size:clamp(1.04rem,2vw,1.25rem)}.hero-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.55rem;margin-top:2rem}.meta-row,.chips{display:flex;flex-wrap:wrap;gap:.5rem}.meta-row{margin-top:1.7rem;color:var(--faint);font:500 .78rem/1.4 "JetBrains Mono",ui-monospace,monospace}.chip{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:.38rem .65rem;color:var(--muted);font:500 .72rem/1.3 "JetBrains Mono",ui-monospace,monospace}.content-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:clamp(2rem,6vw,5.5rem);padding:4rem 0}.prose{min-width:0}.prose>h2:first-child{margin-top:0}.prose p,.prose li{color:#d7deea}.prose ul,.prose ol{padding-left:1.3rem}.prose li+li{margin-top:.42rem}.prose code{border:1px solid rgba(56,189,248,.2);background:rgba(56,189,248,.07);color:#8fddfb;border-radius:.34rem;padding:.1rem .3rem;font:500 .86em/1.5 "JetBrains Mono",ui-monospace,monospace}.prose pre{overflow:auto;margin:1.3rem 0;border:1px solid var(--line);border-radius:1rem;background:#0b1223;padding:1.1rem 1.2rem;box-shadow:0 22px 60px -45px #000}.prose pre code{border:0;background:none;color:#e6ecf5;padding:0;font-size:.87rem;white-space:pre}.side{align-self:start;position:sticky;top:1.5rem}.note{border:1px solid var(--line);border-radius:1.1rem;background:rgba(15,23,42,.78);padding:1.25rem;box-shadow:inset 0 1px rgba(255,255,255,.025)}.note+.note{margin-top:.85rem}.note-label{font:600 .68rem/1.3 "JetBrains Mono",ui-monospace,monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--success)}.note h2{font-size:1.45rem;margin:.65rem 0}.note p{color:var(--muted);font-size:.9rem}.course-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;padding:3rem 0}.course-card,.lesson-card{border:1px solid var(--line);border-radius:1.1rem;background:rgba(15,23,42,.72);text-decoration:none}.course-card{display:flex;min-height:270px;flex-direction:column;padding:1.35rem}.course-card:hover,.lesson-card:hover{border-color:rgba(56,189,248,.55);transform:translateY(-2px)}.course-card h2{font-size:1.7rem;margin:1rem 0 .6rem}.course-card p,.lesson-card p{color:var(--muted);font-size:.88rem}.course-card .arrow{margin-top:auto;color:var(--accent);font-weight:650}.lesson-list{display:grid;gap:.75rem;padding:2.5rem 0 4rem}.lesson-card{display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:1rem;padding:1rem 1.15rem}.lesson-number{font:500 .78rem/1 "JetBrains Mono",ui-monospace,monospace;color:var(--faint)}.lesson-card h2{font:650 1.15rem/1.2 Fraunces,Georgia,serif;margin:0}.lesson-card p{margin:.35rem 0 0}.lesson-time{color:var(--faint);font:500 .72rem/1.3 "JetBrains Mono",ui-monospace,monospace}.pager{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-top:3.5rem}.pager a{border:1px solid var(--line);border-radius:.85rem;padding:1rem;text-decoration:none}.pager a:last-child{text-align:right}.pager small{display:block;color:var(--faint);font:.68rem/1.3 "JetBrains Mono",ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em}.footer{margin-top:4rem;border-top:1px solid rgba(41,55,82,.7);padding:2rem 0 3rem;color:var(--faint);font-size:.78rem}.footer-row{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.footer a{color:var(--muted)}@media(max-width:820px){.content-grid{grid-template-columns:1fr}.side{position:static}.course-grid{grid-template-columns:1fr}.hero{padding-top:4rem}.lesson-card{grid-template-columns:40px minmax(0,1fr)}.lesson-time{grid-column:2}}@media(max-width:520px){.shell{width:min(100% - 1.25rem,1120px)}.site-nav{min-height:66px}.nav-links .quiet-link{display:none}.hero{padding:3.4rem 0 3rem}h1{font-size:clamp(2.5rem,13vw,4rem)}.content-grid{padding-top:2.6rem}.pager{grid-template-columns:1fr}.pager a:last-child{text-align:left}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}.course-card:hover,.lesson-card:hover{transform:none}}
`;

function cleanDescription(value: string, max = 158): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function trialHref(medium: "lesson_page" | "category_page", campaign: string, content?: string) {
  const params = new URLSearchParams({
    utm_source: "organic",
    utm_medium: medium,
    utm_campaign: campaign,
  });
  if (content) params.set("utm_content", content);
  return `/try/lesson/python-fundamentals/hello-world?${params}`;
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function documentShell(options: {
  title: string;
  description: string;
  canonicalPath: string;
  ogPath: string;
  ogAlt: string;
  body: string;
  structuredData: unknown[];
}): string {
  const canonical = `${SITE_ORIGIN}${options.canonicalPath}`;
  const og = `${SITE_ORIGIN}${options.ogPath}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#080d1b">
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="CodeTutor AI">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${escapeHtml(options.title)}">
  <meta property="og:description" content="${escapeHtml(options.description)}">
  <meta property="og:image" content="${og}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(options.ogAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(options.title)}">
  <meta name="twitter:description" content="${escapeHtml(options.description)}">
  <meta name="twitter:image" content="${og}">
  <meta name="twitter:image:alt" content="${escapeHtml(options.ogAlt)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Fraunces:opsz,wght@9..144,500..700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/discovery.css">
  ${options.structuredData.map((item) => `<script type="application/ld+json">${jsonLd(item)}</script>`).join("\n  ")}
</head>
<body>
  <a class="skip" href="#main">Skip to lesson</a>
  ${options.body}
</body>
</html>\n`;
}

function header(trial: string): string {
  return `<header class="shell site-nav"><a class="wordmark" href="/" aria-label="CodeTutor AI home">CodeTutor</a><nav class="nav-links" aria-label="Public learning"><a class="quiet-link" href="${CATEGORY_PATH}">Explore lessons</a><a class="primary-link" href="${trial}">Try the first lesson →</a></nav></header>`;
}

function footer(): string {
  return `<footer class="footer"><div class="shell footer-row"><span>© ${new Date().getUTCFullYear()} Mehul Srivastava · CodeTutor AI</span><span><a href="/why-not-chatgpt">Why not ChatGPT?</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></span></div></footer>`;
}

export function renderLessonPage(course: DiscoveryCourse, lesson: DiscoveryLesson): string {
  const lessonIndex = course.lessons.findIndex((item) => item.id === lesson.id);
  const previous = course.lessons[lessonIndex - 1];
  const next = course.lessons[lessonIndex + 1];
  const title = `${lesson.title} — ${course.title} lesson | CodeTutor AI`;
  const description = cleanDescription(lesson.description);
  const trial = trialHref("lesson_page", course.id, lesson.id);
  const pager = [
    previous
      ? `<a href="${previous.publicPath}"><small>Previous lesson</small>${escapeHtml(previous.title)}</a>`
      : `<a href="${course.publicPath}"><small>Course index</small>${escapeHtml(course.title)}</a>`,
    next
      ? `<a href="${next.publicPath}"><small>Next lesson</small>${escapeHtml(next.title)}</a>`
      : `<a href="${course.publicPath}"><small>Course complete</small>Review the course</a>`,
  ].join("");
  const authoredBody = lesson.content.replace(
    new RegExp(`^#\\s+${lesson.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\r?\\n)+`),
    "",
  );
  const body = `${header(trial)}<main id="main"><section class="hero"><div class="shell"><div class="eyebrow"><a href="${course.publicPath}">${escapeHtml(course.title)}</a> / Lesson ${lesson.order}</div><h1>${escapeHtml(lesson.title)}</h1><p class="lede">${escapeHtml(lesson.description)}</p><div class="meta-row"><span>${escapeHtml(lesson.language)}</span><span>·</span><span>~${lesson.estimatedMinutes} minutes</span><span>·</span><span>Lesson ${lesson.order} of ${course.lessons.length}</span></div><div class="chips" style="margin-top:1rem">${lesson.objectives.slice(0, 4).map((objective) => `<span class="chip">${escapeHtml(objective)}</span>`).join("")}</div><div class="hero-actions"><a class="primary-link" href="${trial}">Write and run the code →</a><a class="quiet-link" href="${course.publicPath}">See the full course</a></div></div></section><div class="shell content-grid"><article class="prose" aria-label="Lesson walkthrough">${renderMarkdown(authoredBody)}<nav class="pager" aria-label="Adjacent lessons">${pager}</nav></article><aside class="side" aria-label="About this lesson"><section class="note"><div class="note-label">Actual course material</div><h2>Read the field note. Then make it run.</h2><p>This public walkthrough comes from the same structured lesson used inside CodeTutor. The interactive version adds the editor, tests, and a tutor that keeps the thinking with you.</p><a class="primary-link" href="${trial}">Try it without signup →</a></section><section class="note"><div class="note-label">Concepts in this lesson</div><div class="chips" style="margin-top:.8rem">${lesson.teachesConceptTags.map((tag) => `<span class="chip">${escapeHtml(tag.replaceAll("-", " "))}</span>`).join("")}</div></section></aside></div></main>${footer()}`;
  return documentShell({
    title,
    description,
    canonicalPath: lesson.publicPath,
    ogPath: lesson.ogPath,
    ogAlt: `${lesson.title}, lesson ${lesson.order} in ${course.title} on CodeTutor AI`,
    body,
    structuredData: [
      {
        "@context": "https://schema.org",
        "@type": "LearningResource",
        name: lesson.title,
        description: lesson.description,
        url: `${SITE_ORIGIN}${lesson.publicPath}`,
        inLanguage: "en",
        educationalLevel: course.id.includes("intermediate") ? "Intermediate" : "Beginner",
        teaches: lesson.objectives,
        timeRequired: `PT${lesson.estimatedMinutes}M`,
        isPartOf: {
          "@type": "Course",
          name: course.title,
          url: `${SITE_ORIGIN}${course.publicPath}`,
        },
        provider: { "@type": "Organization", name: "CodeTutor AI", url: SITE_ORIGIN },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Learn to code", item: `${SITE_ORIGIN}${CATEGORY_PATH}` },
          { "@type": "ListItem", position: 2, name: course.title, item: `${SITE_ORIGIN}${course.publicPath}` },
          { "@type": "ListItem", position: 3, name: lesson.title, item: `${SITE_ORIGIN}${lesson.publicPath}` },
        ],
      },
    ],
  });
}

export function renderCoursePage(course: DiscoveryCourse): string {
  const trial = trialHref("category_page", course.id);
  const title = `${course.title} course — learn by doing | CodeTutor AI`;
  const body = `${header(trial)}<main id="main"><section class="hero"><div class="shell"><div class="eyebrow"><a href="${CATEGORY_PATH}">Learn to code</a> / ${escapeHtml(course.language)}</div><h1>${escapeHtml(course.title)}</h1><p class="lede">${escapeHtml(course.description)}</p><div class="meta-row"><span>${course.lessons.length} lessons</span><span>·</span><span>${course.lessons.reduce((sum, lesson) => sum + lesson.estimatedMinutes, 0)} guided minutes</span><span>·</span><span>Real checks, not completion clicks</span></div><div class="hero-actions"><a class="primary-link" href="${trial}">Try the first lesson →</a><a class="quiet-link" href="${CATEGORY_PATH}">All courses</a></div></div></section><section class="shell lesson-list" aria-label="Course lessons">${course.lessons.map((lesson) => `<a class="lesson-card" href="${lesson.publicPath}"><span class="lesson-number">${String(lesson.order).padStart(2, "0")}</span><span><h2>${escapeHtml(lesson.title)}</h2><p>${escapeHtml(lesson.description)}</p></span><span class="lesson-time">~${lesson.estimatedMinutes} min →</span></a>`).join("")}</section></main>${footer()}`;
  return documentShell({
    title,
    description: cleanDescription(course.description),
    canonicalPath: course.publicPath,
    ogPath: course.lessons[0]!.ogPath,
    ogAlt: `${course.title} on CodeTutor AI`,
    body,
    structuredData: [{
      "@context": "https://schema.org",
      "@type": "Course",
      name: course.title,
      description: course.description,
      url: `${SITE_ORIGIN}${course.publicPath}`,
      provider: { "@type": "Organization", name: "CodeTutor AI", url: SITE_ORIGIN },
      hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: `PT${course.lessons.reduce((sum, lesson) => sum + lesson.estimatedMinutes, 0)}M` },
    }],
  });
}

export function renderCategoryPage(catalog: DiscoveryCatalog): string {
  const trial = trialHref("category_page", "learn-to-code");
  const title = "Learn coding with an AI tutor that makes you think | CodeTutor AI";
  const description = "Structured Python and JavaScript lessons with a real editor, runnable checks, and an AI tutor built to teach—not autocomplete.";
  const body = `${header(trial)}<main id="main"><section class="hero"><div class="shell"><div class="eyebrow">A different kind of AI coding course</div><h1>Built to teach,<br>not to autocomplete.</h1><p class="lede">Read a real lesson. Write the code yourself. Run it, inspect what happened, and prove it with checks. The tutor asks and hints without quietly taking the keyboard away from you.</p><div class="hero-actions"><a class="primary-link" href="${trial}">Try a four-minute lesson →</a><a class="quiet-link" href="#courses">Browse ${catalog.publicCourses.reduce((sum, course) => sum + course.lessons.length, 0)} public lessons</a></div></div></section><section class="shell" aria-labelledby="method-title" style="padding-top:4rem"><div class="eyebrow">The CodeTutor loop</div><h2 id="method-title">You do the part that changes you.</h2><div class="course-grid"><article class="course-card"><div class="eyebrow">01 / Read</div><h2>One idea, in context.</h2><p>Every public field note comes directly from the structured course material—not an SEO-only paraphrase.</p></article><article class="course-card"><div class="eyebrow">02 / Make</div><h2>Your code. Your evidence.</h2><p>The interactive lesson gives you an editor and runner. A completion is earned by the authored checks.</p></article><article class="course-card"><div class="eyebrow">03 / Ask</div><h2>Help that leaves work for you.</h2><p>The tutor points to evidence and asks the next useful question. It is designed to build judgment, not output.</p></article></div></section><section id="courses" class="shell" aria-labelledby="courses-title" style="padding-top:2rem"><div class="eyebrow">Public course library</div><h2 id="courses-title">Choose a trail.</h2><div class="course-grid">${catalog.publicCourses.map((course) => `<a class="course-card" href="${course.publicPath}"><div class="eyebrow">${escapeHtml(course.language)} · ${course.lessons.length} lessons</div><h2>${escapeHtml(course.title)}</h2><p>${escapeHtml(course.description)}</p><span class="arrow">Open the course →</span></a>`).join("")}</div></section></main>${footer()}`;
  return documentShell({
    title,
    description,
    canonicalPath: CATEGORY_PATH,
    ogPath: catalog.publicCourses[0]!.lessons[0]!.ogPath,
    ogAlt: "CodeTutor AI: built to teach, not to autocomplete",
    body,
    structuredData: [{
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "CodeTutor public lesson library",
      description,
      url: `${SITE_ORIGIN}${CATEGORY_PATH}`,
      mainEntity: { "@type": "ItemList", numberOfItems: catalog.publicCourses.length, itemListElement: catalog.publicCourses.map((course, index) => ({ "@type": "ListItem", position: index + 1, url: `${SITE_ORIGIN}${course.publicPath}`, name: course.title })) },
    }],
  });
}

export function renderSitemap(catalog: DiscoveryCatalog): string {
  const paths = [
    "/",
    CATEGORY_PATH,
    "/why-not-chatgpt",
    ...catalog.publicCourses.flatMap((course) => [
      course.publicPath,
      ...course.lessons.map((lesson) => lesson.publicPath),
    ]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((item) => `  <url><loc>${SITE_ORIGIN}${item}</loc></url>`).join("\n")}\n</urlset>\n`;
}

export function renderRobots(): string {
  return `User-agent: *\nAllow: /learn-to-code/\nAllow: /lessons/\nDisallow: /api/\nDisallow: /admin/\nDisallow: /courses/\nDisallow: /editor\nDisallow: /learn/\nDisallow: /login\nDisallow: /signup\nDisallow: /s/\nDisallow: /start\nDisallow: /welcome\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

function write(outDir: string, relative: string, value: string | Buffer) {
  const target = path.join(outDir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

export async function generateDiscoverySite(options: {
  coursesDir: string;
  outDir: string;
  renderImages?: boolean;
}): Promise<DiscoveryCatalog> {
  const catalog = loadDiscoveryCatalog(options.coursesDir);
  write(options.outDir, "discovery.css", DISCOVERY_CSS.trimStart());
  write(options.outDir, "learn-to-code/index.html", renderCategoryPage(catalog));
  write(options.outDir, "sitemap.xml", renderSitemap(catalog));
  write(options.outDir, "robots.txt", renderRobots());

  for (const course of catalog.publicCourses) {
    write(options.outDir, `learn-to-code/${course.id}/index.html`, renderCoursePage(course));
    for (const lesson of course.lessons) {
      write(options.outDir, `lessons/${course.id}/${lesson.id}/index.html`, renderLessonPage(course, lesson));
      if (options.renderImages !== false) {
        const png = await renderLessonOgPng({
          courseTitle: course.title,
          lessonTitle: lesson.title,
          lessonOrder: lesson.order,
          totalLessons: course.lessons.length,
          description: lesson.description,
          language: lesson.language,
          concepts: lesson.teachesConceptTags,
        });
        write(options.outDir, `lesson-og/${course.id}/${lesson.id}.png`, png);
      }
    }
  }

  // Vite copies public/ verbatim. Internal architecture fixtures remain
  // available in dev, but production should not publish their JSON/Markdown.
  for (const internalId of catalog.internalCourseIds) {
    const target = path.resolve(options.outDir, "courses", internalId);
    const expectedParent = `${path.resolve(options.outDir, "courses")}${path.sep}`;
    if (!target.startsWith(expectedParent)) throw new Error("Unsafe internal-course output path");
    rmSync(target, { recursive: true, force: true });
  }
  write(
    options.outDir,
    "courses/registry.json",
    `${JSON.stringify({ courses: catalog.publicCourses.map((course) => ({ id: course.id })) }, null, 2)}\n`,
  );
  return catalog;
}

export function discoveryCss(): string {
  return DISCOVERY_CSS.trimStart();
}
