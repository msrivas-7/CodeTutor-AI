# Architecture

```
                           +-------------------------------------------------------+
                           |                  Docker Desktop (host)                |
                           |                                                       |
+------------------+  HTTP/JSON  +------------------+  tcp:2375   +---------------+
|     Frontend     | ----------> |     Backend      | ----------> |  socket-proxy |
|                  |             |                  |  allowlist  |  (tecnativa)  |
|  React + Vite    |             |  Express + TS    |             |               |
|  React Router    | <---------- |  ExecutionBackend| <---------- |  docker.sock  |
|  Monaco + Zustand|   SSE/JSON  |  (localDocker)   |             |   (read-only) |
|  Tailwind CSS    |             |  prompt builders |             +-------+-------+
+------------------+             |  OpenAI proxy    |                     | CONTAINERS + EXEC + IMAGES
      :5173                      +------------------+                     v
                                        :4000                    +------------------+
                                                                 |  Runner (1:1)    |
                                                                 |  Python, Node,   |
                                                                 |  gcc, JDK, Go,   |
                                                                 |  Rust, Ruby      |
                                                                 |  --network none  |
                                                                 +------------------+
                                                            bind: ./temp/sessions/{id}
```

## ExecutionBackend abstraction

The backend never touches dockerode directly at the call-site layer. `backend/src/services/execution/backends/types.ts` defines an `ExecutionBackend` interface (`createSession`, `exec`, `writeFiles`, `fileExists`, `replaceSnapshot`, `destroy`, …) that returns opaque `SessionHandle` values. Routes and the harness dispatcher accept an injected backend; `backend/src/index.ts` picks the impl at boot via the `EXECUTION_BACKEND` env (factory in `backends/index.ts`).

Today only `LocalDockerBackend` ships. The interface is deliberately shaped so each cloud provider is a single additional file plus one switch case:

| Impl (future) | Provider primitive | IAM scope |
| --- | --- | --- |
| `EcsFargateBackend` | `RunTask` / `StopTask` / `ExecuteCommand` | task-definition ARNs only |
| `AksBackend` | `Job.create` / `Pod.exec` (K8s API) | namespace-scoped ServiceAccount |
| `AciBackend` | `ContainerInstances.create` / `exec` | resource-group-scoped Azure role |

A second impl does not change routes, the harness, or session-manager code.

## Local-dev cloud-IAM mirror (socket-proxy)

To stop the backend from holding the raw Docker socket (which equals root on the host), `docker-compose.yml` runs `tecnativa/docker-socket-proxy` as a sidecar. The backend has `DOCKER_HOST=tcp://socket-proxy:2375`; dockerode honors that transparently. The proxy enforces an endpoint allowlist matching what `LocalDockerBackend` actually calls:

- `CONTAINERS=1` — create/start/stop/inspect/remove + self-inspect for host-path discovery
- `EXEC=1` — exec create/start/inspect for running learner code
- `IMAGES=1` — runner-image inspect in `ensureReady()`
- `POST=1` — required for any non-GET request

Everything else (`VOLUMES`, `NETWORKS`, `INFO`, `BUILD`, `SERVICES`, `SECRETS`, `CONFIGS`, …) returns `403` at the proxy. This is the same "tightly-scoped API credential" pattern the cloud impls above will use — local dev now mirrors that posture exactly.

## Frontend

- **React Router** — `/`, `/editor`, `/learn`, `/learn/course/:id`, `/learn/course/:id/lesson/:id`. Lazy-loaded with Suspense.
- **Zustand stores** — `projectStore`, `aiStore`, `sessionStore`, `runStore`, `preferencesStore`, `storageStore`, and `progressStore` (under `features/learning/stores/`). Editor + lesson contexts swap the first four in lockstep; `preferencesStore` is the single source of truth for every per-user preference (persona, OpenAI model, theme, onboarding flags, `uiLayout` bucket for panel widths). `useAIStatus` is a hook-level cache around `/api/user/ai-status`, subscribed by the tutor surfaces to show remaining-questions + source chips.
- **Server-backed per-user state** — preferences, progress, editor project, and BYOK ciphertext all live in Supabase Postgres (tables `user_preferences`, `course_progress`, `lesson_progress`, `editor_project`). Every store hydrates via `GET /api/user/…` on sign-in and mutates through optimistic in-memory writes + background `PATCH/PUT` — no localStorage bucket for progress or preferences. Sign-out clears the in-memory stores; nothing durable is ever written to `localStorage`.
- **Shared tutor rendering** — `TutorResponseViews.tsx` is the single rendering surface for the tutor, reused by both the editor (`AssistantPanel`) and lessons (`GuidedTutorPanel`).
- **Course content** — static JSON + Markdown in `frontend/public/courses/`. Loaded at runtime via fetch — no build step for authoring.
- **Theme system** — `ThemePref` lives on `user_preferences.theme` and is read via `usePreferencesStore` → `data-theme` + `color-scheme` on `<html>`. Semantic Tailwind tokens resolve to CSS variables, so the app (Monaco included) swaps in lockstep.

## Backend

- **Sibling-container pattern** — the backend spawns isolated runner containers via `LocalDockerBackend`. Cross-platform host-path discovery via Docker API self-inspection. Dockerode calls are routed through `socket-proxy` — see [ExecutionBackend abstraction](#executionbackend-abstraction) above.
- **Modular prompt pipeline** — composable modules under `prompts/` assembled by two builders: `editorPromptBuilder` (free-form) and `guidedPromptBuilder` (adds lesson context + "never solve" constraints). The guided builder is selected automatically when a request carries `lessonContext`.
- **Structured JSON responses** — OpenAI Responses API with strict `json_schema`. An intent classifier (`debug`/`concept`/`howto`/`walkthrough`/`checkin`) decides which sections get filled.
- **Provider abstraction** — prompt building and API calls sit behind a `Provider` interface so the LLM vendor is swappable without touching callers.
- **AI credential resolver** — `resolveAICredential` in `services/ai/credential.ts` is the single gate every AI route calls before touching OpenAI. It resolves `byok | platform | none` in that order, applies the operator-funded tier's caps and kill-switch, and returns the key the downstream provider will use. Platform callers are restricted to a server-side model allowlist. Usage is metered row-by-row into `ai_usage_ledger` on every call; a small set of Prometheus counters track request outcomes for alerting.

## Guided Learning System

- **File-based courses** — `frontend/public/courses/{courseId}/lessons/{lessonId}/` with `lesson.json`, `content.md`, and `starter/`.
- **Completion rules** — three kinds: `expected_stdout`, `required_file_contains`, `function_tests`. The first two validate client-side against the latest `RunResult`; `function_tests` round-trips through the backend.
- **Progress persistence** — `course_progress` + `lesson_progress` rows in Postgres, scoped by `auth.users(id)` FK with `ON DELETE CASCADE`. `LearningRepository` wraps the fetch/patch calls so callers treat progress as a synchronous in-memory read against the Zustand snapshot; writes are optimistic + fire-and-forget, and a hydrate on sign-in reconciles. No localStorage bucket.
- **Coach rail** — priority-ordered deterministic rule engine that surfaces one contextual nudge at a time. No AI, no API calls.
- **Practice mode** — exercises attach to a lesson but are tracked independently of lesson completion; entering practice swaps the starter, exiting restores the lesson snapshot.
- **Function-test harness** — lessons can declare visible + hidden test cases. `POST /api/execute/tests` generates a per-run harness that loads learner code and evaluates each test in an isolated scope using the language's literal parser for `expected`. Hidden test names/inputs never leave the backend; an author-tagged `category` string is revealed only after two consecutive fails on the same hidden test.
- **Per-language harness layer** — `HarnessBackend { language, prepareFiles, execCommand }` + a `language → HarnessBackend` registry is the extension seam. New languages plug in without changing route or validator code. `content-lint` consults the same registry so authoring a `function_tests` block for an unsupported language fails at author-time, and each language carries an authoring-order floor below which `function_tests` is rejected.
- **Harness trust model (subprocess + HMAC envelope)** — learner code runs in a child subprocess spawned by the harness, never in the harness's own interpreter. The backend generates a per-run 256-bit nonce, passes it via `HARNESS_NONCE` in the exec env, and the harness scrubs that env var before spawning any user subprocess. The harness reads the test specs into memory and `unlink`s `__codetutor_tests.json` on startup — by the time user code runs, the expected values are not on disk and not in the child's env. The child receives only `{setup, call}` via argv; expected values stay with the parent harness. The harness emits a sentinel-wrapped `base64(JSON.stringify({body, sig}))` envelope where `sig = HMAC-SHA256(nonce, body)`. `runHarness.ts` verifies the signature with `timingSafeEqual`; any missing, malformed, or forged envelope → generic "Test run failed" (fail-closed, no signal back to cheating learner). Fake-pass and hidden-test leakage are both blocked by the same isolation: user code cannot read the nonce, cannot read the tests file, and cannot forge a valid envelope.
- **Dev surfaces (DEV-only, tree-shaken)** — `frontend/src/__dev__/ContentHealthPage.tsx` renders a per-lesson authoring dashboard at `/dev/content`, gated on `import.meta.env.DEV` so it tree-shakes out of production bundles. Scenario-specific starting states are exercised by seeded Supabase users on the dev project (see `backend/scripts/seed-dev-users.ts` + the gitignored `.dev-users.md`) rather than any client-side profile switcher.

## Content Validation Pipeline

The `frontend/public/courses/` tree is plain JSON + Markdown + per-language starter code, but three layers keep it honest:

- **Zod schema** — one set of schemas shared between the TypeScript types and the runtime validator so compile-time and runtime agree on a single source of truth.
- **Concept graph** — each lesson declares `teachesConceptTags` and `usesConceptTags`. A graph-walker flags used-before-taught, overlap, and duplicate-teach issues. The accumulated vocabulary feeds the guided prompt so the tutor knows which concepts are in scope.
- **Content lint** — Zod validation plus structural invariants (id parity, order contiguity, prereq ordering, per-language `function_tests` literal-parse + authoring-order floor). CI-gated.
- **Golden solutions + verify-solutions** — every lesson and practice exercise has a committed correct solution; the verifier runs each through the same engine production uses. Verification runs `python3`/`node` directly rather than the runner sandbox — the trust boundary sits around learner code, not our own. CI-gated.
- **Authoring CLIs** — `new-lesson` and `new-practice` scaffold from templates, update `course.lessonOrder`, and auto-run the lint. See [CONTENT_AUTHORING.md](./CONTENT_AUTHORING.md).

## Testing

Three layers, each catching a different class of bug:

- **Unit tests (`frontend`/`backend`, Vitest)** — pure functions, store reducers, prompt builders, validators, per-language harness generators (Python + JavaScript). Run on every commit. No network, no Docker.
- **Content validation (`npm run lint:content` + `verify:solutions`)** — see the pipeline section above. Keeps course JSON honest and every golden solution passing against the same engine production uses.
- **End-to-end (`e2e/`, Playwright)** — drives the real product: Vite dev server + Dockerized backend + runner container + real localStorage. Catches UI-integration regressions unit tests miss (Monaco focus, modal portals, SSE streaming, Zustand hydration, router navigation). Chromium-only, ~100 specs covering editor / guided-learning / function-tests / dev-profiles / progress-I/O / tutor / onboarding / coach-rail / settings / practice / js / security. OpenAI is mocked by default; `E2E_REAL_OPENAI=1` enables an opt-in real-key suite for release-gate smoke. Starting states come from the same seed JSONs the dev-profile switcher uses. CI job: `.github/workflows/e2e.yml`.

## API Surface

Every route requires `Authorization: Bearer <supabase-access-token>` — `authMiddleware` verifies it via JWKS and attaches `req.userId` downstream. The only routes outside that gate are the health probes (`/api/health`, `/api/health/deep`) and `/api/metrics` (loopback-only unless `METRICS_TOKEN` is set, in which case it takes a Bearer token scoped to the scraper — not the user JWT).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/api/health` | Liveness probe — always `{ok:true}` |
| `GET`  | `/api/health/deep` | Readiness probe — exercises Postgres + docker socket-proxy; 503 on either failure. Also returns `platformAuth: "ok" \| "failed"` so alerts can distinguish "backend is dead" from "free tier is paused on a bad key" without flipping to 503 |
| `POST` | `/api/admin/unstick-platform-auth` | Operator break-glass after rotating `PLATFORM_OPENAI_API_KEY`. Clears the provider-auth kill flag set by a 401 on `/api/ai/ask`; gated by `METRICS_TOKEN` (or loopback if unset). Auto-clears after 30 min otherwise |
| `GET`  | `/api/metrics` | Prometheus exposition (loopback-only by default; Bearer-gated when `METRICS_TOKEN` is set) |
| `POST` | `/api/session` | Create session + runner container (owner = `req.userId`). Returns `backendBootId` — a per-process `nanoid` the frontend caches so a later 404 can be diagnosed as "individual session reaped" vs "whole process restarted" |
| `POST` | `/api/session/ping` | Heartbeat — 404 for "not found" and "not yours" (privacy). 404 body carries `backendBootId` so the frontend can detect a process restart and show a replaced-session modal instead of storming rebind |
| `POST` | `/api/session/rebind` | Reuse same ID after expiry — 403 on owner mismatch. Returns `backendBootId` refresh |
| `POST` | `/api/session/end` | Destroy session + container — 403 on owner mismatch |
| `POST` | `/api/project/snapshot` | Write project into workspace |
| `POST` | `/api/execute` | Compile (if needed) and run |
| `POST` | `/api/execute/tests` | Run a lesson's `function_tests` harness and return a `TestReport` |
| `POST` | `/api/ai/validate-key` | Check an OpenAI key (authed + rate-limited; no provider calls for the public) |
| `GET`  | `/api/ai/models` | List chat-capable models (BYOK only) |
| `POST` | `/api/ai/ask/stream` | Tutor turn (SSE stream, supports `lessonContext`) — routed through `resolveAICredential` |
| `POST` | `/api/ai/ask` | Tutor turn (non-streaming) — routed through `resolveAICredential` |
| `POST` | `/api/ai/summarize` | Compress older history (metered for $, NOT counted against the visible 30/day quota) |
| `GET`  | `/api/user/preferences` | Hydrate `preferencesStore` (persona, theme, openai model, onboarding flags, uiLayout) |
| `PATCH`| `/api/user/preferences` | Optimistic write for any preference subset |
| `PUT`  | `/api/user/openai-key` | Store a BYOK OpenAI key (AES-256-GCM at rest, per-row nonce) |
| `DELETE`| `/api/user/openai-key` | Forget the stored BYOK key |
| `GET`  | `/api/user/courses` | List course-level progress rows |
| `PATCH`| `/api/user/courses/:courseId` | Upsert course-level progress |
| `DELETE`| `/api/user/courses/:courseId` | Drop a course and all its lesson rows (cascade) |
| `GET`  | `/api/user/lessons[?courseId=…]` | List lesson-level progress |
| `PATCH`| `/api/user/lessons/:courseId/:lessonId` | Upsert lesson-level progress (code snapshots, counters, practice state) |
| `GET`  | `/api/user/editor-project` | Read the persisted editor project (files, active file, tabs, stdin) |
| `PUT`  | `/api/user/editor-project` | Replace the persisted editor project |
| `DELETE`| `/api/user/account` | Self-service wipe — email-confirm; tears down live runners + cascades public.* rows |
| `GET`  | `/api/user/ai-status` | Source (byok / platform / none), remaining questions, reset time, paid-interest flag |
| `POST` | `/api/user/ai-exhaustion-click` | Telemetry counter — `dismissed` / `clicked_byok` / `clicked_paid_interest` |
| `POST` | `/api/user/paid-access-interest` | User signals willingness-to-pay; flagged if denylisted-at-click |
| `DELETE`| `/api/user/paid-access-interest` | User withdraws the paid-interest signal |
| `POST` | `/api/feedback` | Bug / idea / other + optional mood; opt-in diagnostics cap ≤8 KB |

## Project Layout

```
codetutor-ai/
├── backend/                 Express + TypeScript
│   └── src/
│       ├── routes/          session, project, execution, executeTests, ai, aiStatus, userData, feedback, metrics
│       ├── middleware/      authMiddleware, csrfGuard, bodyLimit, requestId, requestLogger, rate limits, errorHandler
│       ├── db/              Postgres clients for preferences, progress, editor project, usage ledger, denylist, paid-access, feedback
│       ├── services/
│       │   ├── ai/          Provider, prompt builders, credential resolver, pricing, metrics counters, prompts/ modules
│       │   ├── execution/
│       │   │   ├── backends/  ExecutionBackend interface + LocalDocker impl (cloud impls slot in here)
│       │   │   └── harness/   Per-language function-tests harness registry (Python + JavaScript today)
│       │   └── session/     sessionManager, requireActiveSession, sweeper
│       └── scripts/         seed-dev-users.ts (codetutor-dev starting states)
├── frontend/                React + Vite + Tailwind
│   ├── public/courses/      Course content (JSON + Markdown + starter + golden solutions)
│   ├── scripts/             content-lint, verify-solutions, new-lesson, new-practice
│   └── src/
│       ├── api/             client.ts — typed fetch wrappers, Bearer attach, global 401 handler
│       ├── auth/            supabaseClient, generation token, HydrationGate
│       ├── components/      Shared UI (Monaco, tutor views, settings, splitters)
│       ├── features/learning/
│       │   ├── pages/       Dashboard, CourseOverview, LessonPage
│       │   ├── components/  GuidedTutorPanel, LessonInstructions, CoachRail, WorkspaceCoach, etc.
│       │   ├── content/     Zod schema, conceptGraph, courseLoader
│       │   ├── stores/      progressStore (server-backed, optimistic)
│       │   ├── repositories/ LearningRepository interface + implementations
│       │   └── utils/       Lesson validator
│       ├── __dev__/         ContentHealthPage only — profile switcher retired with localStorage removal
│       ├── pages/           StartPage, EditorPage
│       └── state/           projectStore, aiStore, sessionStore, runStore, preferencesStore, storageStore, useAIStatus
├── runner-image/            Polyglot Dockerfile (Python, Node+tsx, GCC, G++, JDK, Go, Rust, Ruby)
├── samples/                 Starter projects per language
├── infra/azure/             Bicep for prod VM + KV + SWA + Caddy + monitoring + backups
├── supabase/                Migrations + email templates for the two cloud projects
├── e2e/                     Playwright specs + fixtures + seed JSONs
├── docker-compose.yml       socket-proxy sidecar + backend + runner + (dev-only) frontend
├── start.sh / stop.sh       macOS/Linux launcher
└── start.ps1 / stop.ps1     Windows launcher
```

## Shipping posture

The product ships as a hosted SaaS at **[codetutor.msrivas.com](https://codetutor.msrivas.com)**. Frontend is served by Azure Static Web Apps at the custom domain; backend + runner sandbox run on an Azure VM in the prod resource group, fronted by Caddy with Let's Encrypt TLS. Auth + data live in a dedicated prod Supabase cloud project. All runtime secrets sit in an Azure Key Vault and are delivered to the VM under its system-assigned managed identity — nothing sensitive lives on disk in the repo, and rotation is a single KV write + env-refresh. Images are hosted on GHCR and rolled out by CI via OIDC. See `infra/azure/` for the Bicep templates and operator runbook.

The backend never holds the raw Docker socket; it talks to `socket-proxy` over TCP (dockerode via `DOCKER_HOST`), and the proxy enforces an API allowlist. `ExecutionBackend` is the seam future cloud-runner impls (ACI / ECS Fargate / AKS) drop into without touching routes or session code — the current posture runs the runner pool on the same VM but can split out horizontally when concurrent sessions grow past single-host capacity.

**Operator-funded tutor allowance** — signed-in learners without a BYOK key get a bounded daily quota of tutor questions on an operator-held OpenAI key, limited to a single approved model. Every AI route runs through `resolveAICredential`, which applies per-user and global spend caps, a manual denylist, a burst rate-limit, and a nuclear kill-switch before the downstream provider call. Usage is metered per-call into `ai_usage_ledger`. Specific cap values, rotation commands, and the operator runbook live in a private ops doc, not the repo.

## Security posture

Defense-in-depth on top of the `ExecutionBackend` + socket-proxy seam. The table below names each control and the cloud primitive it maps to — a port to a managed runner (Fargate / AKS / ACI) lands as configuration, not refactor work.

### Sandbox (runner containers)

| Area | Local impl | Cloud equivalent |
| --- | --- | --- |
| Non-root execution | Runner image has a dedicated non-root user; backend spawns containers as that user | `runAsNonRoot: true` + numeric `runAsUser` |
| Kernel capabilities | `CapDrop: ["ALL"]` on every runner container | `capabilities.drop: ["ALL"]` |
| Privilege escalation | `SecurityOpt: ["no-new-privileges"]` | `allowPrivilegeEscalation: false` |
| Filesystem isolation | `ReadonlyRootfs` + tmpfs `/tmp`; compiler cache dirs redirected into it via env | `readOnlyRootFilesystem` + emptyDir `medium: Memory` volume |
| Network egress | `NetworkMode: "none"` on every runner | NetworkPolicy `egress: []` / VPC-isolated subnet |
| Resource exhaustion | Per-container `PidsLimit`, `NanoCpus`, `Memory`, `Ulimits.nofile`; fork-bomb protection is cgroup-scoped via `PidsLimit` | Resource requests/limits + `hostPID: false` |
| Concurrency budget | Per-user + global ceilings on concurrent runner containers (429 with `Retry-After` when exceeded); semaphore on in-flight `docker exec` calls keeps interactive latency stable under load | Same ceilings; semaphore becomes a worker-pool knob on the runner control plane |
| Workspace symlink writes | `writeFiles` opens with `O_NOFOLLOW \| O_EXCL \| O_CREAT` after `lstat`-walking every parent; `replaceSnapshot` uses `withFileTypes` + explicit `unlink` for symlinks before recursive delete | Host filesystem goes away under a cloud runner backend |
| Filename→flag injection | `./`-prefixed compiler globs; `safeResolve` rejects dash-prefixed path segments | Same impl |
| Host API surface | `socket-proxy` allowlist: CONTAINERS / EXEC / IMAGES / POST. Everything else 403s | IAM role scoped to RunTask/StopTask/ExecuteCommand (Fargate) or Job.create/Pod.exec (K8s) |

### Application & API

| Area | Control |
| --- | --- |
| Auth | Supabase Auth (GoTrue). Backend verifies access tokens via JWKS with `jose.createRemoteJWKSet` and attaches `req.userId` from `sub`. Asymmetric — no shared secret. Frontend wraps every non-public route in `<RequireAuth>`; `api/client.ts` attaches `Bearer` on every call; global 401 → signOut + redirect to `/login`. |
| Session ownership | Every routed handler that takes `sessionId` goes through `requireOwnedSession(id, req.userId)`. `/ping` returns 404 for both "not found" and "not yours" (no ownership oracle); `/rebind` + `/end` return 403. |
| Rate limiting | `express-rate-limit` on `/api/ai/*`, `/api/session*`, `/api/project/snapshot`, `/api/execute*`, keyed per-user. Session-create keeps an IP floor alongside the user bucket so account-churn can't bypass it. |
| CSRF | Every mutating route requires `X-Requested-With: codetutor` (forces CORS preflight) **plus** an `Origin` that matches `config.corsOrigin` — blocks cross-origin POSTs from pages the learner happens to visit. |
| HTTP headers | `helmet()` with a strict CSP. |
| Error leakage | 500 fallback returns `{error: "Internal error"}`; full stack logged server-side only. |
| LAN exposure | Ports bound to `127.0.0.1` only. |

### Tutor & AI surface

| Area | Control |
| --- | --- |
| Credential resolution | `resolveAICredential` is the single gate every AI route traverses. Resolves BYOK first, then operator-funded tier (if enabled), applies per-user and global spend caps + a manual denylist + a nuclear kill-switch, and returns the key the downstream provider will use. |
| Model allowlist | Operator-funded calls are restricted to a server-side `PLATFORM_ALLOWED_MODELS` allowlist — BYOK callers are not. |
| Prompt injection | Untrusted content wrapped in `<user_file>` / `<user_selection>` tags so the tutor prompt classifies it as data, not instructions. Path attribute is XML-escaped and the Zod schema restricts paths to `^[A-Za-z0-9._/-]+$`. |
| Request logging | `/api/project/snapshot` and `/api/execute*` bodies redact to shape-only (file count, stdin length, test count); `/api/ai/*` prompts redact to length + intent. Full prompts are gated behind `DEBUG_PROMPTS=1` — left unset in prod. |
| Output bounding | Server-side `max_output_tokens` bounds per-call size so a single request cannot burn an outsized chunk of the spend budget. |

### Harness (function-tests)

| Area | Control |
| --- | --- |
| Subprocess isolation | Learner code runs in a child subprocess spawned by the harness, never in the harness interpreter itself. |
| HMAC envelope | Per-run 256-bit nonce; harness emits a sentinel-wrapped envelope with `HMAC-SHA256(nonce, body)`; `runHarness.ts` verifies with `timingSafeEqual`. Missing, malformed, or forged envelopes fail closed — no signal back to cheating learners. |
| Nonce secrecy | Nonce handed to the harness via stdin only; harness drains stdin to EOF before spawning user code so `/proc/<ppid>/environ` can't leak it. |
| Tests-file isolation | Harness reads expected values into memory and `unlink`s the tests file on startup; by the time user code runs, expectations are neither on disk nor in the child's env. |
| JS driver sandbox | `vm.createContext` with a minimal globals set (no `require`, `process`, `Buffer`, `module`). This is a module loader, *not* a security boundary — the runner container is. |

### Secrets & data at rest

| Area | Control |
| --- | --- |
| Secrets management | All runtime secrets in Azure Key Vault, delivered to the VM under the system-assigned managed identity via a refresh script. Nothing sensitive committed to the repo; `.env.example` siblings document shape only. |
| BYOK encryption | User OpenAI keys encrypted at rest with AES-256-GCM envelope encryption, per-row random nonce, master key sourced from KV. Rotating the master key invalidates every stored BYOK row (users re-enter theirs). |
| process.env scrubbing | Sensitive values are read into the frozen `config` object at boot, then deleted from `process.env` so a later `console.log(process.env)` or accidental env-dump finds nothing. |
| Metrics endpoint | `/api/metrics` is loopback-only by default; when a scraper token is configured it requires a Bearer header. Unauthenticated exposure was a BI leak (live session count + per-model token totals) and a DoS-pressure oracle. |
| Account deletion | `DELETE /api/user/account` is email-confirmed, tears down live runner containers, and cascades `public.*` rows via FK `ON DELETE CASCADE` before `supabase.auth.admin.deleteUser`. Fails closed if the admin path is unavailable. |

---

<sub>Copyright &copy; 2026 Mehul Srivastava. All rights reserved. See [LICENSE](../LICENSE).</sub>
