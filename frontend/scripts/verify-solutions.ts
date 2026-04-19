/**
 * Verify solutions CLI
 *
 * For every lesson and every practice exercise, runs the committed golden
 * solution against its completionRules and asserts all rules pass.
 *
 * expected_stdout       — runs `python3 main.py` (with optional stdin) and
 *                         checks trimmed-substring match (same semantics as
 *                         validator.ts in production).
 * required_file_contains — word-boundary-aware pattern check mirroring the
 *                         production validator.
 * function_tests        — writes the same __codetutor_tests.py harness the
 *                         backend uses, runs python3, parses the sentinel-
 *                         wrapped JSON, and asserts every test passes.
 * custom_validator      — skipped with a warning (dead in production too).
 *
 * Requires python3 on PATH. Exits 0 clean, 1 on any failure.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { lessonMetaSchema } from "../src/features/learning/content/schema";
import {
  entryFileFor,
  fileExtForLanguage,
  hasFunctionTestsHarnessLanguage,
  type Language,
} from "./language";
import type { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const COURSES_DIR = resolve(ROOT, "public/courses");

// Mirror the production validator's harness constants
const TEST_SENTINEL = "__CODETUTOR_TESTS_v1_da39a3ee5e6b4b0d__";
const HARNESS_PY = "__codetutor_tests.py";
const HARNESS_JSON = "__codetutor_tests.json";

type Lesson = z.infer<typeof lessonMetaSchema>;
type Rule = Lesson["completionRules"][number];

interface RunFailure {
  where: string;
  message: string;
}

const failures: RunFailure[] = [];

function main() {
  // python3 is only strictly required if any course is Python — other
  // languages have their own runtime checks inside runRulesAgainstSolution.
  // The broad precheck stays for the common case: we want to fail early when
  // the Python courses (our primary content) can't be verified.
  if (!isPythonAvailable()) {
    console.error("verify-solutions: python3 is required on PATH.");
    process.exit(2);
  }

  if (!existsSync(COURSES_DIR)) {
    console.error(`No courses directory at ${COURSES_DIR}`);
    process.exit(2);
  }

  const courseFolders = readdirSync(COURSES_DIR).filter((name) =>
    statSync(join(COURSES_DIR, name)).isDirectory(),
  );

  for (const courseFolder of courseFolders) {
    verifyCourse(courseFolder);
  }

  if (failures.length === 0) {
    console.log("verify-solutions: all solutions pass all rules.");
    process.exit(0);
  }

  for (const f of failures) {
    console.log(`[FAIL] ${f.where}\n        ${f.message}`);
  }
  console.log(`\nverify-solutions: ${failures.length} failure(s).`);
  process.exit(1);
}

function verifyCourse(courseFolder: string) {
  const lessonsDir = join(COURSES_DIR, courseFolder, "lessons");
  if (!existsSync(lessonsDir)) return;

  const lessonFolders = readdirSync(lessonsDir).filter((name) =>
    statSync(join(lessonsDir, name)).isDirectory(),
  );

  for (const lessonFolder of lessonFolders) {
    verifyLesson(courseFolder, lessonFolder);
  }
}

function verifyLesson(courseFolder: string, lessonFolder: string) {
  const lessonDir = join(COURSES_DIR, courseFolder, "lessons", lessonFolder);
  const lessonPath = join(lessonDir, "lesson.json");
  if (!existsSync(lessonPath)) return;

  let lesson: Lesson;
  try {
    lesson = lessonMetaSchema.parse(JSON.parse(readFileSync(lessonPath, "utf8")));
  } catch (e) {
    failures.push({
      where: `${courseFolder}/${lessonFolder}/lesson.json`,
      message: `lesson.json did not parse — run content-lint first. (${(e as Error).message})`,
    });
    return;
  }

  const lang: Language = lesson.language;
  const entry = entryFileFor(lang);
  const ext = fileExtForLanguage(lang);

  const solutionDir = join(lessonDir, "solution");
  const mainSolution = join(solutionDir, entry);

  if (!existsSync(mainSolution)) {
    failures.push({
      where: `${courseFolder}/${lessonFolder}`,
      message: `missing solution/${entry} — every lesson must have a golden solution`,
    });
  } else {
    const inputPath = join(solutionDir, "input.txt");
    runRulesAgainstSolution({
      where: `${courseFolder}/${lessonFolder} (main)`,
      language: lang,
      solutionFile: mainSolution,
      stdinFile: existsSync(inputPath) ? inputPath : null,
      rules: lesson.completionRules,
    });
  }

  for (const exercise of lesson.practiceExercises ?? []) {
    const exSolution = join(solutionDir, "practice", `${exercise.id}.${ext}`);
    if (!existsSync(exSolution)) {
      failures.push({
        where: `${courseFolder}/${lessonFolder}/practice/${exercise.id}`,
        message: `missing solution/practice/${exercise.id}.${ext}`,
      });
      continue;
    }
    const exStdin = join(solutionDir, "practice", `${exercise.id}.stdin`);
    runRulesAgainstSolution({
      where: `${courseFolder}/${lessonFolder}/practice/${exercise.id}`,
      language: lang,
      solutionFile: exSolution,
      stdinFile: existsSync(exStdin) ? exStdin : null,
      rules: exercise.completionRules,
    });
  }
}

interface RunArgs {
  where: string;
  language: Language;
  solutionFile: string;
  stdinFile: string | null;
  rules: Rule[];
}

interface RunSpec {
  // How to execute the solution file in the temp dir (where it's been copied
  // under its language's entry filename). Returns null if the language is not
  // yet supported for `expected_stdout` verification.
  command: string;
  args: string[];
}

function runSpecFor(language: Language, entry: string): RunSpec | null {
  switch (language) {
    case "python":
      return { command: "python3", args: [entry] };
    case "javascript":
      return { command: "node", args: [entry] };
    default:
      return null;
  }
}

function runRulesAgainstSolution(args: RunArgs) {
  const { where, language, solutionFile, stdinFile, rules } = args;
  const entry = entryFileFor(language);

  // Copy solution into a private temp dir as the language's entry filename,
  // plus any stdin file.
  const tmp = mkdtempSync(join(tmpdir(), "verify-sol-"));
  try {
    const mainPath = join(tmp, entry);
    cpSync(solutionFile, mainPath);
    const stdinText = stdinFile ? readFileSync(stdinFile, "utf8") : "";
    const solutionSource = readFileSync(solutionFile, "utf8");

    // Lazily run the entry once if we have any expected_stdout rule. Cache the result.
    const spec = runSpecFor(language, entry);
    let scriptStdout: string | null = null;
    let scriptExitCode: number | null = null;
    const ensureScriptRun = () => {
      if (scriptStdout !== null) return;
      if (!spec) {
        failures.push({
          where,
          message: `cannot run expected_stdout rule — no run command registered for language "${language}"`,
        });
        scriptStdout = "";
        scriptExitCode = -1;
        return;
      }
      const r = spawnSync(spec.command, spec.args, {
        cwd: tmp,
        input: stdinText,
        encoding: "utf8",
        timeout: 10_000,
      });
      scriptStdout = r.stdout ?? "";
      scriptExitCode = r.status;
      if (r.status !== 0) {
        failures.push({
          where,
          message: `${spec.command} ${spec.args.join(" ")} exited with code ${r.status}. stderr: ${(r.stderr ?? "").trim().slice(0, 300)}`,
        });
      }
    };

    for (const rule of rules) {
      if (rule.type === "expected_stdout") {
        ensureScriptRun();
        if (scriptExitCode !== 0) continue; // already logged failure
        const expected = rule.expected.trim();
        const actual = (scriptStdout ?? "").trim();
        if (!actual.includes(expected)) {
          failures.push({
            where,
            message: `expected stdout to contain ${JSON.stringify(expected)} but got ${JSON.stringify(actual.slice(0, 200))}`,
          });
        }
      } else if (rule.type === "required_file_contains") {
        // file field almost always refers to the entry file — in our setup,
        // the solution file IS the entry file. If another filename is
        // specified, we only check against the solution source.
        if (!containsPattern(solutionSource, rule.pattern)) {
          failures.push({
            where,
            message: `solution source does not contain required pattern ${JSON.stringify(rule.pattern)}`,
          });
        }
      } else if (rule.type === "function_tests") {
        if (!hasFunctionTestsHarnessLanguage(language)) {
          console.log(`[skip] ${where}  no function_tests harness for language "${language}"`);
          continue;
        }
        const report = runHarness(tmp, rule.tests);
        if (report.harnessError) {
          failures.push({
            where,
            message: `harness error before tests ran: ${report.harnessError.slice(0, 300)}`,
          });
          continue;
        }
        const failed = report.results.filter((r) => !r.passed);
        if (failed.length > 0) {
          const first = failed[0];
          failures.push({
            where,
            message: `function_test "${first.name}" failed: expected ${first.expectedRepr ?? "?"} but got ${first.actualRepr ?? "(error: " + (first.error ?? "unknown").split("\n")[0] + ")"}`,
          });
        }
      } else if (rule.type === "custom_validator") {
        // Dead in production — skip.
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

interface HarnessResult {
  name: string;
  passed: boolean;
  expectedRepr: string | null;
  actualRepr: string | null;
  error: string | null;
}
interface HarnessReport {
  results: HarnessResult[];
  harnessError: string | null;
}

function runHarness(workspace: string, tests: unknown): HarnessReport {
  const pyPath = join(workspace, HARNESS_PY);
  const jsonPath = join(workspace, HARNESS_JSON);
  writeFileSync(pyPath, harnessPython(), "utf8");
  writeFileSync(jsonPath, JSON.stringify(tests), "utf8");

  const r = spawnSync("python3", [HARNESS_PY], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 20_000,
  });

  return parseHarnessOutput(r.stdout ?? "", r.stderr ?? "");
}

function parseHarnessOutput(stdout: string, stderr: string): HarnessReport {
  const start = stdout.indexOf(TEST_SENTINEL);
  const end = stdout.lastIndexOf(TEST_SENTINEL);
  if (start === -1 || start === end) {
    const msg = stderr.trim() || "harness did not emit sentinel block";
    return { results: [], harnessError: msg };
  }
  const body = stdout.slice(start + TEST_SENTINEL.length, end);
  try {
    const parsed = JSON.parse(body) as HarnessReport;
    return parsed;
  } catch (e) {
    return { results: [], harnessError: `could not parse harness JSON: ${(e as Error).message}` };
  }
}

function harnessPython(): string {
  // Identical to backend/src/services/execution/testHarness.ts::harnessPython()
  return `import json, sys, traceback, contextlib, io, runpy, ast

SENTINEL = "${TEST_SENTINEL}"

with open("${HARNESS_JSON}", "r", encoding="utf-8") as _f:
    TESTS = json.load(_f)

results = []
harness_error = None

try:
    mod_globals = runpy.run_path("main.py", run_name="__codetutor_main__")
except SystemExit:
    harness_error = "Your program called exit()."
except BaseException:
    harness_error = traceback.format_exc()

if harness_error is None:
    for t in TESTS:
        name = t["name"]
        call_src = t.get("call") or ""
        setup_src = t.get("setup") or ""
        expected_src = t["expected"]
        out_buf = io.StringIO()
        ns = dict(mod_globals)
        try:
            if setup_src:
                exec(setup_src, ns)
            with contextlib.redirect_stdout(out_buf):
                actual = eval(call_src, ns)
            expected = ast.literal_eval(expected_src)
            passed = actual == expected
            results.append({
                "name": name,
                "hidden": bool(t.get("hidden", False)),
                "category": t.get("category"),
                "passed": passed,
                "actualRepr": repr(actual),
                "expectedRepr": repr(expected),
                "stdoutDuring": out_buf.getvalue(),
                "error": None,
            })
        except BaseException:
            results.append({
                "name": name,
                "hidden": bool(t.get("hidden", False)),
                "category": t.get("category"),
                "passed": False,
                "actualRepr": None,
                "expectedRepr": None,
                "stdoutDuring": out_buf.getvalue(),
                "error": traceback.format_exc(limit=1),
            })

payload = json.dumps({"results": results, "harnessError": harness_error})
sys.stdout.write(SENTINEL + payload + SENTINEL + "\\n")
`;
}

// Mirror frontend/src/features/learning/utils/validator.ts::containsPattern
function containsPattern(content: string, pattern: string): boolean {
  if (!pattern) return true;
  if (!/^\w/.test(pattern)) return content.includes(pattern);
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`).test(content);
}

function isPythonAvailable(): boolean {
  try {
    const r = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
}

main();
