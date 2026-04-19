# Architecture

```
                           +--------------------------------------------+
                           |           Docker Desktop (host)            |
                           |                                            |
+------------------+  HTTP/JSON  +------------------+  docker.sock  +------------------+
|     Frontend     | ----------> |     Backend      | ------------> |  Runner (1:1)    |
|                  |             |                  |   (sibling)   |                  |
|  React + Vite    |             |  Express + TS    |               |  Python, Node,   |
|  React Router    | <---------- |  dockerode       | <------------ |  gcc, JDK, Go,   |
|  Monaco + Zustand|   SSE/JSON  |  prompt builders |   stdout/err  |  Rust, Ruby      |
|  Tailwind CSS    |             |  OpenAI proxy    |               |  --network none  |
+------------------+             +------------------+               +------------------+
      :5173                            :4000                    bind: ./temp/sessions/{id}
```

## Frontend

- **React Router** — `/` (start page), `/editor`, `/learn`, `/learn/course/:id`, `/learn/course/:id/lesson/:id`. Lazy-loaded pages with Suspense.
- **6 Zustand stores** — `projectStore` (files/editor, per-context switching), `aiStore` (tutor/history, per-context switching), `sessionStore` (backend session), `runStore` (execution, per-context switching), `progressStore` (lesson progress in localStorage), `learnerStore` (anonymous identity).
- **Shared tutor rendering** — `TutorResponseViews.tsx` provides section cards, badges, walkthrough steps, interactive check questions, citations, action chips, and error views (with one-click retry). Used by both `AssistantPanel` (editor) and `GuidedTutorPanel` (lessons).
- **Course content** — static JSON + Markdown in `frontend/public/courses/`. Loaded at runtime via fetch. No build step for content authoring.
- **Theme system** — `util/theme.ts` holds `ThemePref` (`system` | `light` | `dark`) in localStorage and applies `data-theme` + `color-scheme` to `<html>`. Semantic Tailwind tokens (`bg`, `panel`, `muted`, `accent`, `success`, `danger`, `violet`, …) resolve to CSS variables defined in `index.css`, so the whole app — including the Monaco editor theme — swaps in lockstep. Components never reference raw palette colors (`green-500`, `red-400`) — always semantic tokens.
- **Splitter bounds** — side-panel widths are clamped to `min(hardMax, viewport × 0.45)` so the editor can't be squeezed to nothing on narrow displays. Vertical (output) splitters use a plain min/max clamp.

## Backend

- **Sibling-container pattern** — the backend spawns isolated runner containers via the host Docker daemon. Cross-platform host-path discovery via Docker API self-inspection.
- **Modular prompt pipeline** — `prompts/` directory with separate modules for core rules, stuck detection, persona, situation building, context rendering, schema, and summarization. Two prompt builders assemble from these modules:
  - `editorPromptBuilder` — free-form editor tutor
  - `guidedPromptBuilder` — adds lesson context block with objectives, concept scope, and "never solve" constraints
- **Structured JSON responses** — OpenAI Responses API with strict `json_schema`. Intent classification (`debug`/`concept`/`howto`/`walkthrough`/`checkin`) drives which sections get filled.
- **Provider abstraction** — prompt building and API calls sit behind a `Provider` interface. When `lessonContext` is present in the request, the guided prompt builder is used automatically.

## Guided Learning System

- **File-based courses** — `frontend/public/courses/{courseId}/lessons/{lessonId}/` containing `lesson.json` (metadata, objectives, completion rules), `content.md` (instructions), and `starter/` (initial files).
- **Client-side validation** — `expected_stdout` (output comparison) and `required_file_contains` (code content checks). Runs against the latest `RunResult` without a backend round-trip.
- **localStorage persistence** — versioned keys (`learner:v1:progress:{courseId}`, `learner:v1:lesson:{courseId}:{lessonId}`). Course/lesson status, timestamps, attempt/run/hint counts, code snapshots, and last output.
- **Atomic state mutations** — all progress counters use Zustand's `set()` callback for race-condition-free read-modify-write, with automatic localStorage fallback for hydration.
- **Repository abstraction** — `LearningRepository` interface with `LocalLearningRepository` (localStorage) and `RemoteLearningRepository` (stub) for future backend persistence.
- **Coach rail** — `CoachRail` component with a priority-ordered rule engine. Observes elapsed time, edit/run/check state, and failed attempt count to surface one contextual nudge at a time. Purely deterministic — no AI or API calls.
- **Onboarding overlays** — `WelcomeOverlay`, `EditorCoach`, and `WorkspaceCoach` use `box-shadow` cutouts for spotlight effects. Each persisted via separate localStorage flags; auto-skip steps whose target ref is null.
- **Practice mode** — each `lesson.json` may carry a `practiceExercises[]` array (id, title, prompt, goal, starterCode, completionRules, hints). Lesson completion never requires practice. Entering practice snapshots the learner's lesson code into a ref, swaps the instructions panel to `PracticeInstructionsView`, and applies the exercise's starter; exit restores the snapshot. Practice runs skip `saveCode`/`saveOutput` so lesson state stays untouched. Completion is tracked via `practiceCompletedIds` on `LessonProgress`, with dedup-safe append (`completePracticeExercise`) and an independent reset (`resetPracticeProgress`). The course overview surfaces per-lesson practice chips and an aggregate progress bar.
- **Function-test harness** — capstone-style lessons declare a `function_tests` completion rule with hardcoded visible and hidden test cases (`{ name, call, expected, hidden?, category? }`). `POST /api/execute/tests` generates a per-run Python harness that executes learner code via `runpy.run_path` (skips `__main__` guards), then evaluates each test in a fresh namespace using `ast.literal_eval` on `expected`. Results stream back as a sentinel-wrapped JSON payload (`__CODETUTOR_TESTS_v1_…__{…}__…__`) that the frontend parses into a `TestReport`. The instructions panel gains an Instructions ⇄ Examples tab when `function_tests` is present; Examples tab hosts the visible test cards plus a `FailedTestCallout` that surfaces one failure at a time (visible-first priority). Check My Work auto-switches to Examples on failure and shows a tab-header dot until viewed. Hidden test names/inputs are never leaked; the author-tagged `category` string appears only after two consecutive fails on the same hidden test.
- **Per-language harness layer** — the Python harness above is one implementation of a language-agnostic interface so additional languages can slot in without changing route code or the validator. `backend/src/services/execution/harness/types.ts` defines `HarnessBackend { language, generate(tests), parseOutput(stdout) }`. `registry.ts` is a `language → HarnessBackend` lookup; `runHarness.ts` is the single dispatch entry point. `/api/execute/tests` accepts `language: languageSchema`, dispatches through the registry, and returns a 422 when a language has no registered backend. Today only `pythonHarness.ts` is registered; JS/TS/Java/Go/Rust/Ruby harnesses plug in here in Phase 12. `content-lint` and the `verify-solutions` CLI consult the same registry so authors get an author-facing error if they declare `function_tests` on a language without backend support, and CI skips verification (rather than failing) with a loud `[skip: no harness for <lang>]` for declarative `expected_stdout`-only lessons that happen to be non-Python. `LANGUAGE_ENTRYPOINT: Record<Language, string>` in `frontend/src/types.ts` is the single source of truth for entry filenames (`python → main.py`, `javascript → main.js`, …); scripts mirror this via `frontend/scripts/language.ts` (`entryFileFor`, `fileExtForLanguage`, `SCAFFOLD_LANGUAGES`, per-language `functionStub`). Courses can flag themselves `"internal": true` in `course.json` — `courseLoader.listPublicCourses()` filters those out of learner-facing listings, while `ContentHealthPage` uses the unfiltered list. The `_internal-js-smoke` course exists to keep every non-Python code path exercised end-to-end: schema validates, loader reads `main.js` starter, `LessonPage` routes the run, `verify-solutions` dispatches correctly, `content-lint` stays clean.
- **Dev profile switcher (dev-only)** — everything under `frontend/src/__dev__/` is gated on `import.meta.env.DEV` and tree-shaken out of production bundles. A pre-hydration `bootstrap.ts` runs as the very first import in `main.tsx`, re-applying any active frozen profile's seed before the Zustand stores read localStorage. Ten canned profiles (nine frozen + one sandbox) exercise major UI states (fresh install, mid-course, shaky mastery, capstone-first-fail, all-complete, etc.); switching is driven by a `Cmd/Ctrl+Shift+Alt+D` capture-phase shortcut (uses `event.code === "KeyD"` so Mac Option-transformed keys still match) and a Developer tab in `SettingsPanel`. An allow-list in `applyProfile.ts` ensures OpenAI keys, theme, and UI size prefs are never touched by a profile swap; a one-shot `__dev__:realSnapshot` captured on first enable guarantees an exit path back to the dev's real user state.
- **Content health dashboard (dev-only)** — sibling to the profile switcher, mounted at `/dev/content` via a conditional `lazy(() => import(...))` in `App.tsx` guarded by `import.meta.env.DEV`. Fetches `course.json` + every `lesson.json` at runtime, runs `buildConceptGraph` client-side, and probes for `solution/main.py` + `content.md` with an index-html-aware `hasFile()`. Renders a per-lesson table with completion-rule mix, teaches/uses counts, content + solution presence, and concept-graph issues — authors see every health signal on one screen without running CLIs.

## Content Validation Pipeline

The `frontend/public/courses/` tree is plain JSON + Markdown + Python, but three layers keep it honest:

- **Zod schema (`frontend/src/features/learning/content/schema.ts`)** — `courseSchema`, `lessonMetaSchema`, `practiceExerciseSchema`, and a `completionRuleSchema` discriminated union on `type` (`expected_stdout` | `required_file_contains` | `function_tests`). `LessonMeta` is `z.infer<typeof lessonMetaSchema>`, so the TypeScript interface and the runtime validator share a single source of truth.
- **Concept graph (`frontend/src/features/learning/content/conceptGraph.ts`)** — each lesson declares `teachesConceptTags` (concepts introduced here for the first time) and `usesConceptTags` (concepts required from earlier lessons). `course.baseVocabulary` is an escape hatch for primitive tags like `identifiers` that no lesson formally teaches. `buildConceptGraph()` walks the course in order and emits `missing` (used before taught), `overlap` (tag in both teaches and uses of the same lesson), and `duplicate-teach` (warning) issues. A companion `conceptsAvailableBefore(course, lessons, lessonId)` exposes the accumulated vocabulary up to (but excluding) a given lesson, and `LessonPage` threads that into the tutor request as `priorConcepts` — the guided prompt builder then renders three labeled lines (TEACHES / USES / EARLIER lessons) so the model knows exactly which vocabulary is in scope for the current turn.
- **Content lint (`frontend/scripts/content-lint.ts`)** — the CLI that `npm run lint:content` drives. Parses every file against the Zod schemas, then layers on structural checks: folder id ↔ `lesson.json.id` ↔ `courseId` parent, unique + contiguous `order`, prereqs appear earlier in `lessonOrder`, practice-ids unique within a lesson, `starter/` non-empty, `content.md` non-empty, `function_tests.expected` round-trips through `ast.literal_eval` (validated via a Python subprocess), `required_file_contains.file` (when present) names a real starter file, multi-file `starter/_index.json` shape matches the loader, and `function_tests` blocked on lessons with `order < 6`. Runs in CI as the `content-lint` job.
- **Golden solutions + verify-solutions (`frontend/scripts/verify-solutions.ts`)** — every lesson and every practice exercise has a committed correct solution under `lessons/<id>/solution/`. The verifier copies each solution into a private temp dir and runs every `completionRule` against it with the same engine the production validator uses (the `runpy`-based harness for `function_tests`, a `python3` subprocess for `expected_stdout`, a string check for `required_file_contains`). Runs in CI as the `solutions-pass` job, which `needs: content-lint`. Uses `python3` directly rather than the runner container — we trust our own solutions, and sandboxing is reserved for learner code.
- **Authoring CLIs (`frontend/scripts/new-lesson.ts`, `new-practice.ts`)** — flag-based scaffolders that render templates from `scripts/templates/`, update `course.lessonOrder`, and auto-run the lint. `--multi-file` on `new-lesson` scaffolds the two-file starter (`_index.json` + `main.py` + `helper.py`). See [CONTENT_AUTHORING.md](./CONTENT_AUTHORING.md) for the full workflow.

## Testing

Three layers, each catching a different class of bug:

- **Unit tests (`frontend`/`backend`, Vitest)** — pure functions, store reducers, prompt builders, validators, the Python harness generator. Run on every commit. No network, no Docker.
- **Content validation (`npm run lint:content` + `verify:solutions`)** — see the pipeline section above. Keeps course JSON honest and every golden solution passing against the same engine production uses.
- **End-to-end (`e2e/`, Playwright)** — drives the real product: Vite dev server + Dockerized backend + Python runner + real localStorage/IndexedDB. Catches UI-integration regressions that unit tests miss (Monaco focus, modal portals, SSE streaming, Zustand hydration, router navigation). Chromium-only, 95 specs across editor / guided-learning / function-tests / dev-profiles / progress-I/O / AI-tutor (mocked) / onboarding / coach-rail / settings / lesson-edge. OpenAI is mocked by default (`aiMocks.ts` replays canned SSE frames); an opt-in `specs/real-api/**` suite (`E2E_REAL_OPENAI=1`) hits a real key for release-gate smoke. Deterministic starting states come from the dev-profile seed JSONs, regenerated from `__dev__/profiles.ts` via `npm run dump-seeds` so fixtures can't drift. CI job: `.github/workflows/e2e.yml`.

## API Surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/session` | Create session + runner container |
| `POST` | `/api/session/ping` | Heartbeat |
| `POST` | `/api/session/rebind` | Reuse same ID after expiry |
| `POST` | `/api/session/end` | Destroy session + container |
| `POST` | `/api/project/snapshot` | Write project into workspace |
| `POST` | `/api/execute` | Compile (if needed) and run |
| `POST` | `/api/execute/tests` | Run a lesson's `function_tests` harness and return a `TestReport` |
| `POST` | `/api/ai/validate-key` | Check an OpenAI key |
| `GET`  | `/api/ai/models` | List chat-capable models |
| `POST` | `/api/ai/ask/stream` | Tutor turn (SSE stream, supports `lessonContext`) |
| `POST` | `/api/ai/ask` | Tutor turn (non-streaming) |
| `POST` | `/api/ai/summarize` | Compress older history |

## Project Layout

```
codetutor-ai/
├── backend/                 Express + TypeScript
│   └── src/services/ai/
│       ├── prompts/         Modular prompt components (8 modules)
│       ├── editorPromptBuilder.ts
│       └── guidedPromptBuilder.ts
├── frontend/                React + Vite + Tailwind
│   ├── public/courses/      Course content (JSON + Markdown + starter + golden solutions)
│   ├── scripts/             content-lint, verify-solutions, new-lesson, new-practice
│   └── src/
│       ├── components/      Shared UI (Monaco, tutor views, settings, splitters)
│       ├── features/learning/
│       │   ├── pages/       Dashboard, CourseOverview, LessonPage
│       │   ├── components/  GuidedTutorPanel, LessonInstructions, CoachRail, WorkspaceCoach, etc.
│       │   ├── content/     Zod schema, conceptGraph, courseLoader
│       │   ├── stores/      progressStore, learnerStore (localStorage-backed)
│       │   ├── repositories/ LearningRepository interface + implementations
│       │   └── utils/       Lesson validator
│       ├── __dev__/         Dev-only profile switcher + content health (tree-shaken in prod)
│       ├── pages/           StartPage, EditorPage
│       └── state/           Zustand stores (project, ai, session, run)
├── runner-image/            Polyglot Dockerfile (9 language toolchains)
├── samples/                 Starter projects per language
├── docker-compose.yml
├── start.sh / stop.sh       macOS/Linux launcher
└── start.ps1 / stop.ps1     Windows launcher
```

## Security Note

The Docker socket mount gives the backend root-equivalent access to the local daemon — fine for local use, **not** suitable for public deployment without further sandboxing.
