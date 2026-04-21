# Content authoring guide

This is the reference for adding or editing lessons in a CodeTutor AI course. If you can follow this doc end-to-end, you should be able to ship a new lesson in under 30 minutes.

The authoring pipeline is:

1. Scaffold the lesson folder with `npm run new:lesson` (or by hand if you prefer).
2. Write `content.md`, edit `lesson.json`, fill in `starter/<entry>` (e.g., `main.py`, `main.js`).
3. Write the golden `solution/<entry>` — must pass every `completionRule`.
4. Run `npm run lint:content` — must be clean.
5. Run `npm run verify:solutions` — must be clean.
6. Open a PR. CI re-runs both commands and fails if either breaks.

Everything under `frontend/public/courses/<courseId>/` is plain JSON + Markdown + source files. No build step; files are fetched at runtime.

## Languages

A course declares its `language` in `course.json`; every lesson inherits it via `lesson.json.language`. Today:

| Language | Guided authoring? | `function_tests` harness? | `function_tests` floor (lesson `order`) |
| --- | --- | --- | --- |
| `python` | ✓ (production course — `python-fundamentals`) | ✓ | 6 (after `functions` lesson) |
| `javascript` | ✓ (production course — `javascript-fundamentals`) | ✓ | 5 (after `functions-basics` lesson) |
| everything else on the editor's `Language` enum | ✗ (no scaffolder / no course yet) | ✗ | n/a |

`frontend/scripts/language.ts` is the scripts-side source of truth: `SCAFFOLD_LANGUAGES` (which languages `new-lesson`/`new-practice` accept), `entryFileFor(language)` (e.g., `main.py` / `main.js`), `fileExtForLanguage`, per-language `functionStub`, and `hasFunctionTestsHarnessLanguage(language)`. The per-language authoring floor lives in `FUNCTION_TESTS_ORDER_FLOOR_BY_LANGUAGE` inside `scripts/content-lint.ts` — it tracks when each course introduces the concept of user-defined functions. Templates live under `scripts/templates/<language>/`. When adding a new language, add SCAFFOLD entry + templates here, pick a floor, and register a backend `HarnessBackend` in `backend/src/services/execution/harness/` before attempting to author `function_tests` lessons.

An `"internal": true` flag on `course.json` hides a course from learner-facing listings (`courseLoader.listPublicCourses()` filters these out) while keeping it visible to the dev content-health dashboard and all CI tooling. Use this for smoke-test courses like `_internal-js-smoke` that only exist to keep non-Python code paths exercised end-to-end.

---

## Folder layout

```
frontend/public/courses/
└─ python-fundamentals/
   ├─ course.json
   └─ lessons/
      └─ new-topic/
         ├─ lesson.json
         ├─ content.md
         ├─ starter/
         │  └─ main.py           (or _index.json + multiple files)
         └─ solution/
            ├─ main.py           (golden solution for completionRules)
            ├─ input.txt         (optional — stdin fed to main.py)
            └─ practice/
               └─ <exerciseId>.py   (one per practiceExercise)
               └─ <exerciseId>.stdin (optional)
```

The `solution/` folder is not shipped to learners — it lives in the repo so CI can verify your rules are actually satisfiable.

---

## `course.json`

```jsonc
{
  "id": "python-fundamentals",
  "title": "Python Fundamentals",
  "description": "…",
  "language": "python",
  "lessonOrder": [
    "hello-world",
    "variables",
    "…"
  ],
  "baseVocabulary": ["identifiers"]
}
```

- `id` must equal the folder name.
- `lessonOrder` is the canonical sequence. Every listed id must be a folder under `lessons/`. Orphan folders (not in the list) produce a lint warning.
- `baseVocabulary` is the list of concept tags that are assumed primitive — i.e., a lesson may reference them in `usesConceptTags` without any earlier lesson teaching them. Keep this list tiny.

---

## `lesson.json`

The Zod schema at `frontend/src/features/learning/content/schema.ts` is the source of truth; the lint CLI parses every file against it.

```jsonc
{
  "id": "functions",
  "courseId": "python-fundamentals",
  "title": "Functions",
  "description": "Define and call your own functions.",
  "order": 6,
  "language": "python",
  "estimatedMinutes": 20,
  "objectives": ["…"],
  "teachesConceptTags": ["def", "parameters", "return"],
  "usesConceptTags": ["variables", "print"],
  "completionRules": [ /* see below */ ],
  "prerequisiteLessonIds": ["loops"],
  "recap": "…",
  "practicePrompts": ["…"],
  "practiceExercises": [ /* see below */ ]
}
```

### Required fields

| Field | Rule |
| --- | --- |
| `id` | kebab-or-snake; must equal the folder name |
| `courseId` | must equal the parent `course.json.id` |
| `order` | positive integer; unique within the course |
| `estimatedMinutes` | positive integer; honest estimate |
| `objectives` | non-empty; each a short verb-phrase |
| `teachesConceptTags` | concepts this lesson *introduces* for the first time |
| `usesConceptTags` | concepts this lesson *relies on* from earlier lessons |
| `completionRules` | non-empty; what the learner must produce for the lesson to be marked complete |
| `prerequisiteLessonIds` | each must appear earlier in `course.lessonOrder` |

### Rules for concept tags

- A tag must never appear in both `teachesConceptTags` AND `usesConceptTags` of the same lesson — that's a lint error.
- Every entry in `usesConceptTags` must have been taught by an earlier lesson OR be listed in `course.baseVocabulary`. Otherwise the lesson is referencing something the learner hasn't seen.
- The same tag taught by two lessons produces a *warning*, not an error — occasional rewording is legal.

### Completion rule types

There are three active rule types (plus a dead `custom_validator` that's reserved but not implemented).

#### `expected_stdout`

```json
{ "type": "expected_stdout", "expected": "Hello, World!" }
```

Runs `python3 main.py` (with `solution/input.txt` on stdin if present) and matches by trimmed substring. Use for output-shaped lessons.

#### `required_file_contains`

```json
{ "type": "required_file_contains", "file": "main.py", "pattern": "def letter_grade" }
```

Checks that `main.py` contains the pattern. If the pattern starts with a word character it's word-boundary aware (so `def foo` won't match `undefine_foo`). If the pattern starts with punctuation it's plain `includes`. Use this as a structural gate ("did the learner define the function we asked for?") rather than a behavior check.

Avoid brittle patterns like `append(0` or `sum(` — they false-pass on incidental uses elsewhere. Prefer `def <name>`.

#### `function_tests`

```json
{
  "type": "function_tests",
  "tests": [
    { "name": "A range", "call": "letter_grade(95)", "expected": "'A'" },
    { "name": "F at 59", "call": "letter_grade(59)", "expected": "'F'", "hidden": true, "category": "range-boundaries" }
  ]
}
```

The harness runs the learner's entry file (`main.py` / `main.js` / …), then evaluates each `call` in an isolated scope with the learner's definitions in scope. Expected-value syntax follows the target language:

- **Python:** parsed via `ast.literal_eval` — Python literals only (`'A'`, `42`, `[1, 2]`, `{'k': 1}`, `True`, `None`, tuples).
- **JavaScript:** parsed via `JSON.parse` — JSON literals only. Strings use double quotes; object keys must be quoted (`{"a": 2}`, not `{a: 2}`); `undefined` isn't JSON (`null` is the closest equivalent).

Content-lint validates this round-trip per-language, so typos surface at `npm run lint:content` time rather than in production.

- **Language support:** `function_tests` is only valid for languages with a registered `HarnessBackend` (see `backend/src/services/execution/harness/registry.ts`). Python and JavaScript have backends today; other languages are rejected by `content-lint` with a clear author-facing error, and `verify-solutions` loudly skips them on non-harness languages rather than failing CI.
- **Authoring gate:** lessons may not declare `function_tests` before functions have been taught. The floor is language-specific — Python teaches `def` at order 6, JavaScript teaches `function` at order 5. `content-lint` enforces the right floor per course.
- **Hidden tests** stay hidden in the UI. They're good for stretch cases and anti-cheese.
- **Category** surfaces softly in the "Check My Work" failure panel after 2+ consecutive failures.
- **Setup/call split** lets you test mutating functions without letting the learner observe the setup directly:

```json
{
  "setup": "_t = []\nadd_task(_t, 'A')\nadd_task(_t, 'B')",
  "call": "_t[1]['text']",
  "expected": "'B'"
}
```

If a lesson is function-shaped, drop `expected_stdout` in favor of `function_tests`. If it's output-shaped (print this line), stay on `expected_stdout`. Capstones may keep both intentionally — the stdout rule exercises the learner's `if __name__ == "__main__":` block.

### Picking between rule types

| Lesson shape | Rule type |
| --- | --- |
| "Print this exact output" | `expected_stdout` |
| "Fill in this bug until it prints X" | `expected_stdout` |
| "Define a function named X that returns Y" | `function_tests` (+ `required_file_contains: "def X"` as a shape gate) |
| "Produce output and also use a specific construct" | `expected_stdout` + `required_file_contains` |

### Practice exercises

Each `practiceExercises[i]` has its own `completionRules`, independent of the main lesson. The same rule types apply. Practice rules are graded in a fresh session and do not affect main-lesson completion.

- IDs must be unique within the lesson.
- Hints follow the same 3-rung ladder as main lessons (nudge → name the tool → smallest working example).
- For `function_tests` practice exercises, a read-only "Examples" mini-list renders in the practice view — the same visible/hidden distinction applies.

---

## `content.md`

Freeform Markdown rendered in the instructions panel. Conventions:

- `# <title>` — first-level heading matches `lesson.json.title`.
- `## What you'll learn` — bullet list mirroring `objectives`.
- `## Instructions` — the task, plain language.
- `## Key concepts` — one subsection per concept being taught.
- `## Hints` — free-form hint ladder (tutor panel surfaces them; do not rely on auto-reveal).

Use fenced code blocks with an explicit language tag (```python`).

---

## Starter code

`starter/main.py` is what the learner sees when they open the lesson. Keep it terse — stubs and TODOs, not a working implementation.

If a lesson's completion rule is `function_tests`, make sure any input-reading code is inside `if __name__ == "__main__":` — the harness runs `main.py` via `runpy` with a non-`__main__` name so the guard skips and `input()` is not called against empty stdin.

### Multi-file starters

The loader supports multi-file starters, but no lesson currently uses them in production. Adopt with care — prefer single-file starters until a real pedagogy need appears.

Layout:

```
starter/
├─ _index.json       // flat JSON array: ["main.py", "helper.py"]
├─ main.py
└─ helper.py
```

`_index.json` is a flat array of filenames (matches `loadStarterFiles` in `src/features/learning/content/courseLoader.ts`). Content-lint validates:

- `_index.json` is a non-empty array of unique string filenames
- Every listed file exists under `starter/`
- Warns on orphan files in `starter/` that aren't listed in the index

Scaffold with `npm run new:lesson -- … --multi-file` to get the skeleton for free.

Caveats:

- The in-editor tab UX is single-file-centric — multi-file lessons put more cognitive load on the learner. Make sure the lesson actually benefits from the split.
- `function_tests` still runs against `main.py` only. Helper modules must be imported from `main.py` for the harness to reach them.
- `required_file_contains` can name any file in the starter via the `file` field — use this to assert patterns in helper modules.

---

## Golden solutions

Every lesson and every practice exercise must have a committed solution that satisfies its rules.

- Main lesson solution: `solution/main.py` (+ optional `solution/input.txt` for stdin).
- Practice solutions: `solution/practice/<exerciseId>.py` (+ optional `<exerciseId>.stdin`).

`npm run verify:solutions` copies each solution into a private temp dir as `main.py`, feeds it the stdin file if present, and runs every `completionRule` against it via the same engine the production validator uses. Any failure is a CI failure.

If your lesson uses `function_tests`, the solution must expose the tested function at module scope (so the harness can eval `funcname(args)` against the module's globals).

---

## Local development checklist

```bash
# from /frontend
npm run lint:content       # schema + structural + concept graph
npm run verify:solutions   # run every golden solution against every rule
npm run typecheck          # TS + Zod inference stays in sync
npm test                   # unit tests
```

All four must be clean before you push. CI runs the same four and blocks the PR on any failure.

---

## Scaffolding new lessons

```bash
npm run new:lesson -- \
  --course python-fundamentals \
  --id new-topic \
  --title "New topic" \
  --description "One-line pitch." \
  --minutes 15 \
  --prereq previous-lesson \
  --language python          # optional; defaults to the course's language
```

Creates the folder, populates templates from `scripts/templates/<language>/`, appends to `course.json.lessonOrder`, and runs content-lint so you see the fields that still need attention.

```bash
npm run new:practice -- \
  --course python-fundamentals \
  --lesson functions \
  --id new-exercise \
  --title "New exercise" \
  --prompt "Learner-facing prompt" \
  --goal "What concept this reinforces" \
  --rule-style function     # or stdout | file
```

Appends the exercise to the lesson and drops a solution stub. `--rule-style function` is only available for languages with a registered `function_tests` harness (Python and JavaScript today); pick `stdout` or `file` for other languages.

---

## Writing good hints

Hint copy sits between "useless" and "spoilers." The 3-rung ladder rule of thumb:

1. **Direction without the name.** ("You need a way to repeat something for each item.")
2. **Name the tool and its shape.** ("Use a `for` loop: `for item in things:`.")
3. **Smallest working example.** Three lines that show the pattern in an unrelated context.

Hints do not auto-reveal. The tutor panel surfaces them on the learner's ask or when the coach rules fire. Keep them terse.

---

## When a rule isn't satisfiable

`npm run verify:solutions` will catch this early, but the usual symptoms are:

- `function_tests` expected value doesn't round-trip through the language's parser (Python: `ast.literal_eval`, JavaScript: `JSON.parse`) — lint error.
- Solution output doesn't include the `expected_stdout` substring — verify-solutions failure.
- `required_file_contains` pattern doesn't match the solution source — verify-solutions failure.

Fix the rule or fix the solution — don't commit the mismatch.

---

<sub>Copyright &copy; 2026 Mehul Srivastava. All rights reserved. See [LICENSE](../LICENSE).</sub>
