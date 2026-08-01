import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { languageSchema, type Language } from "../execution/commands.js";
import { completionRuleSchema } from "../../schema/lessonRuleSchema.js";

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
  baseVocabulary?: string[];
  internal?: boolean;
}

const practiceExerciseSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(4_000),
  goal: z.string().min(1).max(1_000),
  completionRules: z.array(completionRuleSchema).min(1),
});

const catalogLessonSchema = z.object({
  id: z.string().min(1).max(64),
  courseId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  order: z.number().int().positive(),
  language: languageSchema,
  objectives: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  teachesConceptTags: z.array(z.string().min(1).max(64)).default([]),
  usesConceptTags: z.array(z.string().min(1).max(64)).default([]),
  completionRules: z.array(completionRuleSchema).min(1),
  practiceExercises: z.array(practiceExerciseSchema).default([]),
});

type LessonJson = z.infer<typeof catalogLessonSchema>;

const memoryWarmupSchema = z
  .object({
    id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
    version: z.number().int().positive().max(1_000_000),
    conceptTags: z.array(z.string().min(1).max(64)).min(1).max(12),
    prompt: z.string().min(1).max(2_000),
    choices: z.array(z.string().min(1).max(500)).min(2).max(4),
    correctIndex: z.number().int().min(0),
    explanation: z.string().min(1).max(2_000),
  })
  .refine((item) => item.correctIndex < item.choices.length, {
    message: "correctIndex must reference an existing choice",
    path: ["correctIndex"],
  });

const memoryWarmupBankSchema = z.object({
  version: z.literal(1),
  lessons: z.record(z.string(), z.array(memoryWarmupSchema).min(1).max(8)),
});

export interface CanonicalMemoryWarmup {
  id: string;
  version: number;
  conceptTags: string[];
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

export interface LessonMemorySnapshot {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  priorConcepts: string[];
  warmups: CanonicalMemoryWarmup[];
}

export interface PracticeEvidenceSnapshot {
  courseId: string;
  lessonId: string;
  exerciseId: string;
  conceptTags: string[];
}

export interface TutorLessonSnapshot {
  courseId: string;
  lessonId: string;
  exerciseId: string | null;
  lessonTitle: string;
  language: Language;
  lessonObjectives: string[];
  teachesConceptTags: string[];
  usesConceptTags: string[];
  priorConcepts: string[];
  /** Safe task categories only; no hidden expected values or test bodies. */
  completionCriteria: string[];
  lessonOrder: number;
  totalLessons: number;
}

// Resolve the catalog root once. In the runtime container, this file
// compiles to /app/dist/services/share/lessonCatalog.js, so the
// catalog tree mounted at /app/courses is two directories up from
// dist/services/share. In dev (tsx) we follow the same relative
// shape from src/services/share.
function catalogRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // Production image: /app/dist/services/share -> /app/courses.
  const baked = path.resolve(path.dirname(here), "../../../courses");
  if (existsSync(baked)) return baked;
  // Workspace tests/dev: backend/src/services/share -> frontend/public/courses.
  return path.resolve(path.dirname(here), "../../../../frontend/public/courses");
}

// Retrieval answers are intentionally outside the frontend's public course
// tree. In the runtime image this resolves to /app/memory-warmups; in the
// workspace it falls back to the repository-owned private authoring tree.
// Keeping this root separate makes the server-only answer boundary true at
// rest as well as at the API projection layer.
function memoryWarmupRoot(): string {
  const here = fileURLToPath(import.meta.url);
  const baked = path.resolve(path.dirname(here), "../../../memory-warmups");
  if (existsSync(baked)) return baked;
  return path.resolve(
    path.dirname(here),
    "../../../../content/memory-warmups",
  );
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

async function readCatalogLesson(
  root: string,
  courseId: string,
  lessonId: string,
): Promise<LessonJson | null> {
  const raw = await readJson<unknown>(
    path.join(root, courseId, "lessons", lessonId, "lesson.json"),
  );
  if (raw === null) return null;
  const parsed = catalogLessonSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid lesson catalog entry ${courseId}/${lessonId}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.id !== lessonId || parsed.data.courseId !== courseId) {
    return null;
  }
  return parsed.data;
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

function safeCompletionCriteria(
  rules: z.infer<typeof completionRuleSchema>[],
): string[] {
  return rules.map((rule) => {
    switch (rule.type) {
      case "expected_stdout":
        return "produce the lesson's required output";
      case "forbidden_in_stdout":
        return "replace the authored placeholder output with the learner's own result";
      case "required_file_contains":
        return rule.file
          ? `use the required lesson construct in ${rule.file}`
          : "use the required lesson construct in the entry file";
      case "function_tests":
        return "define the required function at module scope and satisfy the authored behavior";
      case "retrieval_check":
        return "complete a short comprehension check after the code is correct; never reveal its answer";
      default:
        return "satisfy the lesson's authored validation";
    }
  });
}

const tutorCache = new Map<string, TutorLessonSnapshot>();
const memoryCache = new Map<string, LessonMemorySnapshot>();
const courseConceptCache = new Map<string, string[]>();
const practiceEvidenceCache = new Map<string, PracticeEvidenceSnapshot>();

/**
 * Phase B1 canonical retrieval authority. The correct answer never comes from
 * the browser; it is loaded from the same baked course tree as tutor context.
 */
export async function getLessonMemorySnapshot(
  courseId: string,
  lessonId: string,
): Promise<LessonMemorySnapshot | null> {
  if (!SLUG_RE.test(courseId) || !SLUG_RE.test(lessonId)) return null;
  const cacheKey = `${courseId}/${lessonId}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  const root = catalogRoot();
  const [course, lesson, rawBank] = await Promise.all([
    readJson<CourseJson>(path.join(root, courseId, "course.json")),
    readCatalogLesson(root, courseId, lessonId),
    readJson<unknown>(path.join(memoryWarmupRoot(), `${courseId}.json`)),
  ]);
  if (!course || course.id !== courseId || !course.lessonOrder.includes(lessonId)) {
    return null;
  }
  if (!lesson || rawBank === null) return null;
  const parsedBank = memoryWarmupBankSchema.safeParse(rawBank);
  if (!parsedBank.success) {
    throw new Error(
      `invalid memory warm-up bank ${courseId}: ${parsedBank.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const allowed = new Set(lesson.usesConceptTags);
  const warmups = (parsedBank.data.lessons[lessonId] ?? []).filter((warmup) =>
    warmup.conceptTags.every((tag) => allowed.has(tag)),
  );
  const snapshot: LessonMemorySnapshot = {
    courseId,
    lessonId,
    lessonTitle: lesson.title,
    priorConcepts: [...lesson.usesConceptTags],
    warmups,
  };
  memoryCache.set(cacheKey, snapshot);
  return snapshot;
}

/** Server-owned concept universe for a learner's course memory read model. */
export async function getCourseConceptTags(courseId: string): Promise<string[] | null> {
  if (!SLUG_RE.test(courseId)) return null;
  const cached = courseConceptCache.get(courseId);
  if (cached) return cached;
  const root = catalogRoot();
  const course = await readJson<CourseJson>(path.join(root, courseId, "course.json"));
  if (!course || course.id !== courseId || course.internal) return null;
  const lessons = await Promise.all(
    course.lessonOrder.map((lessonId) => readCatalogLesson(root, courseId, lessonId)),
  );
  if (lessons.some((lesson) => lesson === null)) return null;
  const tags = Array.from(
    new Set(
      lessons.flatMap((lesson) =>
        lesson ? [...lesson.teachesConceptTags, ...lesson.usesConceptTags] : [],
      ),
    ),
  ).sort();
  courseConceptCache.set(courseId, tags);
  return tags;
}

/**
 * Canonical practice identity for bounded supporting evidence. Practice is
 * deliberately not promoted to retained/remembered state by itself. The
 * current content model scopes practice to the lesson, so the associated
 * concepts are the lesson's taught concepts (or, for capstones, its used
 * concepts) rather than browser-supplied tags.
 */
export async function getPracticeEvidenceSnapshot(
  courseId: string,
  lessonId: string,
  exerciseId: string,
): Promise<PracticeEvidenceSnapshot | null> {
  if (!SLUG_RE.test(courseId) || !SLUG_RE.test(lessonId) || !SLUG_RE.test(exerciseId)) {
    return null;
  }
  const cacheKey = `${courseId}/${lessonId}/${exerciseId}`;
  const cached = practiceEvidenceCache.get(cacheKey);
  if (cached) return cached;
  const lesson = await readCatalogLesson(catalogRoot(), courseId, lessonId);
  if (!lesson || !lesson.practiceExercises.some((item) => item.id === exerciseId)) {
    return null;
  }
  const sourceTags = lesson.teachesConceptTags.length
    ? lesson.teachesConceptTags
    : lesson.usesConceptTags;
  const snapshot: PracticeEvidenceSnapshot = {
    courseId,
    lessonId,
    exerciseId,
    conceptTags: Array.from(new Set(sourceTags)).slice(0, 12),
  };
  practiceEvidenceCache.set(cacheKey, snapshot);
  return snapshot;
}

/**
 * Release 0D canonical prompt authority. Only identity comes from the client;
 * every instructional field is reloaded from the catalog baked into the
 * backend image. Hidden validator values are projected into safe categories.
 */
export async function getTutorLessonSnapshot(
  courseId: string,
  lessonId: string,
  exerciseId?: string | null,
): Promise<TutorLessonSnapshot | null> {
  if (!SLUG_RE.test(courseId) || !SLUG_RE.test(lessonId)) return null;
  if (exerciseId && !SLUG_RE.test(exerciseId)) return null;
  const cacheKey = `${courseId}/${lessonId}/${exerciseId ?? "lesson"}`;
  const cached = tutorCache.get(cacheKey);
  if (cached) return cached;

  const root = catalogRoot();
  const course = await readJson<CourseJson>(path.join(root, courseId, "course.json"));
  if (!course || course.id !== courseId || !course.lessonOrder.includes(lessonId)) {
    return null;
  }
  const lessonIndex = course.lessonOrder.indexOf(lessonId);
  const [lesson, ...priorLessons] = await Promise.all([
    readCatalogLesson(root, courseId, lessonId),
    ...course.lessonOrder
      .slice(0, lessonIndex)
      .map((priorId) => readCatalogLesson(root, courseId, priorId)),
  ]);
  if (!lesson) return null;
  const exercise = exerciseId
    ? lesson.practiceExercises.find((item) => item.id === exerciseId)
    : null;
  if (exerciseId && !exercise) return null;

  const priorConcepts = Array.from(
    new Set([
      ...(course.baseVocabulary ?? []),
      ...priorLessons.flatMap((prior) =>
        prior
          ? [...prior.teachesConceptTags, ...prior.usesConceptTags]
          : [],
      ),
    ]),
  );
  const rules = exercise?.completionRules ?? lesson.completionRules;
  const snapshot: TutorLessonSnapshot = {
    courseId,
    lessonId,
    exerciseId: exercise?.id ?? null,
    lessonTitle: exercise
      ? `${lesson.title} → Practice: ${exercise.title}`
      : lesson.title,
    language: lesson.language,
    lessonObjectives: exercise
      ? [exercise.prompt, `Goal: ${exercise.goal}`]
      : lesson.objectives,
    teachesConceptTags: lesson.teachesConceptTags,
    usesConceptTags: lesson.usesConceptTags,
    priorConcepts,
    completionCriteria: safeCompletionCriteria(rules),
    lessonOrder: lesson.order,
    totalLessons: course.lessonOrder.length,
  };
  tutorCache.set(cacheKey, snapshot);
  return snapshot;
}

/** Test-only: clear the caches between vitest cases. */
export function _resetLessonCatalogCache(): void {
  cache.clear();
  tagsCache.clear();
  tutorCache.clear();
  memoryCache.clear();
  courseConceptCache.clear();
  practiceEvidenceCache.clear();
}
