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
- **Dev profile switcher (dev-only)** — everything under `frontend/src/__dev__/` is gated on `import.meta.env.DEV` and tree-shaken out of production bundles. A pre-hydration `bootstrap.ts` runs as the very first import in `main.tsx`, re-applying any active frozen profile's seed before the Zustand stores read localStorage. Ten canned profiles (nine frozen + one sandbox) exercise major UI states (fresh install, mid-course, shaky mastery, capstone-first-fail, all-complete, etc.); switching is driven by a `Cmd/Ctrl+Shift+Alt+D` capture-phase shortcut (uses `event.code === "KeyD"` so Mac Option-transformed keys still match) and a Developer tab in `SettingsPanel`. An allow-list in `applyProfile.ts` ensures OpenAI keys, theme, and UI size prefs are never touched by a profile swap; a one-shot `__dev__:realSnapshot` captured on first enable guarantees an exit path back to the dev's real user state.

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
│   ├── public/courses/      Course content (JSON + Markdown + starter files)
│   └── src/
│       ├── components/      Shared UI (Monaco, tutor views, settings, splitters)
│       ├── features/learning/
│       │   ├── pages/       Dashboard, CourseOverview, LessonPage
│       │   ├── components/  GuidedTutorPanel, LessonInstructions, CoachRail, WorkspaceCoach, etc.
│       │   ├── stores/      progressStore, learnerStore (localStorage-backed)
│       │   ├── repositories/ LearningRepository interface + implementations
│       │   └── utils/       Lesson validator
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
