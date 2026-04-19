/**
 * Add a practice exercise to an existing lesson.
 *
 * Usage:
 *   npx tsx scripts/new-practice.ts \
 *     --course python-fundamentals \
 *     --lesson functions \
 *     --id new-exercise \
 *     --title "New exercise" \
 *     --prompt "Describe what the learner should build." \
 *     --goal "What concept this exercise reinforces." \
 *     [--rule-style function|stdout|file]
 *
 * `--rule-style` picks the initial completionRule shape:
 *   - function → a function_tests scaffold with a single placeholder test
 *   - stdout   → an expected_stdout rule with a TODO expected
 *   - file     → a required_file_contains rule matching `def <id>`
 *
 * Also drops a blank solution stub under solution/practice/<id>.py.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANGUAGE_SYNTAX,
  entryFileFor,
  fileExtForLanguage,
  hasFunctionTestsHarnessLanguage,
  isScaffoldLanguage,
  type Language,
} from "./language";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

type RuleStyle = "function" | "stdout" | "file";

interface Args {
  course: string;
  lesson: string;
  id: string;
  title: string;
  prompt: string;
  goal: string;
  ruleStyle: RuleStyle;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    const next = argv[i + 1];
    const eat = () => {
      if (!next || next.startsWith("--")) die(`missing value for ${flag}`);
      i += 2;
      return next;
    };
    switch (flag) {
      case "--course": out.course = eat(); break;
      case "--lesson": out.lesson = eat(); break;
      case "--id": out.id = eat(); break;
      case "--title": out.title = eat(); break;
      case "--prompt": out.prompt = eat(); break;
      case "--goal": out.goal = eat(); break;
      case "--rule-style": {
        const v = eat();
        if (v !== "function" && v !== "stdout" && v !== "file") {
          die(`--rule-style must be one of function|stdout|file, got "${v}"`);
        }
        out.ruleStyle = v;
        break;
      }
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        die(`unknown flag: ${flag}`);
    }
  }
  for (const k of ["course", "lesson", "id", "title", "prompt", "goal"] as const) {
    if (out[k] === undefined) die(`missing required --${k}`);
  }
  return {
    course: out.course!,
    lesson: out.lesson!,
    id: out.id!,
    title: out.title!,
    prompt: out.prompt!,
    goal: out.goal!,
    ruleStyle: out.ruleStyle ?? "function",
  };
}

function die(msg: string): never {
  console.error(`new-practice: ${msg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}

function printHelp() {
  console.log(
    [
      "Append a practice exercise to an existing lesson.json and scaffold a solution stub.",
      "",
      "Required:",
      "  --course <id>     course folder id (e.g. python-fundamentals)",
      "  --lesson <id>     lesson folder id",
      "  --id <ex-id>      new exercise id (unique within the lesson)",
      "  --title <string>  exercise title",
      "  --prompt <string> learner-facing prompt",
      "  --goal <string>   what concept this exercise reinforces",
      "",
      "Optional:",
      "  --rule-style <function|stdout|file>   default: function",
    ].join("\n"),
  );
}

function functionPatternFor(lang: Language, fnName: string): string {
  // The pattern used in required_file_contains to verify the learner defined a
  // function. Mirrors the languages' declaration keywords.
  switch (lang) {
    case "python":
      return `def ${fnName}`;
    case "javascript":
    case "typescript":
      return `function ${fnName}`;
    case "ruby":
      return `def ${fnName}`;
    case "go":
      return `func ${fnName}`;
    case "rust":
      return `fn ${fnName}`;
    default:
      return fnName;
  }
}

function completionRulesFor(style: RuleStyle, id: string, lang: Language): unknown[] {
  const fnName = id.replace(/-/g, "_");
  const entry = entryFileFor(lang);
  const pattern = functionPatternFor(lang, fnName);
  if (style === "function") {
    const rules: unknown[] = [
      { type: "required_file_contains", file: entry, pattern },
    ];
    // Only languages with a registered function_tests harness get the
    // function_tests rule scaffolded. Others fall through to a plain
    // required_file_contains check.
    if (hasFunctionTestsHarnessLanguage(lang)) {
      rules.push({
        type: "function_tests",
        tests: [
          { name: "TODO replace", call: `${fnName}(1)`, expected: "1" },
        ],
      });
    }
    return rules;
  }
  if (style === "stdout") {
    return [{ type: "expected_stdout", expected: "REPLACE_WITH_EXPECTED" }];
  }
  // file
  return [{ type: "required_file_contains", file: entry, pattern }];
}

function starterFor(style: RuleStyle, id: string, lang: Language): string {
  const fnName = id.replace(/-/g, "_");
  if (style === "function" || style === "file") {
    return LANGUAGE_SYNTAX[lang].functionStub(fnName);
  }
  const commentPrefix = lang === "python" || lang === "ruby" ? "#" : "//";
  return `${commentPrefix} TODO: write your solution here\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const coursesDir = resolve(ROOT, "public/courses");
  const lessonDir = join(coursesDir, args.course, "lessons", args.lesson);
  const lessonJsonPath = join(lessonDir, "lesson.json");

  if (!existsSync(lessonJsonPath)) {
    die(`lesson not found: ${lessonJsonPath}`);
  }

  const lesson = JSON.parse(readFileSync(lessonJsonPath, "utf8")) as {
    language?: string;
    practiceExercises?: Array<{ id: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };

  const rawLang = lesson.language ?? "python";
  if (!isScaffoldLanguage(rawLang)) {
    die(
      `lesson.language "${rawLang}" is not supported by new-practice. ` +
        `Add a templates/<language>/ + scripts/language.ts entry first.`,
    );
  }
  const lang: Language = rawLang;

  if (args.ruleStyle === "function" && !hasFunctionTestsHarnessLanguage(lang)) {
    console.warn(
      `new-practice: --rule-style=function on a ${lang} lesson — ` +
        `no function_tests harness for this language, falling back to required_file_contains only.`,
    );
  }

  const existingIds = new Set((lesson.practiceExercises ?? []).map((e) => e.id));
  if (existingIds.has(args.id)) {
    die(`practice id "${args.id}" already exists in this lesson`);
  }

  const exercise = {
    id: args.id,
    title: args.title,
    prompt: args.prompt,
    goal: args.goal,
    starterCode: starterFor(args.ruleStyle, args.id, lang),
    completionRules: completionRulesFor(args.ruleStyle, args.id, lang),
    hints: [
      "Nudge without naming the tool.",
      "Name the tool and describe its shape.",
      "Show the smallest working example.",
    ],
  };

  lesson.practiceExercises = [...(lesson.practiceExercises ?? []), exercise];
  writeFileSync(lessonJsonPath, JSON.stringify(lesson, null, 2) + "\n");

  // Drop a solution stub (same extension as the lesson's entry file)
  const solutionDir = join(lessonDir, "solution", "practice");
  const ext = fileExtForLanguage(lang);
  const solutionPath = join(solutionDir, `${args.id}.${ext}`);
  const commentPrefix = lang === "python" || lang === "ruby" ? "#" : "//";
  if (!existsSync(solutionPath)) {
    writeFileSync(
      solutionPath,
      `${commentPrefix} TODO: write the golden solution for practice exercise "${args.id}".\n`,
    );
  }

  console.log(`new-practice: appended exercise "${args.id}" to lessons/${args.lesson}/lesson.json (${lang})`);
  console.log(`  - practiceExercises[] entry with ${args.ruleStyle}-style rules`);
  console.log(`  - solution stub at solution/practice/${args.id}.${ext}`);
  console.log("");
  console.log("Next: fill in the exercise body, replace TODOs, run `npm run lint:content`.");
}

main();
