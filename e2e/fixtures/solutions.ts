// Golden-solution helpers. Loads `main.py` (or a language-specific entry)
// from `frontend/public/courses/<course>/lessons/<lesson>/solution/` so specs
// can type the canonical passing code into Monaco without duplicating it.
// If the authored rules change, the solution file changes with it — so the
// test stays correct automatically.

import * as fs from "node:fs";
import * as path from "node:path";

const COURSES_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "frontend",
  "public",
  "courses",
);

const DEFAULT_ENTRY: Record<string, string> = {
  python: "main.py",
  javascript: "main.js",
};

export function readLessonSolution(
  courseId: string,
  lessonId: string,
  options: { language?: "python" | "javascript"; file?: string } = {},
): string {
  const { language = "python", file } = options;
  const entry = file ?? DEFAULT_ENTRY[language] ?? "main.py";
  const p = path.join(
    COURSES_ROOT,
    courseId,
    "lessons",
    lessonId,
    "solution",
    entry,
  );
  if (!fs.existsSync(p)) {
    throw new Error(`No golden solution at ${p}`);
  }
  return fs.readFileSync(p, "utf8");
}

export function readPracticeSolution(
  courseId: string,
  lessonId: string,
  exerciseId: string,
  options: { language?: "python" | "javascript" } = {},
): string {
  const { language = "python" } = options;
  const ext = language === "python" ? "py" : "js";
  const p = path.join(
    COURSES_ROOT,
    courseId,
    "lessons",
    lessonId,
    "solution",
    "practice",
    `${exerciseId}.${ext}`,
  );
  if (!fs.existsSync(p)) {
    throw new Error(`No practice solution at ${p}`);
  }
  return fs.readFileSync(p, "utf8");
}
