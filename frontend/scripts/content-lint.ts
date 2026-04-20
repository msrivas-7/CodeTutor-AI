/**
 * Content lint CLI
 *
 * Walks frontend/public/courses/** and validates every course.json + lesson.json
 * against the Zod schemas, then runs structural checks (folder/id matching,
 * prerequisite validity, practice-id uniqueness, starter/content presence,
 * concept-tag presence, function_tests ordering gate, etc.).
 *
 * Run: npm run lint:content
 * Exit 0 if clean, non-zero on any error.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  courseSchema,
  lessonMetaSchema,
} from "../src/features/learning/content/schema";
import { buildConceptGraph } from "../src/features/learning/content/conceptGraph";
import { hasFunctionTestsHarness } from "../src/features/learning/content/harnessSupport";
import type { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──────────────────────────────────────────────────────────
type Severity = "error" | "warning";
interface LintIssue {
  severity: Severity;
  file: string;
  pointer?: string;
  message: string;
}

type Course = z.infer<typeof courseSchema>;
type Lesson = z.infer<typeof lessonMetaSchema>;

// ── Constants ──────────────────────────────────────────────────────
const ROOT = resolve(__dirname, "..");
const COURSES_DIR = resolve(ROOT, "public/courses");
// Minimum lesson.order at which a lesson may declare function_tests. The
// floor enforces the pedagogical rule that function declarations must have
// been taught first — which happens at different points in each language's
// curriculum. Python teaches `def` at order 6; JavaScript teaches `function`
// at order 5. Unknown languages fall back to the Python-era floor (6).
const FUNCTION_TESTS_ORDER_FLOOR_BY_LANGUAGE: Record<string, number> = {
  python: 6,
  javascript: 5,
};
const FUNCTION_TESTS_ORDER_FLOOR_DEFAULT = 6;

// ── Main ───────────────────────────────────────────────────────────
function main() {
  const issues: LintIssue[] = [];

  if (!existsSync(COURSES_DIR)) {
    console.error(`No courses directory at ${COURSES_DIR}`);
    process.exit(2);
  }

  const courseIds = readdirSync(COURSES_DIR).filter((name) => {
    const full = join(COURSES_DIR, name);
    try {
      return statSync(full).isDirectory();
    } catch {
      return false;
    }
  });

  if (courseIds.length === 0) {
    console.error(`No course folders found under ${COURSES_DIR}`);
    process.exit(2);
  }

  for (const courseId of courseIds) {
    lintCourse(courseId, issues);
  }

  report(issues);
  const errors = issues.filter((i) => i.severity === "error").length;
  process.exit(errors > 0 ? 1 : 0);
}

// ── Course-level linting ───────────────────────────────────────────
function lintCourse(courseFolder: string, issues: LintIssue[]) {
  const courseDir = join(COURSES_DIR, courseFolder);
  const coursePath = join(courseDir, "course.json");
  const relCourse = rel(coursePath);

  if (!existsSync(coursePath)) {
    issues.push({ severity: "error", file: relCourse, message: "missing course.json" });
    return;
  }

  let courseRaw: unknown;
  try {
    courseRaw = JSON.parse(readFileSync(coursePath, "utf8"));
  } catch (e) {
    issues.push({ severity: "error", file: relCourse, message: `invalid JSON: ${(e as Error).message}` });
    return;
  }

  const parsed = courseSchema.safeParse(courseRaw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        severity: "error",
        file: relCourse,
        pointer: issue.path.join("."),
        message: issue.message,
      });
    }
    return;
  }
  const course = parsed.data;

  // Course id must match folder name
  if (course.id !== courseFolder) {
    issues.push({
      severity: "error",
      file: relCourse,
      pointer: "id",
      message: `course id "${course.id}" does not match folder name "${courseFolder}"`,
    });
  }

  // Each lessonOrder id must exist as a lesson folder
  const lessonsDir = join(courseDir, "lessons");
  const existingLessonFolders = existsSync(lessonsDir)
    ? readdirSync(lessonsDir).filter((n) => statSync(join(lessonsDir, n)).isDirectory())
    : [];
  const folderSet = new Set(existingLessonFolders);

  for (const lessonId of course.lessonOrder) {
    if (!folderSet.has(lessonId)) {
      issues.push({
        severity: "error",
        file: relCourse,
        pointer: `lessonOrder[${course.lessonOrder.indexOf(lessonId)}]`,
        message: `lessonOrder references missing folder: lessons/${lessonId}/`,
      });
    }
  }

  // Orphan lesson folders (not referenced in course.json) — warning, not error
  for (const folder of existingLessonFolders) {
    if (!course.lessonOrder.includes(folder)) {
      issues.push({
        severity: "warning",
        file: `${rel(join(lessonsDir, folder))}/lesson.json`,
        message: `lesson folder not referenced in course.lessonOrder`,
      });
    }
  }

  // Load every lesson file
  const lessons: Array<{ lesson: Lesson; path: string; relPath: string }> = [];
  for (const lessonId of course.lessonOrder) {
    const lessonDir = join(lessonsDir, lessonId);
    if (!folderSet.has(lessonId)) continue;

    const lessonPath = join(lessonDir, "lesson.json");
    const relLesson = rel(lessonPath);

    if (!existsSync(lessonPath)) {
      issues.push({ severity: "error", file: relLesson, message: "missing lesson.json" });
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(lessonPath, "utf8"));
    } catch (e) {
      issues.push({ severity: "error", file: relLesson, message: `invalid JSON: ${(e as Error).message}` });
      continue;
    }

    const res = lessonMetaSchema.safeParse(raw);
    if (!res.success) {
      for (const issue of res.error.issues) {
        issues.push({
          severity: "error",
          file: relLesson,
          pointer: issue.path.join("."),
          message: issue.message,
        });
      }
      continue;
    }

    const lesson = res.data;
    lessons.push({ lesson, path: lessonPath, relPath: relLesson });
    lintLesson(lesson, lessonDir, relLesson, course.id, issues);
  }

  // Cross-lesson checks (orders, prerequisites, concept graph)
  lintOrderContiguity(lessons, relCourse, issues);
  lintPrerequisites(lessons, course.lessonOrder, issues);
  lintConceptGraph(course, lessons, issues);
}

function lintConceptGraph(
  course: Course,
  lessons: Array<{ lesson: Lesson; relPath: string }>,
  issues: LintIssue[],
) {
  const lessonMap = new Map<string, Lesson>();
  for (const { lesson } of lessons) lessonMap.set(lesson.id, lesson);

  const graph = buildConceptGraph(course, lessonMap);
  const relPathById = new Map<string, string>();
  for (const { lesson, relPath } of lessons) relPathById.set(lesson.id, relPath);

  for (const issue of graph.issues) {
    const relPath = relPathById.get(issue.lessonId) ?? `lessons/${issue.lessonId}/lesson.json`;
    // Missing + overlap are errors; duplicate-teach is a warning per the design
    // ("rewordings are legal").
    const severity: Severity = issue.kind === "duplicate-teach" ? "warning" : "error";
    const pointer =
      issue.kind === "overlap" || issue.kind === "missing"
        ? "usesConceptTags"
        : "teachesConceptTags";
    issues.push({
      severity,
      file: relPath,
      pointer,
      message: issue.message,
    });
  }
}

// ── Per-lesson linting ─────────────────────────────────────────────
function lintLesson(
  lesson: Lesson,
  lessonDir: string,
  relLesson: string,
  courseId: string,
  issues: LintIssue[],
) {
  // id must match folder name
  const folderName = lessonDir.split("/").pop();
  if (lesson.id !== folderName) {
    issues.push({
      severity: "error",
      file: relLesson,
      pointer: "id",
      message: `lesson id "${lesson.id}" does not match folder name "${folderName}"`,
    });
  }

  // courseId must match parent course
  if (lesson.courseId !== courseId) {
    issues.push({
      severity: "error",
      file: relLesson,
      pointer: "courseId",
      message: `courseId "${lesson.courseId}" does not match parent course "${courseId}"`,
    });
  }

  // teachesConceptTags: only lesson 1 may be empty; later lessons may also be
  // empty if they're project-shaped (mini-project, capstones) but we still want
  // an explicit signal, so only warn on true emptiness from order 2 up.
  if (lesson.order >= 2 && lesson.teachesConceptTags.length === 0) {
    issues.push({
      severity: "warning",
      file: relLesson,
      pointer: "teachesConceptTags",
      message:
        "teachesConceptTags is empty — most lessons should declare at least one newly-introduced concept",
    });
  }

  // content.md must exist and be non-empty
  const contentPath = join(lessonDir, "content.md");
  if (!existsSync(contentPath)) {
    issues.push({
      severity: "error",
      file: relLesson,
      message: "missing content.md in lesson folder",
    });
  } else {
    const stat = statSync(contentPath);
    if (stat.size === 0) {
      issues.push({
        severity: "error",
        file: rel(contentPath),
        message: "content.md is empty",
      });
    }
  }

  // starter/ must exist with at least one file, or a valid _index.json
  const starterDir = join(lessonDir, "starter");
  if (!existsSync(starterDir)) {
    issues.push({
      severity: "error",
      file: relLesson,
      message: "missing starter/ directory in lesson folder",
    });
  } else {
    const starterEntries = readdirSync(starterDir);
    const indexPath = join(starterDir, "_index.json");

    if (existsSync(indexPath)) {
      try {
        // _index.json is a flat JSON array of filenames, matching the loader
        // contract in src/features/learning/content/courseLoader.ts.
        const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          issues.push({
            severity: "error",
            file: rel(indexPath),
            message: "_index.json must be a non-empty JSON array of filenames",
          });
        } else {
          const files = parsed as unknown[];
          const seenNames = new Set<string>();
          for (const f of files) {
            if (typeof f !== "string") {
              issues.push({
                severity: "error",
                file: rel(indexPath),
                message: `_index.json entry must be a string filename, got ${typeof f}`,
              });
              continue;
            }
            if (seenNames.has(f)) {
              issues.push({
                severity: "error",
                file: rel(indexPath),
                message: `_index.json lists "${f}" more than once`,
              });
            }
            seenNames.add(f);
            if (!existsSync(join(starterDir, f))) {
              issues.push({
                severity: "error",
                file: rel(indexPath),
                message: `_index.json references missing starter file: ${f}`,
              });
            }
          }
          // Orphan files in starter/ that aren't in the index (warn only).
          for (const entry of starterEntries) {
            if (entry === "_index.json") continue;
            const p = join(starterDir, entry);
            if (!statSync(p).isFile()) continue;
            if (!seenNames.has(entry)) {
              issues.push({
                severity: "warning",
                file: rel(indexPath),
                message: `starter file "${entry}" is not listed in _index.json`,
              });
            }
          }
        }
      } catch (e) {
        issues.push({
          severity: "error",
          file: rel(indexPath),
          message: `invalid JSON: ${(e as Error).message}`,
        });
      }
    } else {
      const hasFile = starterEntries.some((name) => {
        const p = join(starterDir, name);
        return statSync(p).isFile();
      });
      if (!hasFile) {
        issues.push({
          severity: "error",
          file: relLesson,
          message: "starter/ has no files and no _index.json",
        });
      }
    }
  }

  // Completion rules: function_tests ordering gate, required_file_contains file presence
  lintCompletionRules(lesson.completionRules, lesson.order, lesson.language, lessonDir, relLesson, "completionRules", issues);

  // Practice exercises
  const practiceIds = new Set<string>();
  (lesson.practiceExercises ?? []).forEach((ex, i) => {
    if (practiceIds.has(ex.id)) {
      issues.push({
        severity: "error",
        file: relLesson,
        pointer: `practiceExercises[${i}].id`,
        message: `duplicate practice exercise id "${ex.id}"`,
      });
    }
    practiceIds.add(ex.id);

    lintCompletionRules(
      ex.completionRules,
      lesson.order,
      lesson.language,
      lessonDir,
      relLesson,
      `practiceExercises[${i}].completionRules`,
      issues,
    );
  });
}

function lintCompletionRules(
  rules: Lesson["completionRules"],
  lessonOrder: number,
  lessonLanguage: Lesson["language"],
  lessonDir: string,
  relLesson: string,
  pointerPrefix: string,
  issues: LintIssue[],
) {
  rules.forEach((rule, i) => {
    if (rule.type === "function_tests") {
      const floor =
        FUNCTION_TESTS_ORDER_FLOOR_BY_LANGUAGE[lessonLanguage] ??
        FUNCTION_TESTS_ORDER_FLOOR_DEFAULT;
      if (lessonOrder < floor) {
        issues.push({
          severity: "error",
          file: relLesson,
          pointer: `${pointerPrefix}[${i}]`,
          message: `function_tests not allowed on ${lessonLanguage} lesson with order ${lessonOrder} (floor is ${floor} — function keyword must be taught first)`,
        });
      }
      // Authoring gate: the language must have a registered function_tests
      // harness. Otherwise the route would 422 at runtime and the learner
      // would hit an author-shaped error. Fail loud at lint time instead.
      if (!hasFunctionTestsHarness(lessonLanguage)) {
        issues.push({
          severity: "error",
          file: relLesson,
          pointer: `${pointerPrefix}[${i}]`,
          message: `function_tests is not supported for language "${lessonLanguage}" — no harness backend is registered for this language`,
        });
      }
      // Validate expected values at authoring time using the same parser
      // the harness uses at runtime. Each harness has its own literal
      // contract: Python → ast.literal_eval, JavaScript → JSON.parse.
      if (lessonLanguage === "python") {
        const pyAvailable = isPythonAvailable();
        for (let j = 0; j < rule.tests.length; j++) {
          const t = rule.tests[j];
          if (pyAvailable) {
            const ok = pythonLiteralEvalOk(t.expected);
            if (!ok) {
              issues.push({
                severity: "error",
                file: relLesson,
                pointer: `${pointerPrefix}[${i}].tests[${j}].expected`,
                message: `expected value does not parse as a Python literal via ast.literal_eval: ${t.expected}`,
              });
            }
          }
        }
      } else if (lessonLanguage === "javascript") {
        for (let j = 0; j < rule.tests.length; j++) {
          const t = rule.tests[j];
          if (!jsonLiteralOk(t.expected)) {
            issues.push({
              severity: "error",
              file: relLesson,
              pointer: `${pointerPrefix}[${i}].tests[${j}].expected`,
              message: `expected value does not parse as a JSON literal via JSON.parse: ${t.expected}`,
            });
          }
        }
      }
    } else if (rule.type === "required_file_contains" && rule.file) {
      const starterDir = join(lessonDir, "starter");
      if (existsSync(starterDir) && !existsSync(join(starterDir, rule.file))) {
        // Only flag as warning — the file might be created by the learner at runtime
        issues.push({
          severity: "warning",
          file: relLesson,
          pointer: `${pointerPrefix}[${i}].file`,
          message: `required_file_contains references file "${rule.file}" which is not in starter/`,
        });
      }
    } else if (rule.type === "custom_validator") {
      issues.push({
        severity: "warning",
        file: relLesson,
        pointer: `${pointerPrefix}[${i}]`,
        message: "custom_validator rule is not implemented — lesson will not validate correctly",
      });
    }
  });
}

function lintOrderContiguity(
  lessons: Array<{ lesson: Lesson; relPath: string }>,
  relCourse: string,
  issues: LintIssue[],
) {
  const orders = lessons.map((l) => ({ order: l.lesson.order, relPath: l.relPath }));
  const seen = new Map<number, string>();
  for (const o of orders) {
    const prior = seen.get(o.order);
    if (prior) {
      issues.push({
        severity: "error",
        file: o.relPath,
        pointer: "order",
        message: `duplicate order ${o.order} (also used by ${prior})`,
      });
    }
    seen.set(o.order, o.relPath);
  }

  const sortedOrders = [...orders].map((o) => o.order).sort((a, b) => a - b);
  for (let i = 0; i < sortedOrders.length; i++) {
    if (sortedOrders[i] !== i + 1) {
      issues.push({
        severity: "warning",
        file: relCourse,
        message: `order values not contiguous from 1 (expected ${i + 1} at position ${i}, got ${sortedOrders[i]})`,
      });
      break;
    }
  }
}

function lintPrerequisites(
  lessons: Array<{ lesson: Lesson; relPath: string }>,
  lessonOrder: string[],
  issues: LintIssue[],
) {
  const idToPosition = new Map<string, number>();
  lessonOrder.forEach((id, i) => idToPosition.set(id, i));

  for (const { lesson, relPath } of lessons) {
    const myPos = idToPosition.get(lesson.id);
    for (let i = 0; i < lesson.prerequisiteLessonIds.length; i++) {
      const pre = lesson.prerequisiteLessonIds[i];
      if (!idToPosition.has(pre)) {
        issues.push({
          severity: "error",
          file: relPath,
          pointer: `prerequisiteLessonIds[${i}]`,
          message: `prerequisite "${pre}" is not a lesson in this course`,
        });
        continue;
      }
      const prePos = idToPosition.get(pre)!;
      if (myPos !== undefined && prePos >= myPos) {
        issues.push({
          severity: "error",
          file: relPath,
          pointer: `prerequisiteLessonIds[${i}]`,
          message: `prerequisite "${pre}" appears at or after this lesson in lessonOrder`,
        });
      }
    }
  }
}

// ── Python availability + literal_eval probe ───────────────────────
let pythonCheckDone = false;
let pythonOk = false;
function isPythonAvailable(): boolean {
  if (pythonCheckDone) return pythonOk;
  pythonCheckDone = true;
  try {
    const r = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" });
    pythonOk = r.status === 0;
  } catch {
    pythonOk = false;
  }
  return pythonOk;
}

function pythonLiteralEvalOk(expected: string): boolean {
  const r = spawnSync(
    "python3",
    ["-c", "import ast, sys; ast.literal_eval(sys.stdin.read())"],
    { input: expected, encoding: "utf8" },
  );
  return r.status === 0;
}

// ── JavaScript literal probe ───────────────────────────────────────
// Mirrors the JS harness's JSON.parse contract. In-process is fine: we're
// parsing author-provided strings, not learner code.
function jsonLiteralOk(expected: string): boolean {
  try {
    JSON.parse(expected);
    return true;
  } catch {
    return false;
  }
}

// ── Reporting ──────────────────────────────────────────────────────
function report(issues: LintIssue[]) {
  if (issues.length === 0) {
    console.log("content-lint: 0 issues — all good.");
    return;
  }

  // Stable sort: errors first, then by file
  const sorted = [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.pointer ?? "").localeCompare(b.pointer ?? "");
  });

  for (const i of sorted) {
    const tag = i.severity === "error" ? "ERROR" : "WARN ";
    const loc = i.pointer ? `${i.file} :: ${i.pointer}` : i.file;
    console.log(`[${tag}] ${loc}\n        ${i.message}`);
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  console.log(`\ncontent-lint: ${errors} error(s), ${warnings} warning(s).`);
}

function rel(p: string): string {
  return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p;
}

main();
