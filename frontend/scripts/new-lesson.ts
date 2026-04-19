/**
 * Scaffold a new lesson folder.
 *
 * Usage:
 *   npx tsx scripts/new-lesson.ts \
 *     --course python-fundamentals \
 *     --id new-topic \
 *     --title "New topic" \
 *     --description "One-line description." \
 *     --minutes 15 \
 *     [--order 13]                 # default: max(existing)+1
 *     [--prereq previous-lesson]   # may repeat
 *     [--language python]          # default: python
 *
 * Runs content-lint at the end and prints the next steps.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  SCAFFOLD_LANGUAGES,
  entryFileFor,
  fileExtForLanguage,
  isScaffoldLanguage,
  type Language,
} from "./language";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const TEMPLATE_DIR = resolve(__dirname, "templates");

interface Args {
  course: string;
  id: string;
  title: string;
  description: string;
  minutes: number;
  order?: number;
  prereqs: string[];
  language: Language;
  multiFile: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> & { prereqs: string[] } = { prereqs: [] };
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
      case "--id": out.id = eat(); break;
      case "--title": out.title = eat(); break;
      case "--description": out.description = eat(); break;
      case "--minutes": out.minutes = Number(eat()); break;
      case "--order": out.order = Number(eat()); break;
      case "--language": out.language = eat(); break;
      case "--prereq": out.prereqs.push(eat()); break;
      case "--multi-file": out.multiFile = true; i += 1; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        die(`unknown flag: ${flag}`);
    }
  }
  for (const k of ["course", "id", "title", "description", "minutes"] as const) {
    if (out[k] === undefined) die(`missing required --${k}`);
  }
  const rawLang = (out as { language?: string }).language ?? "python";
  if (!isScaffoldLanguage(rawLang)) {
    die(
      `unsupported --language "${rawLang}". Supported: ${SCAFFOLD_LANGUAGES.join(", ")}. ` +
        `(Add a templates/<language>/ folder to support more.)`,
    );
  }
  return {
    course: out.course!,
    id: out.id!,
    title: out.title!,
    description: out.description!,
    minutes: out.minutes!,
    order: out.order,
    prereqs: out.prereqs,
    language: rawLang,
    multiFile: Boolean((out as { multiFile?: boolean }).multiFile),
  };
}

function die(msg: string): never {
  console.error(`new-lesson: ${msg}`);
  console.error("Run with --help for usage.");
  process.exit(2);
}

function printHelp() {
  console.log(
    [
      "Scaffold a new lesson under public/courses/<course>/lessons/<id>/.",
      "",
      "Required:",
      "  --course <id>         the course folder id (e.g. python-fundamentals)",
      "  --id <lesson-id>      the lesson id; matches the folder name",
      "  --title <string>      human-readable lesson title",
      "  --description <string>  one-line description for the course list",
      "  --minutes <n>         estimatedMinutes",
      "",
      "Optional:",
      "  --order <n>           lesson order (default: max existing + 1)",
      "  --prereq <lesson-id>  may be repeated; must exist and appear earlier",
      `  --language <lang>     default: python; supported: ${SCAFFOLD_LANGUAGES.join(", ")}`,
      "  --multi-file          scaffold starter/_index.json + entry + helper files",
    ].join("\n"),
  );
}

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

function helperFileNameFor(lang: Language): string {
  switch (lang) {
    case "python":
      return "helper.py";
    case "javascript":
      return "helper.js";
    default:
      return `helper.${fileExtForLanguage(lang)}`;
  }
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) die(`template variable missing: ${key}`);
    return values[key];
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const coursesDir = resolve(ROOT, "public/courses");
  const courseDir = join(coursesDir, args.course);
  const coursePath = join(courseDir, "course.json");

  if (!existsSync(coursePath)) die(`course not found: ${coursePath}`);

  const course = JSON.parse(readFileSync(coursePath, "utf8")) as {
    id: string;
    lessonOrder: string[];
    [k: string]: unknown;
  };

  if (course.lessonOrder.includes(args.id)) {
    die(`lesson id "${args.id}" already in course.lessonOrder`);
  }

  const lessonsDir = join(courseDir, "lessons");
  const lessonDir = join(lessonsDir, args.id);
  if (existsSync(lessonDir)) die(`lesson folder already exists: ${lessonDir}`);

  // Determine order: default max+1 (course.lessonOrder length + 1 as fallback)
  const inferredOrder = course.lessonOrder.length + 1;
  const order = args.order ?? inferredOrder;

  // Validate prereqs exist in the course's lessonOrder
  for (const pre of args.prereqs) {
    if (!course.lessonOrder.includes(pre)) {
      die(`prerequisite "${pre}" not in course.lessonOrder`);
    }
  }

  const prereqJson = args.prereqs.map((p) => JSON.stringify(p)).join(", ");

  const lessonJson = renderTemplate(loadTemplate("lesson.json.template"), {
    LESSON_ID: args.id,
    COURSE_ID: args.course,
    TITLE: args.title.replace(/"/g, '\\"'),
    DESCRIPTION: args.description.replace(/"/g, '\\"'),
    ORDER: String(order),
    LANGUAGE: args.language,
    ESTIMATED_MINUTES: String(args.minutes),
    PREREQ_JSON: prereqJson,
  });

  const contentMd = renderTemplate(loadTemplate("content.md.template"), {
    TITLE: args.title,
    DESCRIPTION: args.description,
  });

  const entry = entryFileFor(args.language);
  const ext = fileExtForLanguage(args.language);
  const starterTemplateName = `${args.language}/main.${ext}.template`;
  const starterSrc = renderTemplate(loadTemplate(starterTemplateName), {
    TITLE: args.title,
  });

  const commentPrefix = args.language === "python" ? "#" : "//";
  const helperFileName = helperFileNameFor(args.language);

  // Create folder structure
  mkdirSync(lessonDir, { recursive: true });
  mkdirSync(join(lessonDir, "starter"), { recursive: true });
  mkdirSync(join(lessonDir, "solution"), { recursive: true });
  mkdirSync(join(lessonDir, "solution", "practice"), { recursive: true });

  writeFileSync(join(lessonDir, "lesson.json"), lessonJson);
  writeFileSync(join(lessonDir, "content.md"), contentMd);
  writeFileSync(join(lessonDir, "starter", entry), starterSrc);
  if (args.multiFile) {
    // Two-file scaffold: entry (driver) + helper (module under test).
    // _index.json is a flat JSON array per the loader contract.
    writeFileSync(
      join(lessonDir, "starter", "_index.json"),
      JSON.stringify([entry, helperFileName], null, 2) + "\n",
    );
    writeFileSync(
      join(lessonDir, "starter", helperFileName),
      `${commentPrefix} TODO: move supporting code (data, helper functions) into this module\n` +
        `${commentPrefix} and import it from ${entry}.\n`,
    );
  }
  writeFileSync(
    join(lessonDir, "solution", entry),
    `${commentPrefix} TODO: author the golden solution — must satisfy every completionRule.\n`,
  );

  // Append to course.lessonOrder if not already present (we checked earlier)
  course.lessonOrder.push(args.id);
  writeFileSync(coursePath, JSON.stringify(course, null, 2) + "\n");

  console.log(`new-lesson: scaffolded lessons/${args.id}/ (${args.language})`);
  console.log("  - lesson.json");
  console.log("  - content.md");
  console.log(`  - starter/${entry}`);
  console.log(`  - solution/${entry}  (stub — replace with golden solution)`);
  console.log("  - solution/practice/  (populate as you add practice exercises)");
  console.log(`  - updated course.json lessonOrder (+${args.id})`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Edit lesson.json — fill objectives, teachesConceptTags, completionRules");
  console.log("  2. Edit content.md — write the lesson body");
  console.log(`  3. Edit starter/${entry} — provide the scaffold learners see`);
  console.log(`  4. Write solution/${entry} — must satisfy every completionRule`);
  console.log("  5. Run: npm run lint:content");
  console.log("  6. Run: npm run verify:solutions");

  console.log("\nRunning content-lint now...");
  const r = spawnSync("npx", ["tsx", join(__dirname, "content-lint.ts")], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (r.status !== 0) {
    console.error("\nnew-lesson: content-lint reported issues (expected for a fresh scaffold — fix them as you author the lesson).");
  }
}

main();
