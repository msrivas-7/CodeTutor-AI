import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { harnessJavaScript, HARNESS_JS, HARNESS_JSON as JS_JSON } from "./javascriptHarness.js";
import { harnessPython, HARNESS_PY, HARNESS_JSON as PY_JSON } from "./pythonHarness.js";
import { parseSignedEnvelope } from "./envelope.js";
import type { FunctionTest, HarnessSuite, SourceCheck, TestReport } from "./types.js";

type CompletionRule =
  | { type: "function_tests"; tests: FunctionTest[] }
  | { type: "source_checks"; checks: SourceCheck[] }
  | { type: string };

const courseRoot = path.resolve(process.cwd(), "../frontend/public/courses");

function rules(course: string, lesson: string, practiceId?: string): CompletionRule[] {
  const json = JSON.parse(
    fs.readFileSync(path.join(courseRoot, course, "lessons", lesson, "lesson.json"), "utf8"),
  ) as { completionRules: CompletionRule[]; practiceExercises?: Array<{ id: string; completionRules: CompletionRule[] }> };
  if (!practiceId) return json.completionRules;
  const practice = json.practiceExercises?.find((entry) => entry.id === practiceId);
  if (!practice) throw new Error(`Missing practice ${course}/${lesson}/${practiceId}`);
  return practice.completionRules;
}

function suiteFrom(rulesToRun: CompletionRule[], testNames?: string[]): HarnessSuite {
  const tests = rulesToRun
    .filter((rule): rule is Extract<CompletionRule, { type: "function_tests" }> => rule.type === "function_tests")
    .flatMap((rule) => rule.tests)
    .filter((test) => !testNames || testNames.includes(test.name));
  const sourceChecks = rulesToRun
    .filter((rule): rule is Extract<CompletionRule, { type: "source_checks" }> => rule.type === "source_checks")
    .flatMap((rule) => rule.checks);
  return { tests, sourceChecks };
}

function run(language: "python" | "javascript", source: string, suite: HarnessSuite): TestReport {
  const nonce = crypto.randomBytes(32).toString("hex");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mastery-contract-"));
  const isPython = language === "python";
  const entry = isPython ? "main.py" : "main.js";
  const harnessFile = isPython ? HARNESS_PY : HARNESS_JS;
  const suiteFile = isPython ? PY_JSON : JS_JSON;
  fs.writeFileSync(path.join(tmp, entry), source, "utf8");
  fs.writeFileSync(path.join(tmp, harnessFile), isPython ? harnessPython() : harnessJavaScript(), "utf8");
  fs.writeFileSync(path.join(tmp, suiteFile), JSON.stringify(suite), "utf8");
  const result = spawnSync(isPython ? "python3" : "node", [harnessFile], {
    cwd: tmp,
    encoding: "utf8",
    timeout: 20_000,
    input: `${nonce}\n`,
    env: { ...process.env, HARNESS_PER_TEST_TIMEOUT_MS: "5000" },
  });
  const report = parseSignedEnvelope(result.stdout ?? "", result.stderr ?? "", nonce);
  fs.rmSync(tmp, { recursive: true, force: true });
  return report;
}

function failedNames(report: TestReport): string[] {
  expect(report.harnessError).toBeNull();
  return report.results.filter((result) => !result.passed).map((result) => result.name);
}

describe("Q4 mastery contracts reject formerly accepted shortcuts", { timeout: 30_000 }, () => {
  it("rejects Math.max in the running-maximum practice", () => {
    const report = run(
      "javascript",
      "function maxInArray(nums) { return Math.max(...nums); }",
      suiteFrom(rules("javascript-fundamentals", "arrays-basics", "max-in-array")),
    );
    expect(failedNames(report)).toContain("middle biggest");
  });

  it("rejects loop-only comprehension submissions", () => {
    const source = [
      "students = [('Alice', 87), ('Bob', 54), ('Cara', 91)]",
      "passing_students = []",
      "grades_by_student = {}",
      "unique_grade_tens = set()",
      "for name, grade in students:",
      "    if grade >= 60: passing_students.append(name)",
      "    grades_by_student[name] = grade",
      "    unique_grade_tens.add(grade // 10)",
      "print(f'passing students: {passing_students}')",
      "print(f'grades by student: {grades_by_student}')",
      "print(f'unique grade tens: {sorted(unique_grade_tens)}')",
    ].join("\n");
    const report = run("python", source, suiteFrom(rules("python-intermediate", "comprehensions")));
    expect(failedNames(report)).toEqual(expect.arrayContaining(["List comprehension", "Dict comprehension", "Set comprehension"]));
  });

  it("rejects bare except and a dead negative-age raise", () => {
    const bare = run(
      "python",
      "def parse_values(values):\n    out=[]\n    for value in values:\n        try: out.append(int(value))\n        except: pass\n    return out\n",
      suiteFrom(rules("python-intermediate", "error-handling")),
    );
    const deadRaise = run(
      "python",
      "def validate_age(age):\n    if False:\n        raise ValueError('age must be non-negative')\n    return age\n",
      suiteFrom(rules("python-intermediate", "error-handling", "validate-age")),
    );
    expect(failedNames(bare)).toContain("Catch ValueError specifically");
    expect(failedNames(deadRaise)).toEqual(expect.arrayContaining([
      "negative age raises the required error",
      "Reachable ValueError raise",
    ]));
  });

  it("rejects for-loop and ordinary-loop substitutes for required constructs", () => {
    const forGenerator = run(
      "python",
      "def squares_under(limit):\n    for n in range(1, limit):\n        if n*n >= limit: break\n        yield n*n\n",
      suiteFrom(rules("python-intermediate", "iterators-and-generators", "squares-under")),
    );
    const ordinarySum = run(
      "python",
      "def sum_column(lines, index):\n    total = 0\n    for line in lines:\n        total += int(line.split(',')[index])\n    return total\n",
      suiteFrom(rules("python-intermediate", "capstone-csv-analyzer", "sum-column")),
    );
    expect(failedNames(forGenerator)).toContain("Use a while loop");
    expect(failedNames(ordinarySum)).toContain("Generator expression in sum_column");
  });

  it("rejects in-place Todo and Query transformations", () => {
    const mutatingTodo = run(
      "javascript",
      "function toggleTodo(todos, id) { const todo = todos.find(t => t.id === id); if (todo) todo.done = !todo.done; return todos; }",
      suiteFrom(rules("javascript-fundamentals", "js-capstone-todo-list"), [
        "toggleTodo: returns a new array and preserves the original graph",
      ]),
    );
    const mutatingQuery = run(
      "python",
      [
        "class Query:",
        "    def __init__(self, rows): self.rows = rows",
        "    def __iter__(self): return iter(self.rows)",
        "    def where(self, predicate): self.rows = [r for r in self.rows if predicate(r)]; return self",
        "    def sort_by(self, key): self.rows.sort(key=key); return self",
      ].join("\n"),
      suiteFrom(rules("python-intermediate", "capstone-mini-orm"), [
        "where returns a distinct Query without mutating the original",
        "sort_by returns a distinct Query without reordering the original",
      ]),
    );
    expect(failedNames(mutatingTodo)).toContain("toggleTodo: returns a new array and preserves the original graph");
    expect(failedNames(mutatingQuery)).toHaveLength(2);
  });

  it("rejects hard-coded regex and CSV capstones even when required words sit in dead code", () => {
    const regexCheat = run(
      "python",
      [
        "import re",
        "def analyze_text(text):",
        "    if False:",
        "        re.findall(r'\\d+', text); re.search(r'Error', text); re.sub(r'\\d+', '###', text)",
        "    return ['404', '500', '200'], '404', 'Error ###'",
      ].join("\n"),
      suiteFrom(rules("python-intermediate", "regex-basics")),
    );
    const csvCheat = run(
      "python",
      [
        "def analyze_sales(sales, path='sales.csv'):",
        "    if False:",
        "        with open(path, 'w') as f: f.write('')",
        "        with open(path) as f: f.read()",
        "        products = {row[1] for row in sales}",
        "        total = sum(row[2] for row in sales)",
        "        top = max({}, key=lambda x: x)",
        "    return 500, ['gadget', 'widget'], 'widget', {'widget': 300, 'gadget': 200}",
      ].join("\n"),
      suiteFrom(rules("python-intermediate", "capstone-csv-analyzer")),
    );
    expect(failedNames(regexCheat).length).toBeGreaterThanOrEqual(4);
    expect(failedNames(csvCheat).length).toBeGreaterThanOrEqual(5);
  });
});
