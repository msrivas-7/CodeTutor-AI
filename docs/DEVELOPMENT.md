# Development

This is the working guide for building and validating CodeTutor AI. It favors reproducible commands, the production-shaped local stack, and explicit quality evidence. For system design and trust boundaries, read [Architecture](./ARCHITECTURE.md). For lesson construction, read [Content authoring](./CONTENT_AUTHORING.md).

## Before you change code

CodeTutor AI has independent frontend, backend, and E2E packages; there is no root `package.json`. Run package commands from the owning directory or pass the harness an explicit `--cwd`.

Every feature, fix, migration, refactor, and review-driven change starts with the repository harness described in [`AGENTS.md`](../AGENTS.md):

```bash
git rev-parse --show-toplevel
git status --short --branch

node scripts/agent-harness.mjs start \
  --feature "short description" \
  --scope frontend,backend \
  --findings UX-123
```

Browser-observable work is the default. A UX finding may not bypass actual-browser validation, and a material design or journey change requires the product owner's explicit approval before implementation. See [Agent harness workflow](#agent-harness-workflow) for the finish gates.

This page is the operational summary; [`AGENTS.md`](../AGENTS.md) and the
[agent harness strategy](./AGENT_HARNESS_STRATEGY.md) are normative. Important
alternate paths are explicit rather than inferred:

```bash
# Only when no user-visible browser flow can be affected.
node scripts/agent-harness.mjs start \
  --feature "non-browser change" \
  --scope infra \
  --browser-impact none \
  --browser-bypass "concrete reason"

# Record approval that arrived after the session began.
node scripts/agent-harness.mjs approve-design \
  --session <session-id> \
  --approval "product-owner-approved direction"

# Keep newly discovered findings inside the active evidence boundary.
node scripts/agent-harness.mjs add-findings \
  --session <session-id> \
  --findings UX-124,UX-125
```

## Prerequisites

- Node.js 22 or newer (the SWA function package and CI require it)
- npm with lockfile-aware `npm ci`
- Docker Desktop or another Docker Engine with Compose v2
- Git
- Access to the shared `codetutor-dev` Supabase project for authenticated, database, and E2E work
- Python 3 for Python golden-solution verification

The development and production Supabase projects are separate. Local work, CI, and E2E use `codetutor-dev`; production uses `codetutor-prod`. There is no local Supabase stack.

## First-time setup

### 1. Install package dependencies

```bash
(cd frontend && npm ci)
(cd backend && npm ci)
(cd e2e && npm ci)
(cd swa-api && npm ci)
```

Use `npm install` only when intentionally changing a package dependency and lockfile.

### 2. Create local environment files

```bash
cp .env.example .env
cp frontend/.env.development.example frontend/.env.development.local
```

Both destinations are gitignored. Populate them with the `codetutor-dev` credential bundle. Never copy production credentials into local files.

The root `.env` is the source for Docker Compose and host-run Playwright. Host-run Vite reads `frontend/.env.development.local`.

Important URL distinction:

| Variable | Meaning |
| --- | --- |
| `VITE_BACKEND_URL` | Vite development proxy target. Compose uses `http://backend:4000`; host-run Vite uses `http://localhost:4000`. It is not the production browser API origin. |
| `VITE_API_BASE_URL` | Absolute API origin compiled into a production client. Leave it unset for local same-origin `/api` requests through Vite. Release CI sets the production VM/Caddy URL. |

The browser-safe Supabase URL and publishable key use `VITE_` variables. `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, BYOK encryption keys, and platform provider keys are server-only. The service-role key is required by controlled backend Auth administration and E2E setup in both environments; it must never enter the browser bundle.

### 3. Install a local Playwright browser

```bash
(cd e2e && npx playwright install chromium)
```

`--with-deps` is useful on a fresh Linux/CI host but is not the normal macOS development command.

## Choose a local run loop

### Full-fidelity Compose

Use this for integration work, execution changes, backend changes, and browser evidence:

```bash
docker compose up -d --build
docker compose ps
curl --fail http://localhost:4000/api/health
```

Open [http://localhost:5173](http://localhost:5173).

The stack contains:

- the Vite frontend on `127.0.0.1:5173`;
- the Express API on `127.0.0.1:4000`;
- a prebuilt polyglot runner image;
- an allowlisted Docker socket proxy; and
- ephemeral runner containers created per active coding session.

Source directories are not bind-mounted into the application containers. After changing frontend, backend, runner, or build configuration code, rebuild the affected service before treating browser results as evidence:

```bash
docker compose up -d --build frontend
docker compose up -d --build backend
docker compose up -d --build runner-image backend
```

If the backend container is recreated, restart the Compose frontend as well. Vite's proxy may otherwise retain the old backend container address:

```bash
docker compose restart frontend
```

### Fast frontend loop with Docker backend

Use this for frontend-only iteration when the backend and runner are unchanged:

```bash
docker compose up -d --build backend
(cd frontend && npm run dev)
```

Set `VITE_BACKEND_URL=http://localhost:4000` in `frontend/.env.development.local`. The host Vite server still runs at [http://localhost:5173](http://localhost:5173).

Before final browser evidence, return to the full-fidelity Compose build so the tested artifact matches the branch.

### Stop and inspect

```bash
docker compose logs --tail=200 backend frontend
docker compose down
```

Do not add `-v` unless deleting local Compose volumes is intentional.

## Common validation commands

### Frontend

```bash
(cd frontend && npm run typecheck)
(cd frontend && npm test)
(cd frontend && npm run build)
(cd frontend && npm run lint:content)
(cd frontend && npm run verify:solutions)
```

### Backend

```bash
(cd backend && npm run typecheck)
(cd backend && npm test)
(cd backend && npm run build)
```

### End to end

With the Compose stack healthy:

```bash
(cd e2e && npm test)
(cd e2e && npx playwright test specs/learning.spec.ts --project=chromium --retries=0)
(cd e2e && npm run test:ui)
```

The default E2E suite mocks OpenAI but uses the real application, execution path, and `codetutor-dev` state. Real-provider cases under `e2e/specs/real-api` are opt-in:

```bash
(cd e2e && E2E_REAL_OPENAI=1 npm run test:real)
```

Never print, record, or commit provider keys. See [`e2e/README.md`](../e2e/README.md) for fixtures, test metadata, traces, and flake diagnosis.

## Agent harness workflow

The harness makes repository knowledge and browser proof part of the development cycle rather than optional chat history. Its detailed evidence and promotion rules live in [Agent harness strategy](./AGENT_HARNESS_STRATEGY.md).

### Run validations through the session

```bash
node scripts/agent-harness.mjs run \
  --session <session-id> \
  --scope frontend \
  --cwd frontend \
  -- npm run typecheck
```

If a harnessed command fails, diagnose and resolve the generated incident. Do not rerun until green and forget the original evidence. Reusable, verified failure lessons belong in the harness memory; the strongest outcome is an executable test, lint, type, or CI guard.

### Browser evidence

After each named UX finding is fixed, interact with the actual product using the Browser control skill and record a finding-level audit. Before the phase finishes, repeat the complete slice together against the final rebuilt code:

```bash
node scripts/agent-harness.mjs browser-audit \
  --session <session-id> \
  --level phase \
  --tool "browser control skill" \
  --browser "Codex in-app Browser" \
  --environment local \
  --url "http://localhost:5173/..." \
  --entrypoint "how the user reached the flow" \
  --happy "happy-path result" \
  --failure-recovery "failure and recovery exercised" \
  --adversarial "repeats, interruption, collision, stale state, misuse, and boundaries relevant to this change" \
  --viewports "desktop/mobile and light/dark coverage" \
  --focus "keyboard and resulting focus state" \
  --screenshots ".agent-harness/browser-evidence/<session>/..." \
  --result pass
```

Playwright supports this evidence but does not replace it. A browser audit must cover the actual entry point, happy path, failure and recovery, risk-relevant adversarial interactions, responsive/theme states, and keyboard/focus behavior—not one token interaction.

### Finish

```bash
git add <exact-intended-phase-files>
git diff --cached --stat
git diff --cached --check

node scripts/agent-harness.mjs doctor
node scripts/agent-harness.mjs finish \
  --session <session-id> \
  --summary "what changed" \
  --tests "deterministic and browser evidence"
```

The finish gate fingerprints the staged slice. The tracked pre-commit hook rejects a changed or unfinished staged set. Update the pull request with the phase, user-journey before/now summary, evidence, deployment state, and review resolution; the phase is not complete until CI is green and actionable review threads are resolved.

If a harnessed command or browser audit fails, diagnose it and close the
generated incident with `agent-harness.mjs resolve`; a rerun does not erase the
original failure.

## Dev test users

Development profiles are real users in `codetutor-dev`, seeded to fresh, mid-course, stuck, capstone, and completed scenarios. The source is [`backend/scripts/seed-dev-users.ts`](../backend/scripts/seed-dev-users.ts); credentials and scenario mapping live in gitignored `.dev-users.md`.

```bash
(cd backend && ALLOW_DEV_SEED=yes npm run seed:dev-users)
```

The command is idempotent and intentionally blocked unless `ALLOW_DEV_SEED=yes` is present. It must never target production. E2E creates isolated per-worker identities through its own authenticated fixture rather than sharing these manual accounts.

## Database and migrations

Ordered files in [`supabase/migrations`](../supabase/migrations) are the schema and RLS source of truth. Already-applied migrations are immutable; create a forward migration for every change.

Use the repository-pinned CLI invocation and verify the target before any remote operation:

```bash
npx --yes supabase@2.110.0 projects list
npx --yes supabase@2.110.0 link --project-ref <codetutor-dev-project-ref>
npx --yes supabase@2.110.0 migration list --linked
```

Linking is a one-time fresh-clone step, not permission to mutate the remote
project. Confirm that the selected reference is `codetutor-dev` before every
write and keep production out of local workflows.

Create and validate a database change as an ordered forward migration:

```bash
npx --yes supabase@2.110.0 migration new descriptive_change_name

# Edit the generated SQL, then validate its linked plan without applying it.
npx --yes supabase@2.110.0 db push --dry-run --linked
```

Test the migration and its ownership/denial cases against disposable Postgres
or the approved development integration environment. After review and explicit
approval to update the shared development project, apply and verify it:

```bash
npx --yes supabase@2.110.0 db push --linked
npx --yes supabase@2.110.0 migration list --linked
```

Database changes require:

1. the forward migration;
2. privileges and RLS policies appropriate to each role;
3. backend ownership predicates even when RLS also applies;
4. real Postgres integration evidence for isolation and denial cases; and
5. verified migration state before release promotion.

The backend uses the Supabase transaction pooler and disables prepared statements because pooled connections are recycled. User-scoped helpers may enter an authenticated RLS context for defense in depth; privileged administration stays server-side and explicit.

## Authoring lessons

Read [Content authoring](./CONTENT_AUTHORING.md) before changing course material. Public learner content lives under `frontend/public/courses`; protected scoring or pre-answer material must stay in backend-only content paths.

```bash
(cd frontend && npm run new:lesson -- \
  --course python-fundamentals \
  --id my-lesson \
  --title "My lesson" \
  --description "One-line pitch." \
  --minutes 15 \
  --prereq previous-lesson)

(cd frontend && npm run new:practice -- \
  --course python-fundamentals \
  --lesson my-lesson \
  --id my-exercise \
  --title "Exercise title" \
  --prompt "Learner-facing prompt" \
  --goal "What this reinforces" \
  --rule-style function)
```

Then run both content gates:

```bash
(cd frontend && npm run lint:content)
(cd frontend && npm run verify:solutions)
```

The generated `frontend/public/courses/registry.json` is a cache, not authored content, and is ignored. In Vite development mode, `/dev/content` provides the content-health dashboard; it is removed from production builds.

## Configuration guide

Use [`.env.example`](../.env.example) and [`.env.production.example`](../.env.production.example) as the variable inventories. The categories matter more than memorizing individual names:

| Category | Notes |
| --- | --- |
| Frontend public config | Supabase project URL/publishable key, local proxy target, production API base, build SHA. Anything prefixed `VITE_` can enter the client bundle. |
| Database and Auth administration | `DATABASE_URL`, Supabase service key, JWT/JWKS settings. Server only. |
| Execution | runner image, time/resource limits, session caps, Docker proxy, local/ACI/hybrid controls. |
| Tutor and usage | BYOK encryption keyring, platform provider key, model routing, quotas, reservations, timeouts, kill switches. |
| Shares and email | preview HMAC rotation, share switches, ACS connection, unsubscribe signing. |
| Operations | metrics token, Azure targets, Key Vault/managed identity, alert and budget thresholds. |

Backend configuration is validated in [`backend/src/config.ts`](../backend/src/config.ts), frozen at startup, and sensitive values are removed from `process.env` afterward. New settings need a safe default or an explicit boot-time requirement, an example-file entry, and tests for invalid combinations.

## Shared implementation seams

Use the existing abstraction before creating another version of the same behavior.

### Frontend shared seams

| Module | Use it for |
| --- | --- |
| [`frontend/src/api/client.ts`](../frontend/src/api/client.ts) | Authenticated API requests, refresh retry, cancellation, and consistent error behavior |
| [`frontend/src/state/preferencesStore.ts`](../frontend/src/state/preferencesStore.ts) | Durable preferences, theme, persona, layout, onboarding, and optimistic rollback |
| [`frontend/src/util/layoutPrefs.ts`](../frontend/src/util/layoutPrefs.ts) | Persisted panel sizing/flags and shared clamping |
| [`frontend/src/state/useAIStatus.ts`](../frontend/src/state/useAIStatus.ts) | Cached tutor access/quota presentation and invalidation |
| [`frontend/src/util/useTutorAsk.ts`](../frontend/src/util/useTutorAsk.ts) | Shared tutor request and streaming lifecycle |
| [`frontend/src/components/TutorResponseViews.tsx`](../frontend/src/components/TutorResponseViews.tsx) | Structured tutor-response rendering across workspace modes |
| [`frontend/src/components/SelectionPreview.tsx`](../frontend/src/components/SelectionPreview.tsx) | Shared selected-code context presentation |

### Backend shared seams

| Module | Use it for |
| --- | --- |
| [`backend/src/services/session/requireActiveSession.ts`](../backend/src/services/session/requireActiveSession.ts) | Owned active-session validation and narrowed session types |
| [`backend/src/services/execution/commands.ts`](../backend/src/services/execution/commands.ts) | Canonical language and execution command definitions |
| [`backend/src/services/execution/backends`](../backend/src/services/execution/backends) | Local, ACI, and hybrid execution implementations |
| [`backend/src/services/execution/harness/registry.ts`](../backend/src/services/execution/harness/registry.ts) | Language-specific protected function-test harness registration |
| [`backend/src/services/ai/canonicalTutorContext.ts`](../backend/src/services/ai/canonicalTutorContext.ts) | Server-authoritative guided tutor context |
| [`backend/src/db/aiReservations.ts`](../backend/src/db/aiReservations.ts) | Atomic platform AI admission and settlement |

Frontend color and surface styling uses semantic Tailwind tokens (`bg`, `panel`, `elevated`, `ink`, `muted`, `border`, `accent`, `success`, `warn`, `danger`, `violet`) backed by CSS variables in [`frontend/src/index.css`](../frontend/src/index.css). Do not introduce raw palette shades into product components; semantic tokens preserve contrast across light and dark themes.

## CI and release gates

The repository's workflow files are the source of truth:

- [CI](../.github/workflows/ci.yml) runs release-contract checks, harness doctor, secret scanning, cross-platform builds/tests, content and solution gates, share-function tests, performance budgets, and shell/PowerShell validation.
- [E2E](../.github/workflows/e2e.yml) runs exhaustive Chromium in six balanced shards with two workers each, an advisory metadata-owned critical shadow, and focused Firefox/WebKit journeys.
- [Security](../.github/workflows/security.yml) runs isolated execution and abuse scenarios on relevant pull requests, on schedule, and as a release-callable gate.
- [Production release](../.github/workflows/release.yml) builds immutable candidate artifacts, invokes the validation workflows against those artifacts, verifies migration state, then promotes the VM and Static Web App surfaces.

A single flaky E2E shard may be rerun once after preserving its trace and logs. If the same shard repeats the failure, treat it as a product, isolation, or test defect; do not weaken the assertion or rerun the full matrix blindly.

AI teaching changes additionally require deterministic safety coverage and the complete model evaluation gate. Focused eval cases are iteration tools and cannot establish model eligibility.

### Production rollback

Production rollback is an explicit operator workflow, not a local Git reset.
Run [`rollback-release.yml`](../.github/workflows/rollback-release.yml) with:

- the run ID of a successful **Production release**;
- the full lowercase candidate Git SHA recorded by that run; and
- the exact acknowledgement `ROLLBACK_PRODUCTION`.

The workflow proves that run and SHA match, verifies the retained immutable
candidate manifest, promotes its recorded backend and runner digests plus its
SWA bundle, and then checks backend readiness and deployed frontend identity.
Preserve the workflow evidence when diagnosing an incident.

This process does not reverse Postgres migrations. Every production migration
must be backward compatible with the previous application version, or recovery
must use a reviewed forward compensating migration.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `localhost:5173` is unavailable | `docker compose ps`, then rebuild/start `frontend`; confirm port 5173 is free. |
| Frontend returns API 502 after backend rebuild | `curl http://localhost:4000/api/health`, then `docker compose restart frontend` to refresh the Vite proxy target. |
| Browser shows old code | Rebuild the changed service and verify the live container contains the changed asset before testing. Playwright reachability does not rebuild containers. |
| Backend is running but marked unhealthy | Probe `/api/health`, not `/health`; inspect backend logs and required configuration. |
| Auth works but product requests fail | Confirm both local env files target the same `codetutor-dev` project and the browser token is reaching `/api`. |
| Database integration tests skip | A skip is not integration evidence. Load the gitignored development environment without printing it and verify the linked dev project. |
| Monaco or browser test flakes | Use the shared Monaco fixture, retain the trace/video, rerun only the affected shard once, and classify repeated failures. |
| Node behavior differs inside a harness composite | Use a non-login shell, check `node --version`, and keep package `--cwd` explicit. |
| ACI does not activate locally | Expected unless the flag and complete Azure target configuration are present; the factory falls back to local-only mode. |

## Manual QA entry points

- Product: [http://localhost:5173](http://localhost:5173)
- Backend readiness: [http://localhost:4000/api/health](http://localhost:4000/api/health)
- Content health in Vite development: [http://localhost:5173/dev/content](http://localhost:5173/dev/content)
- Progress scenarios: seed and sign in with the documented `codetutor-dev` users
- Free editor: `/editor`
- First guided lesson: `/learn/course/python-fundamentals/lesson/hello-world`
- Anonymous trial: `/try/lesson/python-fundamentals/hello-world`

Manual QA is not complete because a page loaded. Exercise entry, success, failure/recovery, interruption, stale state, responsive layout, both themes, keyboard focus, and the adjacent surfaces the change could affect. Record the result through the harness before committing.

---

<sub>Copyright &copy; 2026 Mehul Srivastava. All rights reserved. See [LICENSE](../LICENSE).</sub>
