# Development

Internal developer reference for running CodeTutor AI locally. The hosted product lives at [codetutor.msrivas.com](https://codetutor.msrivas.com); this doc is about the dev loop that feeds it.

## First-time setup (auth stack)

The project uses **Supabase cloud** for auth + Postgres — no local Supabase CLI install, no local stack to boot. There are two Supabase projects on one cloud account: `codetutor-dev` (dev + CI/E2E) and `codetutor-prod` (production). Real credentials are gitignored; committed `.example` files document the shape.

Credentials for `codetutor-dev` are held by the project owner. The production project (`codetutor-prod`) is only reachable from the CI deploy pipeline and the VM's managed-identity-sourced Key Vault — never populate a local env file with prod keys.

**Populate env files on disk (all gitignored):**

```bash
cp .env.example                       .env                              # docker compose + host-run playwright both read this
cp frontend/.env.development.example  frontend/.env.development.local   # host-run Vite (cd frontend && npm run dev)
# For prod builds only:
cp .env.production.example            .env.production
cp frontend/.env.production.example   frontend/.env.production.local
```

Fill in the real values from the credential bundle. Root `.env` is the single source of truth for local dev — docker compose auto-loads it, and Playwright's dotenv in `e2e/playwright.config.ts` points at the same file.

## Local Setup

```bash
# Install dependencies for type-checks / hot-reload
(cd frontend && npm install)
(cd backend  && npm install)

# Type-check
(cd frontend && npx tsc --noEmit)
(cd backend  && npx tsc --noEmit)

# Unit tests
(cd frontend && npm test)
(cd backend  && npm test)

# Content validation (frontend)
(cd frontend && npm run lint:content)       # schema + structural + concept graph
(cd frontend && npm run verify:solutions)   # runs every golden solution against its completion rules

# End-to-end tests (Playwright, mocked OpenAI; see e2e/README.md)
# Uses codetutor-dev cloud — the auth fixture admin-creates per-worker
# test users via the service_role key from .env.
docker compose up -d
(cd e2e && npm install && npx playwright install --with-deps chromium && npm test)

# Frontend only (backend in Docker)
docker compose up -d backend
cd frontend && npm run dev
```

## Dev test users (manual QA)

Replacement for the old `__dev__/profiles.ts` localStorage seeder — now that state lives in Postgres, the equivalent is a handful of real Supabase users on `codetutor-dev`, each seeded to a different progress state (fresh, mid-course, stuck, capstone-stuck, all-complete). Sign in with any of them through the normal `/login` form.

```bash
cd backend
ALLOW_DEV_SEED=yes npm run seed:dev-users
```

Idempotent — re-run anytime to reset a drifted user. Credentials list (email/password/scenario) lives in the gitignored `.dev-users.md` at the repo root. Script source: [backend/scripts/seed-dev-users.ts](../backend/scripts/seed-dev-users.ts).

## Authoring lessons

See [CONTENT_AUTHORING.md](./CONTENT_AUTHORING.md) for the full guide. Quick reference:

```bash
# Scaffold a new lesson
(cd frontend && npm run new:lesson -- \
  --course python-fundamentals \
  --id my-lesson \
  --title "My lesson" \
  --description "One-line pitch." \
  --minutes 15 \
  --prereq previous-lesson)

# Add a practice exercise to an existing lesson
(cd frontend && npm run new:practice -- \
  --course python-fundamentals \
  --lesson my-lesson \
  --id my-exercise \
  --title "Exercise title" \
  --prompt "Learner-facing prompt" \
  --goal "What this reinforces" \
  --rule-style function)     # or stdout | file
```

Both scaffolders run `npm run lint:content` at the end — expect a few warnings on a fresh scaffold while you fill in objectives, concept tags, and completion rules.

CI runs `lint:content` and `verify:solutions` on every push. The `solutions-pass` job depends on `content-lint` and uses `python3` directly (no Docker), so it completes in ~15 seconds.

## Dev-only content health dashboard

When the frontend is running in dev mode (`npm run dev`), visit **http://localhost:5173/dev/content** for a per-lesson overview: order / rules summary / teaches + uses concept counts / content + solution presence / concept-graph issues. The route is gated on `import.meta.env.DEV` and tree-shaken out of production bundles.

## Configuration

All optional — defaults work for local use. See [.env.example](../.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_IDLE_TIMEOUT_MS` | `120000` | Reap idle sessions after this |
| `SESSION_SWEEP_INTERVAL_MS` | `45000` | Sweeper interval |
| `RUN_TIMEOUT_MS` | `10000` | Wall-clock per `docker exec` |
| `RUNNER_MEMORY_BYTES` | `536870912` | Per-container memory (512 MB) |
| `RUNNER_NANO_CPUS` | `1000000000` | Per-container CPU (1 CPU) |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend origin |
| `EXECUTION_BACKEND` | `local-docker` | Execution backend impl (future: cloud variants) |
| `DOCKER_HOST` | `tcp://socket-proxy:2375` | Docker endpoint — set by compose so dockerode talks to the allowlisted socket proxy, not the raw socket |
| `AI_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window for `/api/ai/*` |
| `AI_RATE_LIMIT_MAX` | `60` | Max AI requests per window per `user:<id>` (authenticated) or `sid\|ip` (public) bucket |
| `SESSION_CREATE_RATE_LIMIT_WINDOW_MS` | `60000` | Window for `/api/session*` per-user bucket |
| `SESSION_CREATE_RATE_LIMIT_MAX` | `30` | Max session lifecycle calls per window per user (IP floor prevents account-churn bypass) |
| `MUTATION_RATE_LIMIT_WINDOW_MS` | `60000` | Window for `/api/project/snapshot` + `/api/execute*` per-user bucket |
| `MUTATION_RATE_LIMIT_MAX` | `120` | Max mutation calls per window per user |
| `SUPABASE_URL` | **required** | Supabase API root — `https://<project-ref>.supabase.co`. Same value for backend (env) and browser (VITE_SUPABASE_URL). |
| `VITE_SUPABASE_URL` | **required** | Browser-side Supabase URL. In dev, docker-compose surfaces it as a runtime env var on the frontend service (sourced from the root `.env`) and Vite picks it up into `import.meta.env`. For prod, `vite build` inlines it from the build env. |
| `VITE_SUPABASE_ANON_KEY` | **required** | Public `sb_publishable_...` key from the Supabase project's API settings. Browser-safe; committed `.example` carries placeholder only. |
| `SUPABASE_SERVICE_ROLE_KEY` | **required for E2E** | `sb_secret_...` key. The e2e auth helper uses it to admin-create per-worker test users. **Never** set in prod; the backend only verifies tokens, it has no need for the service role. |
| `DATABASE_URL` | **required** | Postgres transaction pooler URL from the Supabase project's database settings (port 6543). The backend sets `prepare: false` on the postgres.js pool because the transaction pooler recycles connections between transactions and does not support prepared statements. Pool `max` is 25 per backend replica (see `backend/src/db/client.ts`, adversarial-audit bucket 4a / P-H5). |
| `BYOK_ENCRYPTION_KEY` | **required** | Master key used to encrypt each user's saved OpenAI API key at rest in `user_preferences` (AES-256-GCM envelope, per-row random nonce). 32 bytes, base64-encoded — generate with `openssl rand -base64 32`. Backend refuses to boot without it. Rotating invalidates every stored key; dev and prod MUST use different values. |
| `ENABLE_FREE_TIER` | `0` | When `1`, signed-in learners without a BYOK key fall through to the operator's OpenAI key; when `0`, only BYOK callers reach the tutor. Acts as the nuclear kill-switch. |
| `FREE_TIER_DAILY_QUESTIONS` | see `.env.example` | Per-user daily quota on operator-funded `/api/ai/ask` calls. `/api/ai/summarize` is metered for spend but excluded from this counter. |
| `FREE_TIER_DAILY_USD_PER_USER` | see `.env.example` | Per-user daily spend cap on operator-funded calls. |
| `FREE_TIER_LIFETIME_USD_PER_USER` | see `.env.example` | Per-user lifetime spend cap on operator-funded calls. |
| `FREE_TIER_DAILY_USD_CAP` | see `.env.example` | Global daily spend circuit-breaker across all operator-funded callers. |
| `PLATFORM_OPENAI_API_KEY` | required when `ENABLE_FREE_TIER=1` | Operator's OpenAI key. `assertConfigValid` refuses to boot if the flag is on and this is absent. |
| `AI_REQUEST_TIMEOUT_MS` | `90000` | Deadline for a single `/ask` or `/ask/stream` call; shared between BYOK and operator-funded paths. |
| `MAX_SESSIONS_PER_USER` | see `.env.example` | Ceiling on concurrent runner containers per user. Hitting it returns HTTP 429 with `Retry-After: 2`; a background zombie-reaper frees any dead containers so the next retry (after 2 s) typically succeeds (see adversarial-audit bucket 4a / P-M3). |
| `MAX_SESSIONS_GLOBAL` | see `.env.example` | Global ceiling on concurrent runner containers, sized to the VM's RAM budget. |
| `DOCKER_EXEC_CONCURRENCY` | see `.env.example` | Semaphore on concurrent `docker exec` calls to keep interactive latency stable under load. |
| `METRICS_TOKEN` | unset | When set, `/api/metrics` requires `Authorization: Bearer <token>`. When unset, `/api/metrics` accepts only loopback callers. |
| `DEBUG_PROMPTS` | unset | When `1`, the AI provider logs full system + user turn text. Leave unset; learner code would otherwise reach the backend log. |

## Direct Docker Compose

```bash
docker compose up --build    # start (Ctrl-C to stop)
docker compose down           # teardown
```

## Shared utilities

Reach for these before copy-pasting — each one exists because the same pattern was duplicated across ≥2 call sites.

### Frontend

| Module | What it gives you |
| --- | --- |
| `frontend/src/util/layoutPrefs.ts` | `usePersistedNumber(key, default)` and `usePersistedFlag(key, default)` — drop-in `useState` replacements that read/write `preferencesStore.uiLayout` (debounced `PATCH /api/user/preferences` under the hood — see [preferencesStore.ts:215](../frontend/src/state/preferencesStore.ts#L215)). `clamp(n, [min, max])` + `clampSide(n, [min, max])` for splitter/panel sizing. |
| `frontend/src/util/timings.ts` | Named durations for values shared across files (`COACH_AUTO_OPEN_MS`, `RESUME_TOAST_MS`). Only add here when ≥2 callsites want the same semantic value. |
| `frontend/src/state/preferencesStore.ts` | Single source of truth for per-user preferences (persona, theme, openaiModel, onboarding flags, `uiLayout` bucket, `hasOpenaiKey` flag). Hydrates on sign-in from `GET /api/user/preferences`; `patch(body)` is optimistic-with-rollback. Use `useTheme()`, `usePersona()`, `useUiLayoutValue(path, fallback)`, `setUiLayoutValue(path, v)`, `markOnboardingDone(flag)` rather than reaching into the store directly. |
| `frontend/src/state/useAIStatus.ts` | Module-scoped cache (30 s TTL) around `/api/user/ai-status`. `useAIStatus()` returns `{ status, refetch }`; `invalidateAIStatus()` is the imperative escape hatch for non-React callers (called after BYOK save/forget so the tutor surfaces pick up the new credential source immediately). `notePlatformQuestionConsumed()` is called from `useTutorAsk` after a successful platform ask — it mirrors a local `remainingToday - 1` and broadcasts to subscribers, saving one `/ai-status` round-trip per turn. The 0-crossing case refetches instead, because only the server knows the full exhausted-shape (`source:"none"`, `reason:"free_exhausted"`) that the `ExhaustionCard` gates on. Multi-tab drift is UI-only; the backend ledger is always authoritative, so no cap-bypass is possible. |
| `frontend/src/components/SelectionPreview.tsx` | Shared "selected code context" chip used by the editor and guided tutor panels. |
| `frontend/src/features/learning/stores/progressStore.ts` → `updateLesson(lessonId, patch)` | Merge-patch a lesson's progress record. Prefer this over hand-rolled spreads. |

### Backend

| Module | What it gives you |
| --- | --- |
| `backend/src/services/execution/commands.ts` → `languageSchema` | The canonical `z.enum` over supported languages. Routes that accept a language parameter should import this rather than re-declaring the enum inline. |
| `backend/src/services/session/requireActiveSession.ts` | Route helper: `const session = requireActiveSession(res, sessionId); if (!session) return;`. Handles the 404 / 409 responses and returns a narrowed `ActiveSession` type (`containerId: string`, not `string \| null`) so downstream code reads the field without re-asserting. |
| `backend/src/services/execution/harness/registry.ts` | Per-language harness plug-in point for `function_tests`. Python and JavaScript registered today; new languages add a `HarnessBackend` implementation and register it. The harness runs learner code as a child subprocess and returns results inside an HMAC-signed envelope verified by `runHarness.ts` — see the "Harness trust model" bullet in [ARCHITECTURE.md](./ARCHITECTURE.md#guided-learning-system). |

## Design Tokens

All colors in the frontend use semantic Tailwind tokens, never raw palette names:

| Semantic | Use for |
| --- | --- |
| `bg` / `panel` / `elevated` | Surface layers (page, panel, raised card) |
| `ink` / `muted` / `faint` | Primary / secondary / tertiary text |
| `border` / `borderSoft` | Dividers and outlines |
| `accent` / `accentMuted` | Primary interactive elements (focus rings, CTAs) |
| `success` | Completion, validation pass, "OK" states |
| `warn` | Compile errors, "worth your attention" nudges |
| `danger` | Runtime errors, destructive actions |
| `violet` | Guided learning, practice mode, tutor walkthroughs |

These resolve to CSS variables in [`src/index.css`](../frontend/src/index.css) and switch automatically between dark and light themes. **Do not** use `text-green-400`, `bg-red-500/15`, or any raw `{color}-{shade}` class — always use the semantic token so light-theme and re-theming stay correct.

Contrast floor: all text on `panel` / `bg` meets WCAG AA (4.5:1). If you introduce a new foreground/background combination, check it with a contrast tool before shipping.

## Demoing / manual QA

Per-user state lives in Postgres, so the canonical way to land on a specific progress state is to sign in as one of the pre-seeded `codetutor-dev` users. See the "Dev test users" section at the top of this doc and the gitignored [`.dev-users.md`](../.dev-users.md) for the per-user scenarios.

`backend/scripts/seed-dev-users.ts` is the source of truth. To add a scenario, edit the `SCENARIOS` array in that script and re-run `ALLOW_DEV_SEED=yes npm run seed:dev-users`.

For free-play demos across reloads, sign in as `user2@test.com` (mid-course healthy) or `user5@test.com` (both courses complete) and interact freely — the next seed run resets their state.

The dev-only **content-health dashboard** at `/dev/content` is still live (gated on `import.meta.env.DEV`, tree-shaken from prod). That is the only `__dev__/` surface that survived the Postgres migration.

---

<sub>Copyright &copy; 2026 Mehul Srivastava. All rights reserved. See [LICENSE](../LICENSE).</sub>
