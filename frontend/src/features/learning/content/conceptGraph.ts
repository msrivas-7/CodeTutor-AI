import type { Course, LessonMeta } from "../types";

export interface ConceptGraphLesson {
  lessonId: string;
  order: number;
  teaches: string[];
  uses: string[];
}

export interface ConceptGraphIssue {
  kind: "overlap" | "missing" | "duplicate-teach";
  lessonId: string;
  tag: string;
  message: string;
}

export interface ConceptGraph {
  lessons: ConceptGraphLesson[];
  baseVocabulary: string[];
  issues: ConceptGraphIssue[];
}

/**
 * Build a concept graph from a course's lessons and return validation issues.
 *
 * - `overlap`: a lesson declares the same tag in both teaches and uses.
 * - `missing`: a lesson's `uses` tag is not taught by any earlier lesson (by
 *   lessonOrder index) and is not in the course's `baseVocabulary` (or in
 *   `inheritedVocabulary` from any course in `inheritsBaseVocabularyFrom`).
 * - `duplicate-teach`: two lessons claim to teach the same tag (warning-tier
 *   semantically — surfaced so callers can decide whether to warn or fail).
 *
 * `inheritedVocabulary` is the resolved (transitive, cycle-checked) union of
 * concepts brought in via `course.inheritsBaseVocabularyFrom`. The caller
 * (content-lint) does the lookup; conceptGraph treats it as opaque pre-known
 * tags equivalent to `baseVocabulary` for the purpose of "uses" satisfaction.
 */
export function buildConceptGraph(
  course: Pick<Course, "lessonOrder" | "baseVocabulary">,
  lessons: ReadonlyMap<string, LessonMeta>,
  inheritedVocabulary: readonly string[] = [],
): ConceptGraph {
  const baseVocabulary = course.baseVocabulary ?? [];
  const ordered: ConceptGraphLesson[] = course.lessonOrder
    .map((lessonId) => {
      const meta = lessons.get(lessonId);
      if (!meta) return null;
      return {
        lessonId,
        order: meta.order,
        teaches: meta.teachesConceptTags ?? [],
        uses: meta.usesConceptTags ?? [],
      };
    })
    .filter((x): x is ConceptGraphLesson => x !== null);

  const issues: ConceptGraphIssue[] = [];
  const everTaughtBy = new Map<string, string>();
  const availableBefore = new Set<string>([...baseVocabulary, ...inheritedVocabulary]);

  for (const entry of ordered) {
    const teachesSet = new Set(entry.teaches);
    for (const tag of entry.uses) {
      if (teachesSet.has(tag)) {
        issues.push({
          kind: "overlap",
          lessonId: entry.lessonId,
          tag,
          message: `"${tag}" appears in both teachesConceptTags and usesConceptTags`,
        });
      }
      if (!availableBefore.has(tag)) {
        issues.push({
          kind: "missing",
          lessonId: entry.lessonId,
          tag,
          message: `"${tag}" is used but was not taught by any earlier lesson and is not in baseVocabulary`,
        });
      }
    }
    for (const tag of entry.teaches) {
      const firstTeacher = everTaughtBy.get(tag);
      if (firstTeacher && firstTeacher !== entry.lessonId) {
        issues.push({
          kind: "duplicate-teach",
          lessonId: entry.lessonId,
          tag,
          message: `"${tag}" was already taught by "${firstTeacher}"`,
        });
      } else {
        everTaughtBy.set(tag, entry.lessonId);
      }
      availableBefore.add(tag);
    }
  }

  return { lessons: ordered, baseVocabulary, issues };
}

/**
 * Concepts that have been taught strictly before `lessonId` in `course.lessonOrder`,
 * plus `baseVocabulary` + any inherited vocabulary. Useful for scoping the tutor's
 * explanations.
 */
export function conceptsAvailableBefore(
  course: Pick<Course, "lessonOrder" | "baseVocabulary">,
  lessons: ReadonlyMap<string, LessonMeta>,
  lessonId: string,
  inheritedVocabulary: readonly string[] = [],
): string[] {
  const available = new Set<string>([
    ...(course.baseVocabulary ?? []),
    ...inheritedVocabulary,
  ]);
  for (const id of course.lessonOrder) {
    if (id === lessonId) break;
    const meta = lessons.get(id);
    if (!meta) continue;
    for (const tag of meta.teachesConceptTags ?? []) available.add(tag);
  }
  return Array.from(available).sort();
}

/**
 * Resolve the transitive closure of `course.inheritsBaseVocabularyFrom`,
 * walking parents-of-parents. Returns the union of every reachable course's
 * `baseVocabulary` (de-duplicated, insertion order preserved).
 *
 * `unknownParent` and `cycle` errors short-circuit traversal — caller (content-
 * lint) is expected to surface them. Other parents continue to resolve so a
 * single bad reference doesn't black-hole the rest of the inheritance chain.
 */
export interface InheritanceError {
  kind: "unknown-parent" | "cycle";
  /** The course whose `inheritsBaseVocabularyFrom` triggered the error. */
  fromCourseId: string;
  /** The parent id that couldn't be resolved or that closed a cycle. */
  parentCourseId: string;
  message: string;
}

export interface ResolvedInheritance {
  vocabulary: string[];
  errors: InheritanceError[];
}

export function resolveInheritedVocabulary(
  startCourseId: string,
  coursesById: ReadonlyMap<
    string,
    Pick<Course, "id" | "baseVocabulary"> & {
      inheritsBaseVocabularyFrom?: string[];
    }
  >,
  // Phase 22F2: optional map of courseId → tags taught by that course's
  // lessons. When supplied, the inherited vocabulary expands to include
  // every parent course's lesson-taught tags (in addition to the parent's
  // own baseVocabulary). This is what `inheritsBaseVocabularyFrom` is
  // meant to do for cross-course curricula — e.g. python-intermediate
  // inheriting from python-fundamentals should treat fundamentals'
  // ~50 taught concepts as primitives. Without this arg, behavior is
  // unchanged (only parent baseVocabulary inherited) — call sites that
  // don't have a lesson map (e.g. unit tests) get the legacy semantic.
  taughtByCourseId?: ReadonlyMap<string, readonly string[]>,
): ResolvedInheritance {
  const vocabulary = new Set<string>();
  const errors: InheritanceError[] = [];
  const inFlight = new Set<string>();

  const visit = (courseId: string) => {
    if (inFlight.has(courseId)) {
      errors.push({
        kind: "cycle",
        fromCourseId: startCourseId,
        parentCourseId: courseId,
        message: `inheritsBaseVocabularyFrom cycle detected at "${courseId}"`,
      });
      return;
    }
    const c = coursesById.get(courseId);
    if (!c) {
      errors.push({
        kind: "unknown-parent",
        fromCourseId: startCourseId,
        parentCourseId: courseId,
        message: `inheritsBaseVocabularyFrom references unknown course "${courseId}"`,
      });
      return;
    }
    inFlight.add(courseId);
    for (const parentId of c.inheritsBaseVocabularyFrom ?? []) {
      visit(parentId);
    }
    for (const tag of c.baseVocabulary ?? []) {
      vocabulary.add(tag);
    }
    // Phase 22F2: also include this course's lesson-taught tags so a
    // child course's `usesConceptTags` can reference them as primitives.
    for (const tag of taughtByCourseId?.get(courseId) ?? []) {
      vocabulary.add(tag);
    }
    inFlight.delete(courseId);
  };

  const start = coursesById.get(startCourseId);
  if (start) {
    for (const parentId of start.inheritsBaseVocabularyFrom ?? []) {
      visit(parentId);
    }
  }

  return { vocabulary: Array.from(vocabulary), errors };
}
