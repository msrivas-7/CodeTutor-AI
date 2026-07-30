import type { Course, LessonMeta, Lesson } from "../types";
import { LANGUAGE_ENTRYPOINT, type Language } from "../../../types";
import { courseSchema, lessonMetaSchema } from "./schema";

const COURSE_BASE = "/courses";

// QA-M2: distinguish "file is missing" (404) from "file is corrupt" (Zod
// refused it). The route shell renders different copy for each, and the
// dev console surfaces the schema issues so an author can see what broke.
export type LessonLoadError =
  | { kind: "not_found"; message: string }
  | { kind: "schema_error"; message: string; issues: string[] };

export class LessonLoaderError extends Error {
  readonly kind: LessonLoadError["kind"];
  readonly issues: string[];
  constructor(detail: LessonLoadError) {
    super(detail.message);
    this.kind = detail.kind;
    this.issues = detail.kind === "schema_error" ? detail.issues : [];
  }
}

// QA-M1: the registry is derived from `public/courses/registry.json`, which
// is written at dev-server start + at build start by the courseRegistryPlugin
// in scripts/vitePluginCourseRegistry.ts. Authors drop a new folder with a
// valid course.json and it shows up automatically — no TS edit required.
//
// Filename does NOT start with `_` because Vite's publicDir hides those, so
// an underscore-prefixed file is shadowed by the SPA history-fallback in dev
// and comes back as index.html.
//
// The registry fetch is cached per module load. `listAllCourses()` returns
// every entry; `listPublicCourses()` strips `internal: true`. Learner-facing
// pages (LearningDashboardPage) use the public list; dev-only surfaces
// (ContentHealthPage) use the full list.
let cachedRegistry: string[] | null = null;
async function loadCourseRegistry(): Promise<string[]> {
  if (cachedRegistry) return cachedRegistry;
  const res = await fetch(`${COURSE_BASE}/registry.json`);
  if (!res.ok) {
    // Registry missing means the vite plugin never ran (e.g. a prod build
    // shipped without it) — fall back to an empty list rather than crashing
    // the learning dashboard.
    cachedRegistry = [];
    return cachedRegistry;
  }
  // Dev-server history fallback returns `text/html` for any unknown path;
  // defend against that so we don't explode on json parse and collapse the
  // dashboard.
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    cachedRegistry = [];
    return cachedRegistry;
  }
  const raw = await res.json();
  const ids: string[] = Array.isArray(raw?.courses)
    ? raw.courses.map((c: { id?: string }) => c?.id).filter((id: unknown): id is string => typeof id === "string")
    : [];
  cachedRegistry = ids;
  return ids;
}

export async function listAllCourses(): Promise<Course[]> {
  const ids = await loadCourseRegistry();
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return await loadCourse(id);
      } catch {
        return null;
      }
    }),
  );
  const loaded = results.filter((c): c is Course => c !== null);
  // QA-M1: sort by course.displayOrder so the dashboard ordering is owned by
  // the content, not the filesystem. Missing values sort after set ones.
  // Ties (and all-missing) fall back to title for stable output.
  return loaded.sort((a, b) => {
    const ao = a.displayOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.displayOrder ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}

export async function listPublicCourses(): Promise<Course[]> {
  const all = await listAllCourses();
  return all.filter((c) => c.internal !== true);
}

/**
 * Phase 22F2A — B6: a course is "completed" when the learner has every
 * lesson in `course.lessonOrder` in their per-course `completedLessonIds`
 * set. Used by the dashboard to decide whether to surface the soft-warning
 * modal before letting the learner enter a course with unmet prerequisites.
 *
 * Side-stepped intentionally: percentage-based completion (e.g. 95%). For
 * the prereq gate we want a hard pedagogical signal, not a fuzzy estimate.
 */
export function isCourseCompleted(
  course: Pick<Course, "lessonOrder">,
  completedLessonIds: readonly string[],
): boolean {
  if (course.lessonOrder.length === 0) return false;
  const completed = new Set(completedLessonIds);
  return course.lessonOrder.every((id) => completed.has(id));
}

export async function loadCourse(courseId: string): Promise<Course> {
  const res = await fetch(`${COURSE_BASE}/${courseId}/course.json`);
  if (!res.ok) {
    throw new LessonLoaderError({
      kind: "not_found",
      message: `Course not found: ${courseId}`,
    });
  }
  const raw = await res.json();
  const parsed = courseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new LessonLoaderError({
      kind: "schema_error",
      message: `Invalid course JSON for ${courseId}`,
      issues,
    });
  }
  return parsed.data;
}

export async function loadLessonMeta(
  courseId: string,
  lessonId: string
): Promise<LessonMeta> {
  const res = await fetch(
    `${COURSE_BASE}/${courseId}/lessons/${lessonId}/lesson.json`
  );
  if (!res.ok) {
    throw new LessonLoaderError({
      kind: "not_found",
      message: `Lesson not found: ${courseId}/${lessonId}`,
    });
  }
  const raw = await res.json();
  const parsed = lessonMetaSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new LessonLoaderError({
      kind: "schema_error",
      message: `Invalid lesson JSON for ${courseId}/${lessonId}`,
      issues,
    });
  }
  return parsed.data;
}

export async function loadLessonContent(
  courseId: string,
  lessonId: string
): Promise<string> {
  const res = await fetch(
    `${COURSE_BASE}/${courseId}/lessons/${lessonId}/content.md`
  );
  if (!res.ok) return "";
  return res.text();
}

export async function loadStarterFiles(
  courseId: string,
  lessonId: string,
  language: Language,
  starterFilePaths?: string[],
): Promise<{ path: string; content: string }[]> {
  if (!starterFilePaths) {
    const entry = LANGUAGE_ENTRYPOINT[language];
    const fallback = await fetch(
      `${COURSE_BASE}/${courseId}/lessons/${lessonId}/starter/${entry}`
    );
    if (!fallback.ok) return [];
    const text = await fallback.text();
    if (text.trimStart().startsWith("<!")) return [];
    return [{ path: entry, content: text }];
  }

  const files = await Promise.all(
    starterFilePaths.map(async (name) => {
      const r = await fetch(
        `${COURSE_BASE}/${courseId}/lessons/${lessonId}/starter/${name}`
      );
      return { path: name, content: r.ok ? await r.text() : "" };
    })
  );
  return files;
}

export async function loadFullLesson(
  courseId: string,
  lessonId: string
): Promise<Lesson> {
  // Meta must load first — its `language` selects the single-file starter
  // fallback path (main.py vs main.js vs Main.java …). Content + starter then
  // parallelize; the serial hop adds one RTT on cold loads.
  const meta = await loadLessonMeta(courseId, lessonId);
  const [content, starterFiles] = await Promise.all([
    loadLessonContent(courseId, lessonId),
    loadStarterFiles(
      courseId,
      lessonId,
      meta.language,
      meta.starterFilePaths,
    ),
  ]);
  return { ...meta, content, starterFiles };
}

export async function loadAllLessonMetas(
  courseId: string
): Promise<LessonMeta[]> {
  const course = await loadCourse(courseId);
  const metas = await Promise.all(
    course.lessonOrder.map((id) => loadLessonMeta(courseId, id))
  );
  return metas;
}
