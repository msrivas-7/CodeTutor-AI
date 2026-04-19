import type { Course, LessonMeta, Lesson } from "../types";
import { LANGUAGE_ENTRYPOINT, type Language } from "../../../types";
import { courseSchema, lessonMetaSchema } from "./schema";

const COURSE_BASE = "/courses";

// Single source of truth for which courses exist. Adding a new course folder
// under public/courses/ requires adding its id here — there is no directory
// listing in the static file server, so the registry is explicit.
//
// Separate from the filter logic: `listAllCourses()` returns every entry,
// `listPublicCourses()` strips `internal: true` courses. Learner-facing pages
// (LearningDashboardPage) use the public list; dev-only surfaces
// (ContentHealthPage) use the full list.
const COURSE_REGISTRY: readonly string[] = [
  "python-fundamentals",
  "_internal-js-smoke",
];

export async function listAllCourses(): Promise<Course[]> {
  const results = await Promise.all(
    COURSE_REGISTRY.map(async (id) => {
      try {
        return await loadCourse(id);
      } catch {
        return null;
      }
    }),
  );
  return results.filter((c): c is Course => c !== null);
}

export async function listPublicCourses(): Promise<Course[]> {
  const all = await listAllCourses();
  return all.filter((c) => c.internal !== true);
}

export async function loadCourse(courseId: string): Promise<Course> {
  const res = await fetch(`${COURSE_BASE}/${courseId}/course.json`);
  if (!res.ok) throw new Error(`Course not found: ${courseId}`);
  const raw = await res.json();
  const parsed = courseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid course JSON for ${courseId}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
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
  if (!res.ok) throw new Error(`Lesson not found: ${courseId}/${lessonId}`);
  const raw = await res.json();
  const parsed = lessonMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid lesson JSON for ${courseId}/${lessonId}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
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
): Promise<{ path: string; content: string }[]> {
  const indexRes = await fetch(
    `${COURSE_BASE}/${courseId}/lessons/${lessonId}/starter/_index.json`
  );
  const isJson = indexRes.ok &&
    (indexRes.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) {
    const entry = LANGUAGE_ENTRYPOINT[language];
    const fallback = await fetch(
      `${COURSE_BASE}/${courseId}/lessons/${lessonId}/starter/${entry}`
    );
    if (!fallback.ok) return [];
    const text = await fallback.text();
    if (text.trimStart().startsWith("<!")) return [];
    return [{ path: entry, content: text }];
  }
  const filenames: string[] = await indexRes.json();
  const files = await Promise.all(
    filenames.map(async (name) => {
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
    loadStarterFiles(courseId, lessonId, meta.language),
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
