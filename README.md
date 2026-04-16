# AI Code Editor

A local-first, web-based coding editor with an AI tutor. Write small single- or multi-file projects in the browser, run them in a sandboxed Docker runtime, and get structured, hint-style help from OpenAI using your own API key.

![Stack](https://img.shields.io/badge/stack-React%20%7C%20Vite%20%7C%20Monaco%20%7C%20Express%20%7C%20Docker-0f172a)
![Languages](https://img.shields.io/badge/languages-Python%20%7C%20JS%20%7C%20TS%20%7C%20C%20%7C%20C%2B%2B%20%7C%20Java%20%7C%20Go%20%7C%20Rust%20%7C%20Ruby-38bdf8)
![License](https://img.shields.io/badge/license-MIT-34d399)

## Features

### Write — *editor and workspace*

- **Monaco editor** — same engine as VS Code; custom dark theme, bracket-pair colorization, JetBrains Mono ligatures, tab strip with middle-click close.
- **Three-pane workspace** — draggable splitters (double-click to reset), collapsible files and tutor rails, Zustand-backed layout state.
- **Nine starter projects** — Python, JavaScript, TypeScript, C, C++, Java, Go, Rust, Ruby; each multi-file so imports/includes/modules are exercised from turn one.
- **Clickable refs** — any `file.ext:line[:col]` in tutor prose or stderr becomes a button that reveals the position via Monaco's `revealLineInCenter`.

### Run — *sandboxed Docker execution*

- **One container per session** — spawned lazily on first Run, reaped after 2 min of heartbeat silence or immediately on tab close via `pagehide` + `navigator.sendBeacon`.
- **Tight sandbox** — `--network none`, 512 MB memory, 1 vCPU, PID cap, non-root user, `no-new-privileges`, 10 s wall-clock on every `docker exec`.
- **Durable workspace** — files live on the host at `./temp/sessions/{id}`; each Run re-snapshots from the frontend, so backend restarts never lose student code.
- **Classified output** — stdout, stderr, exit code, duration, and an error type (`compile` / `runtime` / `timeout` / `system`) surfaced as colored pills.
- **Stdin support** — dedicated tab pre-seeded with each starter's sample input, so the first Run always produces real output.

### Learn — *streaming OpenAI tutor*

- **Structured JSON** — Responses API with a strict flat `json_schema`; model classifies intent (`debug` / `concept` / `howto` / `walkthrough` / `checkin`) and fills only the relevant sections.
- **SSE streaming** — summary → explanation → example → hint → next-step paint as they arrive; a **Stop** button cancels mid-stream and commits the partial response.
- **Rich per-turn context** — active file marker, project snapshot (4 k-char cap per file), last run result, history slice, diff of edits since last turn, run/edit counters, persona, and optional editor selection.
- **Stuckness escalation** — `stuckness: low | medium | high` signal plus client activity (repeated failed runs, "I'm stuck" in prose) unlocks a stronger hint and a concrete next step — but never the full fix.
- **Persona slider** — beginner / intermediate / advanced reshapes vocabulary, assumed background, and explanation density every turn.
- **Long-conversation compression** — background summarize round-trip replaces old history once it crosses a soft cap, without blocking the current ask.

### Stay in flow — *ergonomics and resilience*

- **Selection-aware asks** — highlighting code auto-attaches it (with a live preview chip); `⌘K` / `Ctrl+K` pulls focus to the composer carrying the current selection.
- **Tokens and cost** — per-turn chip plus a running session total; USD estimate via longest-prefix match against published per-1M rates, with a tokens-only fallback for unknown models.
- **One-click asks** — "Walk me through this" (tab strip), "Why did my last run fail?" (output panel on error), contextual follow-ups after each turn.
- **BYOK** — key held in-memory by default, `localStorage` only behind an explicit opt-in; sent as `X-OpenAI-Key` per request; never logged, never persisted.
- **Resilient sessions** — silent heartbeat retries, `Reconnecting…` status, and rebind-to-same-ID recovery when the backend blinks.

## Prerequisites

You need **Git** and **Docker Desktop** installed. That's it — everything else (Node, Python, compilers) runs inside Docker containers and is set up automatically on first launch.

- **Git** — [download](https://git-scm.com/downloads). On macOS, `git` is also installed when you run `xcode-select --install`.
- **Docker Desktop** — [download](https://www.docker.com/products/docker-desktop/). Free for personal use. Available for macOS, Windows, and Linux.
  - Make sure Docker Desktop is **running** before you start. You should see a whale icon in your menu bar (macOS) or system tray (Windows).

Optional: an **OpenAI API key** ([get one here](https://platform.openai.com/api-keys)) if you want the AI tutor. The editor and Run button work without a key; only the right-hand tutor panel requires one.

### System requirements

- ~4 GB free RAM while the stack is running.
- ~2 GB disk for the Docker images (first-time build only).
- Internet connection for the first build (to pull base images). After that, works offline for editing and running code. Only the AI tutor needs internet.

## First-time setup

Pick your OS. Each section is self-contained — you don't need to read the others.

### macOS

1. **Install Docker Desktop** from the link above. Open it. Wait until the whale icon in your menu bar stops animating (means the daemon is running).
2. **Open Terminal** (press `⌘ + Space`, type "Terminal", hit Enter).
3. **Clone the repo** and enter the folder:
   ```bash
   git clone https://github.com/msrivas-7/ai-code-editor.git
   cd ai-code-editor
   ```
4. **Launch:**
   ```bash
   ./start.sh
   ```
5. The first launch will build the Docker images — this takes **2–3 minutes** and is only slow the first time. You'll see three Terminal windows open (backend logs, frontend logs, session runners) and your browser will open to **http://localhost:5173**. That's the editor.

To stop everything: `./stop.sh`. To start it again later: `./start.sh` (subsequent launches take ~10 seconds since the images are already built).

### Linux

Same as macOS, but install Docker Desktop for Linux (or `docker.io` / `docker-ce` + `docker-compose-plugin` from your distro). Make sure your user is in the `docker` group so you don't need `sudo`:
```bash
sudo usermod -aG docker $USER
# log out and back in for this to take effect
```
Then follow macOS steps 3–5. On Linux, `start.sh` doesn't auto-open log windows (that's macOS-specific); you can tail logs manually with `docker compose logs -f backend` if needed.

### Windows

1. **Install Docker Desktop** from the link above. During install, leave "Use WSL 2 instead of Hyper-V" checked (the default). Reboot if asked.
2. **Start Docker Desktop.** Wait until the whale icon in your system tray stops animating.
3. **Enable file sharing for your drive.** Open Docker Desktop → **Settings** (gear icon) → **Resources** → **File Sharing**. Make sure the drive you'll clone into (usually `C:`) is checked. Click **Apply & Restart** if you changed anything.
4. **Open PowerShell.** Press `Windows key`, type "PowerShell", hit Enter. (Any PowerShell window is fine — no need for "Admin".)
5. **Clone the repo** and enter the folder:
   ```powershell
   git clone https://github.com/msrivas-7/ai-code-editor.git
   cd ai-code-editor
   ```
6. **Launch:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start.ps1
   ```
   (The `-ExecutionPolicy Bypass` bit is because Windows blocks unsigned scripts by default. This only bypasses the policy for this one command — it doesn't change any system setting.)
7. First launch builds the images — **2–3 minutes**. Three PowerShell windows will open for logs and your browser will open to **http://localhost:5173**.

To stop: `.\stop.ps1`. To start again: re-run the launch command in step 6.

## Quick start (after first-time setup)

Once everything is installed, day-to-day use is just:

| | macOS / Linux | Windows |
| --- | --- | --- |
| **Start** | `./start.sh` | `powershell -ExecutionPolicy Bypass -File .\start.ps1` |
| **Stop**  | `./stop.sh`  | `.\stop.ps1` |

Or, if you'd rather drive Docker Compose directly (works on all three OSes):

```bash
docker compose up --build    # start (foreground; Ctrl-C to stop)
docker compose down           # stop
```

## Troubleshooting

**"Cannot connect to the Docker daemon" / "docker: command not found"** — Docker Desktop isn't running, or isn't installed. Open it and wait for the whale icon to stop animating.

**"Bind mount failed" (Windows)** — Docker Desktop doesn't have permission to the drive your repo is on. Open Docker Desktop → Settings → Resources → File Sharing → enable the drive → Apply & Restart.

**Port 4000 or 5173 already in use** — something else on your machine is using those ports. Stop it, or edit `docker-compose.yml` to map different ports (e.g., change `"5173:5173"` to `"5174:5173"` and open the new port in your browser).

**Windows: "cannot be loaded because running scripts is disabled"** — You ran `.\start.ps1` directly. Use the full command: `powershell -ExecutionPolicy Bypass -File .\start.ps1`.

**Windows: `MAX_PATH` errors on deep workspaces** (rare) — Enable long paths in an Admin PowerShell and reboot:
```powershell
reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f
```

**First build is slow** — Expected (2–3 min). Subsequent launches use the cache and take ~10 seconds. You can watch progress in the Terminal/PowerShell window where you ran `start.sh` / `start.ps1`.

**Nothing happens when I open http://localhost:5173** — Give it another 10 seconds; the frontend dev server takes a moment to warm up on first launch. Check the frontend log window for any errors.

## Using it

Open <http://localhost:5173>. The editor seeds with a starter project for the selected language.

### Edit and run

- Edit any file, hit **Run** (`⌘↵` / `Ctrl+Enter`). Stdout, stderr, exit code, duration, and error classification stream into the output panel.
- Switch to the **stdin** tab to edit the input piped to the program on the next Run.
- Switching the language dropdown replaces the project with that language's starter (confirmation prompt so you don't nuke work).

### Use the tutor

- Click the gear in the right sidebar → paste an OpenAI key → validate → pick a model and persona (beginner / intermediate / advanced).
- Type a question in the tutor panel — **Enter** sends, **Shift+Enter** inserts a newline.
- Highlight code in the editor to auto-attach it as context — a preview chip above the composer shows exactly what will be sent. `⌘K` / `Ctrl+K` jumps focus to the composer from the editor.
- Responses stream section-by-section (summary → explanation → example → hint → next step). Click **Stop** to cancel and keep the partial answer.
- The tutor starts with diagnostic questions; follow-ups add hints. When it flags you as stuck (based on your prose + activity signals like repeated failed runs), it unlocks a stronger pointer and a concrete next step.
- `file.ext:line` references in the response jump the editor there on click.
- Each turn shows a token/cost chip; a session total lives in the header.
- One-click action chips — "Walk me through this" (tab strip), "Why did my last run fail?" (output panel on error) — fire asks directly, no typing needed.

## Architecture

```
                           ┌────────────────────────────────────────────┐
                           │           Docker Desktop (host)            │
                           │                                            │
┌──────────────────┐  HTTP/JSON  ┌──────────────────┐  docker.sock  ┌──────────────────┐
│     Frontend     │ ──────────> │     Backend      │ ────────────> │  Runner (1:1)    │
│                  │             │                  │   (sibling)   │                  │
│  React + Vite    │             │  Express + TS    │               │  Python, Node,   │
│  Monaco editor   │ <────────── │  dockerode       │ <──────────── │  gcc, JDK, Go,   │
│  Zustand stores  │   SSE/JSON  │  OpenAI proxy    │   stdout/err  │  Rust, Ruby      │
│  Tailwind CSS    │             │  prompt builder  │               │  --network none  │
└──────────────────┘             └──────────────────┘               └──────────────────┘
      :5173                            :4000                    bind: ./temp/sessions/{id}
                                  host path resolved
                                  via Docker self-inspect
```

### Frontend — React + Vite + Monaco + Zustand

- **Zustand-only state** — project files, session phase, AI history, and layout all live in Zustand stores. No Redux, no prop drilling.
- **Monaco integration** — loaded via `@monaco-editor/react`; keybindings, selection capture, and `revealLineInCenter` linkification use the `IStandaloneCodeEditor` API directly.
- **Client-side session lifecycle** — heartbeat pings every 30s, `pagehide` + `navigator.sendBeacon` for tab-close cleanup, rebind-to-same-ID recovery on backend restart.

### Backend — Express + TypeScript + dockerode

- **Sibling-container pattern.** The backend doesn't run code itself — it asks the host Docker daemon (via `/var/run/docker.sock`) to spawn isolated runner containers, one per session.
- **Cross-platform host-path discovery.** At startup, the backend self-inspects its own container via the Docker API to learn the host-side mount source for `/workspace-root`. Same code works on macOS, Linux, and Windows Docker Desktop without per-OS branching.
- **Dual-path session model.** Each `SessionRecord` stores `workspacePath` (backend-internal Linux path for `fs.*` I/O) and `hostWorkspacePath` (host-format path for Docker `Binds`). Separator detection reads the root string — not `process.platform`, since the backend always runs on Linux regardless of host OS.

### Runner container — polyglot sandbox

- **Single Docker image** (`runner-image/Dockerfile`) with all nine language toolchains. Built once at first launch by a one-shot Compose service.
- **Two-phase execution.** Compiled languages (C, C++, Java, Go, Rust) get a compile step first; failure is classified as `compile` and skips the run. Interpreted languages go straight to run.

### AI tutor — prompt pipeline + structured streaming

- **Prompt builder.** Each turn assembles: active file marker, full project snapshot (4 k-char cap per file), last run result, conversation history slice, diff of files changed since last turn, run/edit counters, persona level, and optional editor selection. Context is capped to stay within model limits.
- **Structured JSON response.** Uses the OpenAI Responses API with a strict flat `json_schema`. The model classifies intent (`debug` / `concept` / `howto` / `walkthrough` / `checkin`) and fills only the relevant sections — not a free-form string.
- **Stuckness signal.** The prompt injects `stuckness: low | medium | high` computed from client activity (repeated failed runs, "I'm stuck" in prose). Higher stuckness unlocks a stronger hint and concrete next step in the schema — but never the full solution.
- **SSE streaming.** The backend proxies OpenAI's SSE stream to the frontend. The frontend paints sections incrementally (summary → explanation → example → hint → next step). An `AbortController` threads through the fetch — the **Stop** button aborts mid-stream and commits the partial response so nothing is lost.
- **Summarize-and-continue.** When conversation history crosses a soft token cap, a background round-trip compresses older turns into a short narrative, then splices it back in — no blocking of the current ask.
- **Provider abstraction.** Prompt building, response parsing, and API calls sit behind a `Provider` interface. Only OpenAI is implemented; swapping in another provider doesn't touch routes or prompt code.
- **BYOK flow.** The frontend sends the OpenAI key per-request via `X-OpenAI-Key`. The backend forwards it to OpenAI and discards it — never logged, never persisted.

### API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/session` | Create a session + runner container |
| `POST` | `/api/session/ping` | Heartbeat |
| `POST` | `/api/session/rebind` | Reuse the same ID after expiry |
| `POST` | `/api/session/end` | Destroy session + container |
| `POST` | `/api/project/snapshot` | Write the full project into the workspace |
| `POST` | `/api/execute` | Compile (if needed) and run |
| `POST` | `/api/ai/validate-key` | Check an OpenAI key |
| `GET`  | `/api/ai/models` | List chat-capable models for the key |
| `POST` | `/api/ai/ask/stream` | Tutor turn (SSE stream of structured JSON sections) |
| `POST` | `/api/ai/ask` | Tutor turn (non-streaming; same schema) |
| `POST` | `/api/ai/summarize` | Compress older history into a short narrative for long conversations |

### Security note

The Docker socket mount gives the backend root-equivalent access to the local daemon — fine for local use, **not** suitable for public deployment without further sandboxing (rootless Docker, a dedicated runner service, or a job queue).

## Project layout

```
ai-code-editor/
├── backend/             Express + TypeScript (sessions, Docker, execution, AI)
├── frontend/            React + Vite + Tailwind + Zustand + Monaco
├── runner-image/        Polyglot Dockerfile (Python, Node, gcc/g++, JDK, Go, Rust, Ruby, tsx)
├── shared/              TS types shared across backend + frontend
├── samples/             Starter projects per language
├── scripts/             Helper scripts (watch-sessions.sh / .ps1)
├── temp/sessions/       Runtime per-session workspaces (gitignored)
├── docker-compose.yml
├── start.sh  / stop.sh  macOS/Linux launcher + teardown
├── start.ps1 / stop.ps1 Windows launcher + teardown
└── .env.example
```

## Configuration

All variables are optional — defaults work for local use. See [.env.example](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_IDLE_TIMEOUT_MS` | `120000` | Reap sessions idle longer than this |
| `SESSION_SWEEP_INTERVAL_MS` | `45000` | Sweeper interval |
| `RUN_TIMEOUT_MS` | `10000` | Hard wall-clock per `docker exec` |
| `RUNNER_MEMORY_BYTES` | `536870912` | Per-container memory cap (512 MB) |
| `RUNNER_NANO_CPUS` | `1000000000` | Per-container CPU cap (1 CPU) |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend origin |

## Development

Running the full stack via `./start.sh` or `docker compose up` needs no host-side installs — the Dockerfiles handle `npm ci` and system packages inside the images. Only install locally if you want to iterate outside Docker (type-checks, hot-reload frontend against a containerized backend, etc.):

```bash
# One-time host-side install for local iteration
(cd frontend && npm install)
(cd backend  && npm install)

# Type-check without running the stack
(cd frontend && npx tsc --noEmit)
(cd backend  && npx tsc --noEmit)

# Run unit tests (vitest / node:test)
(cd frontend && npm test)
(cd backend  && npm test)

# Iterate on the frontend only (backend in Docker)
docker compose up -d backend
cd frontend && npm run dev

# Rebuild just the backend after backend changes
docker compose build backend && docker compose up -d --no-deps backend
```

## License

MIT — see [LICENSE](LICENSE).
