import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Phase 21C (post-audit, round 2): authoritative lesson title + course
// context lookup for share creation. Reads from disk now — the lesson
// catalog is baked into the backend image at build time (Dockerfile
// COPYs `frontend/public/courses` into `/app/courses`). Earlier this
// module HTTP-fetched the frontend SWA, which:
//   - Made share creation a cross-service hard dep (frontend down →
//     create 503s)
//   - Opened an SSRF-via-env vector if SHARE_CONTENT_ORIGIN were ever
//     mutable
//   - Couldn't be validated at boot (cache miss = silent runtime 503)
//
// Disk reads are O(1) with the file cache, no network, no env-driven
// URL build. Keeps a tiny in-memory cache to avoid re-reading on every
// share creation in the steady state.

interface CachedLesson {
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
}

const cache = new Map<string, CachedLesson>();

interface CourseJson {
  id: string;
  title: string;
  lessonOrder: string[];
}

interface LessonJson {
  id: string;
  title: string;
  order: number;
  // Phase A — A6: concept-tag write side. The lesson.json declares
  // which concepts the lesson teaches (new to the learner) vs uses
  // (assumed prior knowledge). Optional in the JSON shape because
  // older lessons predate the tagging convention.
  teachesConceptTags?: string[];
  usesConceptTags?: string[];
}

// Resolve the catalog root once. In the runtime container, this file
// compiles to /app/dist/services/share/lessonCatalog.js, so the
// catalog tree mounted at /app/courses is two directories up from
// dist/services/share. In dev (tsx) we follow the same relative
// shape from src/services/share.
function catalogRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // backend/dist/services/share/lessonCatalog.js or
  // backend/src/services/share/lessonCatalog.ts → ../../../courses
  return path.resolve(path.dirname(here), "../../../courses");
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

// Slug guard — refuse anything outside [a-z0-9_-] so a path-traversal
// payload never reaches `path.join`. The route already validates with
// the same regex via zod, but defending here is cheap and removes
// dependency on caller hygiene.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Fetch canonical lesson + course snapshot fields for the share row.
 * Returns null when the lesson or course doesn't exist (caller should
 * 400 the share request — the user can't have completed a non-existent
 * lesson, so this is either a stale URL or an attacker probing IDs).
 *
 * Throws on non-ENOENT filesystem errors (corrupt catalog, permission
 * denied, parse error) so the route can decide between 503 and 400.
 */
export async function getLessonSnapshot(
  courseId: string,
  lessonId: string,
): Promise<
  | {
      lessonTitle: string;
      lessonOrder: number;
      courseTitle: string;
      courseTotalLessons: number;
    }
  | null
> {
  if (!SLUG_RE.test(courseId) || !SLUG_RE.test(lessonId)) return null;

  const cacheKey = `${courseId}/${lessonId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const root = catalogRoot();
  const [course, lesson] = await Promise.all([
    readJson<CourseJson>(path.join(root, courseId, "course.json")),
    readJson<LessonJson>(
      path.join(root, courseId, "lessons", lessonId, "lesson.json"),
    ),
  ]);
  if (!course || !lesson) return null;
  if (lesson.id !== lessonId || course.id !== courseId) return null;

  const snapshot = {
    lessonTitle: lesson.title,
    lessonOrder: lesson.order,
    courseTitle: course.title,
    courseTotalLessons: course.lessonOrder.length,
  };
  cache.set(cacheKey, snapshot);
  return snapshot;
}

/**
 * Phase A — A6: concept-tag lookup for the learner-concept ledger.
 * Returns `taught` (new concepts the lesson teaches) and `used`
 * (concepts the lesson assumes prior knowledge of), parsed from the
 * lesson.json. Both arrays may be empty if the lesson hasn't declared
 * tags yet — caller treats that as a no-op write.
 *
 * Returns null when the lesson is unknown (path-traversal-safe slug
 * guard + catalog-miss fallthrough). Cached separately from the share
 * snapshot so the existing share path doesn't pay for this read.
 */
const tagsCache = new Map<string, { taught: string[]; used: string[] }>();

export async function getLessonConceptTags(
  courseId: string,
  lessonId: string,
): Promise<{ taught: string[]; used: string[] } | null> {
  if (!SLUG_RE.test(courseId) || !SLUG_RE.test(lessonId)) return null;
  const cacheKey = `${courseId}/${lessonId}`;
  const cached = tagsCache.get(cacheKey);
  if (cached) return cached;

  const root = catalogRoot();
  const lesson = await readJson<LessonJson>(
    path.join(root, courseId, "lessons", lessonId, "lesson.json"),
  );
  if (!lesson) return null;
  if (lesson.id !== lessonId) return null;

  // Defensive: filter to non-empty strings only. Lesson authors who
  // ship a stray empty string in the array would otherwise fail the
  // ledger's `concept_tag_size BETWEEN 1 AND 64` CHECK on insert.
  const taught = (lesson.teachesConceptTags ?? []).filter(
    (t) => typeof t === "string" && t.trim().length > 0,
  );
  const used = (lesson.usesConceptTags ?? []).filter(
    (t) => typeof t === "string" && t.trim().length > 0,
  );
  const tags = { taught, used };
  tagsCache.set(cacheKey, tags);
  return tags;
}

/** Test-only: clear the caches between vitest cases. */
export function _resetLessonCatalogCache(): void {
  cache.clear();
  tagsCache.clear();
}
