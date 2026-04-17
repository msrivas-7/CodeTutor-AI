# CodeTutor AI

A dual-mode, web-based coding platform with an AI tutor. **Editor mode** is a free-form playground for nine languages. **Guided Learning mode** walks beginners through structured Python lessons with progress tracking, lesson-aware AI hints, and auto-validated exercises. Everything runs locally in Docker — bring your own OpenAI key.

![Stack](https://img.shields.io/badge/stack-React%20%7C%20Vite%20%7C%20Monaco%20%7C%20Express%20%7C%20Docker-0f172a)
![Languages](https://img.shields.io/badge/languages-Python%20%7C%20JS%20%7C%20TS%20%7C%20C%20%7C%20C%2B%2B%20%7C%20Java%20%7C%20Go%20%7C%20Rust%20%7C%20Ruby-38bdf8)
![License](https://img.shields.io/badge/license-MIT-34d399)

---

## Two Modes, One Platform

### Editor Mode — free-form playground

Write, run, and debug code in **9 languages** with a Monaco-powered editor and an AI tutor that gives hints, not answers.

- **Monaco editor** — VS Code engine, custom dark theme, bracket-pair colorization, JetBrains Mono ligatures, tab strip with middle-click close.
- **Three-pane workspace** — draggable splitters, collapsible file tree and tutor panel, layout state remembered across sessions.
- **Nine starter projects** — Python, JavaScript, TypeScript, C, C++, Java, Go, Rust, Ruby; multi-file so imports/modules work from turn one.
- **Sandboxed Docker execution** — one container per session, `--network none`, 512 MB RAM, 10s timeout, non-root user. Stdout, stderr, exit code, duration, and error type (`compile`/`runtime`/`timeout`) shown as colored pills.
- **Stdin support** — dedicated tab pre-seeded with sample input per language.
- **First-time editor tour** — 6-step spotlight walkthrough on first visit: language picker, file tree, code editor, run button, output panel, and AI tutor. Shown once, skippable, tracked in localStorage.

### Guided Learning Mode — structured Python course

A 10-lesson Python fundamentals course with instructions, starter code, and auto-validated exercises. Built for beginners.

- **Lesson workspace** — three-panel layout: instructions (left), editor + output (center), lesson-aware tutor (right). All panels resizable and collapsible.
- **10 complete lessons** — Hello World, Variables, Input/Output, Conditionals, Loops, Functions, Lists, Dictionaries, Debugging Basics, and a Mini Project that ties everything together. Each lesson includes a post-completion recap and practice prompts.
- **Auto-validation** — "Check Solution" compares run output and file contents against completion rules. Pass to see a celebration with confetti, a recap of concepts learned, and suggested practice challenges. "Next Lesson" button appears on completion.
- **Progress tracking** — lesson status, run count, hint count, attempt count, code snapshots, and last output persist in `localStorage` across browser sessions. Returning to a lesson restores your code with a "Resuming where you left off" indicator. Reset individual lesson progress or the entire course from the UI.
- **Lesson-aware AI tutor** — the tutor knows the lesson objectives, concepts, and completion criteria. It guides toward the solution without giving it away, and stays within the scope of what the lesson has taught so far. Three-level hint ladder (gentle hint → stronger hint → show approach), one-click "Explain Error" button when runs produce stderr.
- **Proactive coach rail** — contextual nudges appear in the instructions panel based on student behavior. Timer and state-driven (no AI needed): prompts to read instructions, try editing, run code, check solutions, or ask for hints — adapting as the student progresses through each lesson.
- **First-time onboarding** — new visitors see a 3-step welcome spotlight on the start page introducing the platform, editor mode, and guided course. The dashboard and course overview show contextual nudges for first-time users. Opening a lesson triggers a 6-step spotlight tour of the workspace (instructions, editor, run, output, check solution, tutor). All shown once, skippable, tracked in localStorage.
- **Learning dashboard** — progress summary with gradient bar, "Next up" card, recent activity feed (last 3 lessons with timestamps), and "Might Need Review" indicators for lessons that took extra effort.
- **Anonymous learner identity** — auto-generated, persisted locally. Ready for future auth.

### Shared across both modes

- **Streaming AI tutor** — structured JSON responses via OpenAI (intent classification, escalating hints, stuckness detection), rendered as rich section cards with tone-based styling, interactive follow-up chips, and clickable `file:line` references.
- **Per-mode session state** — switching between editor and lessons preserves each context's chat history, project files, and run output in memory for the duration of the session.
- **Global settings** — API key, model, and persona configured from a single modal accessible on every page.
- **BYOK** — key held in-memory by default, `localStorage` only behind explicit opt-in. Sent per request, never stored server-side.
- **Persona slider** — beginner / intermediate / advanced reshapes vocabulary and explanation density.
- **Stuckness escalation** — repeated failed runs or "I'm stuck" in prose unlocks stronger hints and concrete next steps — but never the full fix.
- **Long-conversation compression** — background summarize round-trip replaces old history once it crosses a soft cap.
- **Selection-aware asks** — highlight code to attach it as context; `Cmd+K` / `Ctrl+K` jumps focus to the composer.
- **Token/cost tracking** — per-turn chip plus running session total with USD estimate.

---

## Prerequisites

**Git** and **Docker Desktop**. That's it — everything else runs inside Docker.

- **Git** — [download](https://git-scm.com/downloads) (on macOS: `xcode-select --install`)
- **Docker Desktop** — [download](https://www.docker.com/products/docker-desktop/). Make sure it's **running** before you start.

Optional: an **OpenAI API key** ([get one](https://platform.openai.com/api-keys)) for the AI tutor. The editor and Run button work without one.

### System requirements

- ~4 GB free RAM while the stack is running
- ~2 GB disk for Docker images (first build only)
- Internet for first build. After that, only the AI tutor needs internet.

---

## Getting Started

### macOS / Linux

```bash
git clone https://github.com/msrivas-7/CodeTutor-AI.git
cd codetutor-ai
./start.sh
```

First launch builds Docker images (~2-3 min). After that, `./start.sh` takes ~10 seconds. Stop with `./stop.sh`.

### Windows

```powershell
git clone https://github.com/msrivas-7/CodeTutor-AI.git
cd codetutor-ai
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Stop with `.\stop.ps1`.

### Direct Docker Compose

```bash
docker compose up --build    # start (Ctrl-C to stop)
docker compose down           # teardown
```

### Quick start table

| | macOS / Linux | Windows |
| --- | --- | --- |
| **Start** | `./start.sh` | `powershell -ExecutionPolicy Bypass -File .\start.ps1` |
| **Stop**  | `./stop.sh`  | `.\stop.ps1` |

---

## Using It

Open **http://localhost:5173**. First-time visitors see a **welcome overlay** introducing the platform — click "Start Learning Python" to jump straight into the guided course, or "I'll explore on my own" to dismiss. After that, you land on the **Start page** with two cards:

### Editor mode

- Pick a language, edit files, hit **Run** (`Cmd+Enter`). Output streams into the bottom panel.
- Open the tutor panel on the right — ask about your code, get structured hints.
- Highlight code and press `Cmd+K` to ask about a specific selection.

### Guided Learning mode

- Click **Guided Course** from the start page to see your dashboard with progress, recent activity, and next-up recommendations. Open **Python Fundamentals**.
- **First time?** A spotlight tour walks you through the workspace — instructions panel, editor, run button, output, check solution, and tutor. Takes about a minute, shown once.
- Pick a lesson. Read the instructions on the left, write code in the center, run it, and click **Check Solution**. Contextual nudges in the instructions panel guide you if you get stuck or aren't sure what to do next.
- The tutor panel on the right knows your lesson context — ask it for help and it will guide you without spoiling the answer. Use the hint ladder for progressive help, or click **Explain Error** when your code fails.
- Your progress (completions, code, run counts) persists in the browser. Use **Reset Lesson** to start a lesson fresh, or **Reset Course** from the course overview to clear all progress.

### Settings

Click the **gear icon** in the header bar (visible on every page) to configure your OpenAI API key, model, and experience level.

---

## Architecture

```
                           ┌────────────────────────────────────────────┐
                           │           Docker Desktop (host)            │
                           │                                            │
┌──────────────────┐  HTTP/JSON  ┌──────────────────┐  docker.sock  ┌──────────────────┐
│     Frontend     │ ──────────> │     Backend      │ ────────────> │  Runner (1:1)    │
│                  │             │                  │   (sibling)   │                  │
│  React + Vite    │             │  Express + TS    │               │  Python, Node,   │
│  React Router    │ <────────── │  dockerode       │ <──────────── │  gcc, JDK, Go,   │
│  Monaco + Zustand│   SSE/JSON  │  prompt builders │   stdout/err  │  Rust, Ruby      │
│  Tailwind CSS    │             │  OpenAI proxy    │               │  --network none  │
└──────────────────┘             └──────────────────┘               └──────────────────┘
      :5173                            :4000                    bind: ./temp/sessions/{id}
```

### Frontend

- **React Router** — `/` (start page), `/editor`, `/learn`, `/learn/course/:id`, `/learn/course/:id/lesson/:id`. Lazy-loaded pages with Suspense.
- **6 Zustand stores** — `projectStore` (files/editor, per-context switching), `aiStore` (tutor/history, per-context switching), `sessionStore` (backend session), `runStore` (execution, per-context switching), `progressStore` (lesson progress in localStorage), `learnerStore` (anonymous identity).
- **Shared tutor rendering** — `TutorResponseViews.tsx` provides section cards, badges, walkthrough steps, interactive check questions, citations, action chips, and error views. Used by both `AssistantPanel` (editor) and `GuidedTutorPanel` (lessons).
- **Course content** — static JSON + Markdown in `frontend/public/courses/`. Loaded at runtime via fetch. No build step for content authoring.

### Backend

- **Sibling-container pattern** — the backend spawns isolated runner containers via the host Docker daemon. Cross-platform host-path discovery via Docker API self-inspection.
- **Modular prompt pipeline** — `prompts/` directory with separate modules for core rules, stuck detection, persona, situation building, context rendering, schema, and summarization. Two prompt builders assemble from these modules:
  - `editorPromptBuilder` — free-form editor tutor
  - `guidedPromptBuilder` — adds lesson context block with objectives, concept scope, and "never solve" constraints
- **Structured JSON responses** — OpenAI Responses API with strict `json_schema`. Intent classification (`debug`/`concept`/`howto`/`walkthrough`/`checkin`) drives which sections get filled.
- **Provider abstraction** — prompt building and API calls sit behind a `Provider` interface. When `lessonContext` is present in the request, the guided prompt builder is used automatically.

### Guided Learning System

- **File-based courses** — `frontend/public/courses/{courseId}/lessons/{lessonId}/` containing `lesson.json` (metadata, objectives, completion rules), `content.md` (instructions), and `starter/` (initial files).
- **Client-side validation** — `expected_stdout` (output comparison) and `required_file_contains` (code content checks). Runs against the latest `RunResult` without a backend round-trip. Completion triggers confetti, a recap panel, and practice prompts.
- **localStorage persistence** — versioned keys (`learner:v1:progress:{courseId}`, `learner:v1:lesson:{courseId}:{lessonId}`). Course/lesson status, timestamps, attempt/run/hint counts, code snapshots, and last output. Lesson code is restored from localStorage on return; editor-mode files are session-scoped only (in-memory). Progress can be reset per-lesson or per-course.
- **Atomic state mutations** — all progress counters (run count, hint count, attempt count) use Zustand's `set()` callback for race-condition-free read-modify-write, with automatic localStorage fallback for hydration.
- **Repository abstraction** — `LearningRepository` interface with `LocalLearningRepository` (localStorage) and `RemoteLearningRepository` (stub) for future backend persistence.
- **Coach rail** — `CoachRail` component with a priority-ordered rule engine. Observes elapsed time, edit/run/check state, and failed attempt count to surface one contextual nudge at a time. Purely deterministic — no AI or API calls.
- **Workspace onboarding** — `WorkspaceCoach` spotlight overlay using `box-shadow` cutouts. Steps through 6 key UI areas with positioned `CoachBubble` tooltips. Persisted via localStorage flag; auto-skips steps whose target ref is null (e.g., collapsed panel).
- **Editor onboarding** — `EditorCoach` spotlight overlay with 6 steps covering language picker, file tree, editor, run button, output panel, and tutor. Same pattern as `WorkspaceCoach`. Persisted via `onboarding:v1:editor-done`.
- **Welcome spotlight** — `WelcomeOverlay` 3-step spotlight on the start page: header intro, editor card, guided course card. Uses shared `CoachBubble` component with `box-shadow` cutouts. Persisted via `onboarding:v1:welcome-done`.

### API Surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/session` | Create session + runner container |
| `POST` | `/api/session/ping` | Heartbeat |
| `POST` | `/api/session/rebind` | Reuse same ID after expiry |
| `POST` | `/api/session/end` | Destroy session + container |
| `POST` | `/api/project/snapshot` | Write project into workspace |
| `POST` | `/api/execute` | Compile (if needed) and run |
| `POST` | `/api/ai/validate-key` | Check an OpenAI key |
| `GET`  | `/api/ai/models` | List chat-capable models |
| `POST` | `/api/ai/ask/stream` | Tutor turn (SSE stream, supports `lessonContext`) |
| `POST` | `/api/ai/ask` | Tutor turn (non-streaming) |
| `POST` | `/api/ai/summarize` | Compress older history |

### Security Note

The Docker socket mount gives the backend root-equivalent access to the local daemon — fine for local use, **not** suitable for public deployment without further sandboxing.

---

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

## Configuration

All optional — defaults work for local use. See [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_IDLE_TIMEOUT_MS` | `120000` | Reap idle sessions after this |
| `SESSION_SWEEP_INTERVAL_MS` | `45000` | Sweeper interval |
| `RUN_TIMEOUT_MS` | `10000` | Wall-clock per `docker exec` |
| `RUNNER_MEMORY_BYTES` | `536870912` | Per-container memory (512 MB) |
| `RUNNER_NANO_CPUS` | `1000000000` | Per-container CPU (1 CPU) |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend origin |

## Development

```bash
# Local install for type-checks / hot-reload
(cd frontend && npm install)
(cd backend  && npm install)

# Type-check
(cd frontend && npx tsc --noEmit)
(cd backend  && npx tsc --noEmit)

# Tests
(cd frontend && npm test)
(cd backend  && npm test)

# Frontend only (backend in Docker)
docker compose up -d backend
cd frontend && npm run dev
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Cannot connect to the Docker daemon" | Docker Desktop isn't running. Open it and wait for the icon to settle. |
| "Bind mount failed" (Windows) | Docker Desktop > Settings > Resources > File Sharing > enable your drive. |
| Port 4000/5173 in use | Stop the other process, or remap ports in `docker-compose.yml`. |
| "running scripts is disabled" (Windows) | Use the full command: `powershell -ExecutionPolicy Bypass -File .\start.ps1` |
| First build is slow | Expected (~2-3 min). Subsequent launches use cache (~10s). |
| Nothing at localhost:5173 | Give it 10s for the Vite dev server to warm up. |

## License

MIT — see [LICENSE](LICENSE).
