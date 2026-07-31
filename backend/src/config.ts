const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

function parseIntEnv(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

// Phase 26 (audit M-1): collect every BYOK master-key version from env
// into a single Map<version, base64-string>. The format `BYOK_ENCRYPTION_KEY_VN`
// (case-sensitive, N a positive integer) is the canonical shape. The
// legacy `BYOK_ENCRYPTION_KEY` (no version suffix) is treated as V1 if
// `BYOK_ENCRYPTION_KEY_V1` isn't set — backward-compat for existing
// single-key deployments. Validation of base64 + 32-byte length happens
// inside assertConfigValid; here we just collect what's present.
function collectByokEncryptionKeys(): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  const versioned = /^BYOK_ENCRYPTION_KEY_V(\d+)$/;
  for (const [key, value] of Object.entries(process.env)) {
    const m = versioned.exec(key);
    if (!m || !value) continue;
    const version = Number(m[1]);
    if (!Number.isInteger(version) || version <= 0) continue;
    out.set(version, value);
  }
  // Legacy fallback: BYOK_ENCRYPTION_KEY (no suffix) → V1, only if V1
  // wasn't already populated by the explicit shape.
  const legacy = process.env.BYOK_ENCRYPTION_KEY;
  if (legacy && !out.has(1)) {
    out.set(1, legacy);
  }
  return out;
}

export const config = {
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Which ExecutionBackend implementation to load. Only "local-docker" is
  // implemented today; cloud variants ("ecs-fargate", "aks", "aci") are the
  // future drop-in slots — see services/execution/backends/index.ts.
  executionBackend: process.env.EXECUTION_BACKEND ?? "local-docker",

  runnerImage: process.env.RUNNER_IMAGE ?? "codetutor-ai-runner:latest",

  // Backend-internal path where per-session workspaces live (always a Linux
  // path because the backend runs inside a Linux container on every host).
  // The corresponding HOST path is discovered at startup by self-inspecting
  // the backend container — see resolveHostWorkspaceRoot() in
  // services/execution/backends/localDocker.ts. Keeping these two paths
  // separate is what lets the same code run on macOS, Linux, and Windows hosts.
  workspaceRoot: process.env.WORKSPACE_ROOT ?? "/workspace-root",

  // Escape hatch for bare-metal dev (running the backend directly on a host
  // OS, outside docker compose). When set, overrides self-inspect discovery.
  // Leave unset in the normal compose flow.
  hostWorkspaceRootOverride: process.env.WORKSPACE_ROOT_HOST,

  session: {
    idleTimeoutMs: num(process.env.SESSION_IDLE_TIMEOUT_MS, 2 * 60 * 1000),
    sweepIntervalMs: num(process.env.SESSION_SWEEP_INTERVAL_MS, 45 * 1000),
    // Phase 20-P3: session caps. One abusive tab-spammer can otherwise
    // saturate the host (~512 MB runners × N > host RAM). Per-user ceiling
    // keeps any single account from monopolizing capacity; global ceiling
    // bounds total exposure. Both emit 429 with Retry-After so the frontend
    // can show a friendly message.
    //
    // Phase 23: maxGlobal lowered 20 → 14 (B2ms 8 GB) to match physical RAM.
    // Phase 24B-resize: lowered 14 → 5 for B2s (4 GB host). Math:
    //   4 GB - ~600 MB OS - 1 GB backend container - ~150 MB Docker daemon
    //   - ~150 MB socket-proxy + Caddy ≈ 2.1 GB available for runners
    //   2.1 GB ÷ ~350 MB peak per runner (256 MB hard cap + compile spikes
    //   for rust/java) ≈ 6 sessions; cap at 5 for safety headroom.
    // ACI overflow (Phase 24B) absorbs the 6th+ session via burst spawn —
    // no UX regression vs the old 14 since per-IP usage rarely exceeded
    // 4-5 concurrent sessions before launch traffic. Raise proportionally
    // when upgrading SKU (B2s → 5, B2ms → 14, B4ms → 28, B8ms → 60).
    maxPerUser: num(process.env.MAX_SESSIONS_PER_USER, 2),
    maxGlobal: num(process.env.MAX_SESSIONS_GLOBAL, 5),
  },

  // Phase 20-P3: semaphore on concurrent `docker exec` calls. Each exec
  // spikes CPU + filesystem IO, and dockerode doesn't queue under load —
  // it happily fires N parallel execs that all stall on the socket. Capping
  // in-flight execs at a value below B2s CPU limits keeps interactive
  // latency stable when many sessions are running tests simultaneously.
  dockerExecConcurrency: num(process.env.DOCKER_EXEC_CONCURRENCY, 8),

  runner: {
    memoryBytes: num(process.env.RUNNER_MEMORY_BYTES, 512 * 1024 * 1024),
    nanoCpus: num(process.env.RUNNER_NANO_CPUS, 1_000_000_000),
    execTimeoutMs: num(process.env.RUN_TIMEOUT_MS, 10_000),
  },

  // AI-route throttle. Applied per session id, IP-fallback for pre-session
  // endpoints. Defaults: 60 requests per rolling minute — plenty for
  // interactive learner use, tight enough that an abusive script is capped.
  //
  // SCALE-NOTE (Phase 23): the aiRateLimit token bucket lives in the
  // backend process memory (see middleware/aiRateLimit.ts and
  // services/ai/credential.ts caches). Single-instance Express is the
  // assumption — when we eventually horizontal-scale to 2+ pods, the
  // effective per-user limit doubles (each pod tracks independently). The
  // real backstop against runaway spend is `freeTier.dailyUsdPerUser`
  // (DB-locked via `countPlatformQuestionsTodayLocked`), which DOES hold
  // across pods. Don't migrate this to Redis / Postgres until horizontal
  // scale is forced — DB-write per AI request is too expensive at our
  // anticipated launch volumes. When/if we hit the trigger, this comment
  // is the bookmark.
  aiRateLimit: {
    windowMs: num(process.env.AI_RATE_LIMIT_WINDOW_MS, 60_000),
    max: num(process.env.AI_RATE_LIMIT_MAX, 60),
  },

  // Deadline for a single AI call to finish. Bounds how long we hold an
  // OpenAI response slot and keep a user's tokens burning if the upstream
  // stalls or the client disappears. Covers both /ask and /ask/stream.
  // P-L5: 45s matches the frontend's 30s-no-chunk watchdog + recovery
  // margin; nano-family responses finish well inside this, and a non-
  // streaming call that hasn't returned in 45s is almost certainly stuck.
  aiRequestTimeoutMs: num(process.env.AI_REQUEST_TIMEOUT_MS, 45_000),

  // Phase 17 / H-A2: per-IP throttle on the mutating routes (session
  // lifecycle, snapshot, execute). Session creation is tighter because it's
  // the expensive op (spawns a container). The normal mutation bucket is
  // generous so per-keystroke snapshot sync / repeated run-code clicks
  // still feel instant.
  mutationRateLimit: {
    sessionCreateWindowMs: num(
      process.env.SESSION_CREATE_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    sessionCreateMax: num(process.env.SESSION_CREATE_RATE_LIMIT_MAX, 30),
    mutationWindowMs: num(
      process.env.MUTATION_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    mutationMax: num(process.env.MUTATION_RATE_LIMIT_MAX, 120),
  },

  // Phase 18a: Supabase Auth. `url` points at the Supabase API root (GoTrue
  // lives under /auth/v1). The backend does NOT use an anon/service-role
  // key — it only verifies access tokens coming from the browser, by
  // fetching the JWKS from the auth server. JWKS verification needs no
  // shared secret; it's asymmetric.
  //
  // 12-factor: no default. The value must come from env (.env / .env.production).
  // Missing env at boot is a deployment misconfig; assertConfigValid() fails
  // fast rather than silently pointing at a wrong URL.
  supabase: {
    url: process.env.SUPABASE_URL,
    // Phase 20-P0 #9: service-role key is only used by the delete-account
    // path to call supabase.auth.admin.deleteUser (the CASCADE FKs take
    // care of public.* rows). It is OPTIONAL — if unset, the delete-account
    // route 501s and the UI disables the button. This keeps the VM
    // install that has dropped this secret (Phase 20-P1) still bootable.
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // Phase 18b: Postgres for per-user state (preferences, progress, editor
  // project). Points at the Supabase-managed Postgres for the current
  // environment (transaction pooler URL from Project Settings → Database).
  databaseUrl: process.env.DATABASE_URL,

  // Phase 18e + Phase 26 (audit M-1): master keys for AES-256-GCM
  // envelope encryption of user BYOK OpenAI keys. 32 raw bytes each,
  // base64-encoded at rest. Generate with `openssl rand -base64 32`.
  //
  // Rotation model — version-keyed map. Multiple master keys can coexist:
  //   BYOK_ENCRYPTION_KEY      → version 1 (legacy single-key shape)
  //   BYOK_ENCRYPTION_KEY_V1   → version 1 (overrides the legacy var)
  //   BYOK_ENCRYPTION_KEY_V2   → version 2
  //   ... (any positive integer)
  //
  // BYOK_CURRENT_VERSION (default 1) selects which version new writes
  // encrypt under. Decrypts auto-pick by reading the version byte from
  // the ciphertext and looking up the matching key. Backward-compat:
  // if neither V1-specific var is set but BYOK_ENCRYPTION_KEY is, that
  // becomes V1 — existing single-key deployments need no env changes.
  //
  // Rotation runbook (high level):
  //   1. Generate K2; set BYOK_ENCRYPTION_KEY_V2 in Key Vault.
  //   2. Deploy backend → V2 now decryptable; old V1 rows still readable.
  //   3. Set BYOK_CURRENT_VERSION=2 in KV → new writes encrypt under V2.
  //   4. Run re-encrypt sweep over user_preferences rows whose
  //      byok_cipher_version=1 (one-shot, idempotent).
  //   5. Once 0 v1 rows remain, drop BYOK_ENCRYPTION_KEY_V1 from KV.
  // Old releases of this code (pre-Phase 26, single-key shape) keep
  // working because they only read BYOK_ENCRYPTION_KEY.
  byokEncryptionKeys: collectByokEncryptionKeys(),
  byokCurrentVersion: parseIntEnv(process.env.BYOK_CURRENT_VERSION) ?? 1,

  // Phase 20-P4: free AI tier on the operator's OpenAI key. Default OFF so
  // a fresh deployment doesn't start burning the operator's $ on first boot
  // — the flag is flipped to "1" only after the 24h post-merge soak shows
  // metrics are clean. See /Users/mehul/.claude/plans/hazy-wishing-wren.md.
  freeTier: {
    enabled: process.env.ENABLE_FREE_TIER === "1",
    dailyQuestions: num(process.env.FREE_TIER_DAILY_QUESTIONS, 30),
    // Per-user $ caps bound one account's blast radius even if the daily-
    // question counter is bypassed by a bug or a concurrent-tab race.
    dailyUsdPerUser: Number(process.env.FREE_TIER_DAILY_USD_PER_USER ?? "0.10"),
    lifetimeUsdPerUser: Number(process.env.FREE_TIER_LIFETIME_USD_PER_USER ?? "1.00"),
    // Global circuit breaker: once the product-wide daily spend crosses this
    // all platform calls short-circuit. Phase 22A: bumped default $2 → $15
    // so a Product-Hunt-tier launch (~50 active users on the free tier)
    // doesn't silently degrade at 7am PT. Live override happens via the
    // admin panel (system_config); env default is the bare-deploy fallback.
    dailyUsdCap: Number(process.env.FREE_TIER_DAILY_USD_CAP ?? "15.00"),
    // Operator's OpenAI key used when the learner has no BYOK and free tier
    // is enabled. Required when freeTier.enabled is true — assertConfigValid
    // fails fast otherwise so a misconfig doesn't land as a 500-per-request.
    platformOpenaiApiKey: process.env.PLATFORM_OPENAI_API_KEY,
    // Phase 27 §3d: anonymous (no signup) AI cap. Per-IP-hash daily count.
    // Strictly tighter than the authed dailyQuestions (30) since anon
    // traffic shares the platform key with no per-user identity. Default
    // 8/day = enough for a curious visitor to complete lesson 1 with a
    // few hint requests; not enough for sustained use. Anon spend ALSO
    // counts toward the global L4 dailyUsdCap, so even at the per-IP
    // cap there's a hard ceiling on anon's contribution to total spend.
    anonDailyQuestionsPerIp: num(process.env.ANON_DAILY_QUESTIONS_PER_IP, 8),
    // Phase 27 §3b: per-anonymous-request output-token clamp. Provider
    // already caps to MAX_OUTPUT_TOKENS=2000 globally; this is the
    // tighter ceiling we ask for on anon calls. 512 = enough for a
    // tutor reply with one or two short sections; not enough for a
    // novel.
    anonMaxOutputTokens: num(process.env.ANON_MAX_OUTPUT_TOKENS, 512),
    // Phase A — A5 (operational floor): anon-ONLY global daily $ cap,
    // tighter than and independent of the combined L4 dailyUsdCap.
    // Anon spend hitting this ceiling turns anon AI off until UTC
    // midnight while authed free-tier traffic keeps its full L4
    // budget — a viral anon spike can't starve signed-up learners.
    // Live override via system_config `anon_daily_usd_cap`.
    anonDailyUsdCap: Number(process.env.ANON_DAILY_USD_CAP ?? "5.00"),
    // Phase A — A5: per-IP daily cap on POST /api/anon/run (container
    // spawns). Bursts are already bounded by sessionCreateLimit
    // (30/min/IP); this is the sustained-abuse ceiling. 100/day is
    // ~10x an enthusiastic lesson-1 visitor's real usage. Live
    // override via system_config `anon_daily_runs_per_ip`.
    anonDailyRunsPerIp: num(process.env.ANON_DAILY_RUNS_PER_IP, 100),
  },

  // Phase 27-v2 quick fix #5: per-route kill switch for the anonymous
  // lesson surface. Default ON (1) so a normal deploy keeps anon
  // available; flip to "0" + restart to disable /api/anon/* without
  // a code change. The router still mounts but every route returns
  // 503 ANON_LESSON_DISABLED — operator can't accidentally leak anon
  // traffic by forgetting to remove the route. Useful for: incident
  // response (abuse spike), staged rollout, or paused-trial windows
  // around marketing pushes that overshoot expected DAU. Kept as a
  // top-level config key (not under freeTier) because anon enable is
  // independent of free-tier enable — a deploy could keep authed
  // free-tier on while turning anon off.
  anonLessonEnabled: process.env.ENABLE_ANON_LESSON !== "0",

  // Phase A — A5 (operational floor): fixed Azure infra baseline in
  // $/month, surfaced by the admin dashboard's projected-burn tile.
  // The backend can't (and shouldn't) query the Azure Cost API at
  // runtime — this is a deliberate operator-maintained constant,
  // updated when infra shape changes (July-2026 lean posture: VM $30 +
  // probe $6 + alerts $7 + disk $5 + IP $4 ≈ $52). Display-only; no
  // enforcement hangs off it.
  infraMonthlyBaselineUsd: Number(process.env.INFRA_MONTHLY_BASELINE_USD ?? "52"),

  // Phase 22A: backend-originated email via Azure Communication Services.
  // Used for operational alerts (budgetWatcher 50/80/100%) and user-facing
  // re-engagement (Phase 22D streak nudge). All three values come from
  // Azure Key Vault via cloud-init's refresh-env script. Empty strings are
  // valid in dev — the email send path throws EmailNotConfiguredError so a
  // local dev backend can boot without ACS configured.
  email: {
    acsConnectionString: process.env.ACS_CONNECTION_STRING ?? "",
    acsSenderEmail: process.env.ACS_SENDER_EMAIL ?? "",
    operatorAlertEmail: process.env.OPERATOR_ALERT_EMAIL ?? "",

    // Phase 22D: streak-nudge re-engagement email.
    //
    // unsubscribeSecret — HMAC-SHA256 secret for signing one-click
    // unsubscribe URLs. Empty in dev = unsubscribe route returns 503
    // with a clear "not configured" message rather than minting
    // unverifiable tokens.
    //
    // Phase 23 P1 #5: dual-secret rotation. Tokens are non-expiring on
    // purpose (Mailchimp / Substack pattern — clicking unsubscribe on a
    // 6-month-old email must work). Naive rotation invalidates every
    // outstanding link at once. With `unsubscribeSecretPrevious` set,
    // verify tries CURRENT first, then PREVIOUS — so the operator can:
    //   1. set new EMAIL_UNSUBSCRIBE_SECRET, copy old → EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS
    //   2. refresh-env on the VM (both flow into the container env)
    //   3. wait ~60 days (or however long emails persist in inboxes)
    //   4. drop _PREVIOUS once stale tokens have aged out
    // Empty `_PREVIOUS` = single-secret behavior (today's posture).
    unsubscribeSecret: process.env.EMAIL_UNSUBSCRIBE_SECRET ?? "",
    unsubscribeSecretPrevious:
      process.env.EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS ?? "",

    // Phase 23 P1 #1: digestSweeper bounded parallelism. Default 3 keeps
    // steady-state throughput at ~60-180 sends/min — under ACS's
    // ~100/min default ceiling — while cutting sweep latency 3× vs the
    // sequential v1. Tunable via env if/when ACS tier or send volume
    // changes.
    digestSweepConcurrency: num(process.env.DIGEST_SWEEP_CONCURRENCY, 3),

    // Display name + reply-to for the streak nudge.
    //   From:      CodeTutor <noreply@mail.codetutor.msrivas.com>  (acsSenderEmail)
    //   Reply-To:  support@msrivas.com                             (routed to
    //              operator inbox via iCloud Custom Email Domain)
    // Display name is what mail clients show in the inbox list; the
    // address itself is the DKIM-signed sender. Reply-To diverges so
    // user replies land in a monitored inbox, not /dev/null.
    streakNudgeFromName: process.env.STREAK_NUDGE_FROM_NAME ?? "CodeTutor",
    streakNudgeReplyTo:
      process.env.STREAK_NUDGE_REPLY_TO ?? "support@msrivas.com",

    // Kill switch. On-call sets this to "1" via .env to instantly stop
    // the daily cron from sending without a redeploy. Sweeper checks
    // this on every fire (not just at boot) so a flip takes effect on
    // the next daily window.
    streakNudgeDisabled: process.env.STREAK_NUDGE_DISABLED === "1",
  },

  // Phase 21C: cinematic share controls. Two kill switches let on-call
  // disable hot paths without a redeploy if a viral share melts capacity
  // or a render bug starts producing bad images. `contentOrigin` is where
  // the backend fetches canonical lesson catalog JSON for snapshot
  // validation (replaces client-supplied lesson titles, so a malicious
  // POST can't mint a brand-impersonating share like "I leaked the DB").
  // Defaults to the frontend host the same way `corsOrigin` does.
  share: {
    // Three independent kill switches so on-call can target the
    // exact failure mode without wider blast radius:
    //   - publicDisabled: 503s GET /api/shares/:token (drain a
    //     viral surge or take the public surface down for incident
    //     response). Does NOT block create — users mid-celebration
    //     can still publish.
    //   - createDisabled: 503s POST /api/shares (block new creates
    //     while letting existing shares stay viewable; useful when
    //     the catalog or sanitizer is misbehaving).
    //   - renderDisabled: lets create succeed but skips the image
    //     render+upload. Row exists with null image paths, dialog
    //     shows the link + falls back gracefully.
    publicDisabled: process.env.SHARE_PUBLIC_DISABLED === "1",
    createDisabled: process.env.SHARE_CREATE_DISABLED === "1",
    renderDisabled: process.env.SHARE_RENDER_DISABLED === "1",
    // Release 0A: the crawler/unfurl adapter has its own kill switch and
    // purpose-specific HMAC credential. Keeping this separate from
    // publicDisabled means on-call can drain preview traffic without taking
    // the human-facing /api/shares/:token reader path down.
    previewDisabled: process.env.SHARE_PREVIEW_DISABLED === "1",
    previewAuth: {
      currentKeyId:
        process.env.SHARE_PREVIEW_HMAC_CURRENT_KEY_ID ?? "v1",
      currentSecret:
        process.env.SHARE_PREVIEW_HMAC_CURRENT_SECRET ?? "",
      previousKeyId:
        process.env.SHARE_PREVIEW_HMAC_PREVIOUS_KEY_ID ?? "",
      previousSecret:
        process.env.SHARE_PREVIEW_HMAC_PREVIOUS_SECRET ?? "",
      maxSkewMs: num(process.env.SHARE_PREVIEW_HMAC_MAX_SKEW_MS, 30_000),
      nonceCacheMax: num(
        process.env.SHARE_PREVIEW_NONCE_CACHE_MAX,
        10_000,
      ),
    },
    previewRateLimit: {
      windowMs: num(
        process.env.SHARE_PREVIEW_RATE_LIMIT_WINDOW_MS,
        60_000,
      ),
      max: num(process.env.SHARE_PREVIEW_RATE_LIMIT_MAX, 600),
    },
    // The lesson catalog used to be fetched from the frontend over
    // HTTP, but post-audit we now bake `frontend/public/courses` into
    // the backend image at build time and read from disk — eliminates
    // the cross-service hard dep AND the SSRF-via-env vector.
  },

  // Phase 20-P3: shared secret for `/api/metrics`. When set, the Prometheus
  // endpoint requires `Authorization: Bearer <METRICS_TOKEN>`; when unset,
  // `/api/metrics` only accepts loopback requests (127.0.0.1 / ::1), so the
  // endpoint is still reachable by a same-host scraper or `curl` from the
  // VM itself but not from the public internet via Caddy. Keeping it
  // unauthenticated was a BI leak (live session count + per-model token
  // totals) and a DoS-pressure oracle.
  metricsToken: process.env.METRICS_TOKEN,

  // Phase 24B: ACI hybrid burst overflow. When the local Docker session
  // count hits `session.maxGlobal` (5 on B2s, 14 on B2ms), new sessions
  // spill over to Azure
  // Container Instances. Sessions stay routed locally up to that ceiling
  // — ACI only spawns containers that would otherwise have 503'd, so a
  // quiet day adds $0 in ACI cost. Each ACI session bills at ~$0.053/hr
  // while running and is destroyed the instant the session ends.
  //
  // ENABLE_ACI_OVERFLOW=0 → flag off. With Azure config absent (dev), the
  // flag is effectively off regardless of value (factory logs a warning
  // and falls back to local-only). In prod with Azure config present and
  // flag default 1, ACI is the overflow mechanism for spikes.
  //
  // ACI_DAILY_USD_CAP is the operator's brake. The cost sampler tracks
  // estimated spend per UTC day; once it exceeds the cap, ACI overflow
  // disables for the rest of the day (returning 503 instead of spawning
  // more ACI containers) and resets at UTC midnight. Worst case (runaway
  // loop or deliberate flood) caps at $cap/day = ~$cap×30/mo.
  aci: {
    // Default on per Phase 24B operator decision. Flip to "0" via
    // KV → refresh-env if a runtime issue surfaces post-launch.
    enabled: process.env.ENABLE_ACI_OVERFLOW !== "0",
    dailyUsdCap: num(process.env.ACI_DAILY_USD_CAP, 20),
    // Hard cap on concurrent ACI sessions. Combined with local maxGlobal
    // (5 on B2s, 14 on B2ms), absolute total = local + maxOverflow = 41
    // (B2s) / 50 (B2ms) by default. A new session arriving past that
    // returns 503 instead of spawning yet another ACI container — a
    // backstop for the cost cap.
    maxOverflow: num(process.env.ACI_MAX_OVERFLOW, 36),
    // Cold-start budget. ACI typically completes "Pending → Running" in
    // 5–15s; 30s gives headroom for image pulls + IP allocation. Past
    // this, the spawn attempt is abandoned + the user gets a friendly
    // "we're under heavy load" 503.
    coldStartTimeoutMs: num(process.env.ACI_COLD_START_TIMEOUT_MS, 30_000),
    // Port the sidecar agent listens on inside each runner container.
    // Same value baked into the runner image. Internal-only — the ACI
    // container group's NSG restricts inbound to the backend's VM subnet.
    sidecarPort: num(process.env.ACI_SIDECAR_PORT, 5757),
    // Azure resource targets. Empty in dev; populated in prod via KV →
    // refresh-env. When any of `subscriptionId`, `resourceGroup`, or
    // `subnetId` is missing, the factory logs a warning and treats ACI
    // as disabled (the local-only fallback is safe — the only impact is
    // 503 instead of overflow when local is full).
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID ?? "",
    resourceGroup: process.env.AZURE_RG ?? "",
    location: process.env.AZURE_LOCATION ?? "eastus2",
    subnetId: process.env.ACI_SUBNET_ID ?? "",
    // GHCR-pulled runner image, ideally pinned by digest so a registry
    // tag-flip can't alter the binary running in our overflow containers.
    // Empty falls back to `runnerImage` for dev parity, but prod should
    // set this explicitly with a `@sha256:…` reference.
    runnerImage: process.env.ACI_RUNNER_IMAGE ?? "",
    // Phase 24B Slice 8: warm-pool enabled flag. Boot-time default;
    // admin panel can flip at runtime via the system_config DB. Default
    // false (mechanism wired but dormant — zero idle cost on launch
    // day). Operator activates only if cold-start latency complaints
    // surface, capped at 2 idle ACI containers ever (~$2.54/day worst
    // case, bounded further by the daily $-cap kill switch).
    warmPoolEnabled: process.env.ACI_WARM_POOL_ENABLED === "1",
    // P2-2 (audit fix): hysteresis knobs admin-editable via system_config.
    // Env defaults match the original constants in aciWarmPoolService.ts;
    // omit the env var (or set blank) to use them. parseInt → undefined
    // when env unset so the operational-config mirror falls back cleanly.
    warmHighWatermark: parseOptionalInt(process.env.ACI_WARM_HIGH_WATERMARK),
    warmLowWatermark: parseOptionalInt(process.env.ACI_WARM_LOW_WATERMARK),
    warmMaxPoolSize: parseOptionalInt(process.env.ACI_WARM_MAX_POOL_SIZE),
  },
} as const;

function parseOptionalInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Phase 20-P2 hygiene: once the sensitive env vars have been copied into the
// frozen `config` object, drop them from `process.env` so a later reader
// (e.g. a library that scans env, an accidental `console.log(process.env)`,
// a future RCE that echoes env) finds nothing. The backend reads these only
// through `config.*` from this point forward.
delete process.env.BYOK_ENCRYPTION_KEY;
// Phase 26: also strip every versioned BYOK key from process.env. The
// keys were copied into the frozen `byokEncryptionKeys` map above.
for (const k of Object.keys(process.env)) {
  if (/^BYOK_ENCRYPTION_KEY_V\d+$/.test(k)) delete process.env[k];
}
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.DATABASE_URL;
delete process.env.METRICS_TOKEN;
delete process.env.PLATFORM_OPENAI_API_KEY;
// Phase 22A audit: ACS connection string carries an embedded access key
// (the "accesskey=" segment). Treat it like every other secret and drop
// it from process.env once acsClient.ts has captured it via config.
delete process.env.ACS_CONNECTION_STRING;
// Same hygiene for the unsubscribe HMAC secret — anything in process.env
// is reachable from any module via process.env scans, so collapse the
// surface area to the single `config.email.unsubscribeSecret` reference.
delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
delete process.env.SHARE_PREVIEW_HMAC_CURRENT_SECRET;
delete process.env.SHARE_PREVIEW_HMAC_PREVIOUS_SECRET;

export function assertConfigValid(): void {
  if (!config.supabase.url || config.supabase.url.trim() === "") {
    throw new Error(
      "[config] SUPABASE_URL is required. Populate `.env` from `.env.example` " +
        "with your codetutor-dev / codetutor-prod project URL.",
    );
  }
  try {
    new URL(config.supabase.url);
  } catch {
    throw new Error(
      `[config] SUPABASE_URL is not a valid URL: ${config.supabase.url}`,
    );
  }
  if (!config.databaseUrl || config.databaseUrl.trim() === "") {
    throw new Error(
      "[config] DATABASE_URL is required. Populate `.env` from `.env.example` " +
        "with your project's transaction-pooler connection string.",
    );
  }
  if (config.byokEncryptionKeys.size === 0) {
    throw new Error(
      "[config] BYOK_ENCRYPTION_KEY (or BYOK_ENCRYPTION_KEY_V1) is required. " +
        "Generate one with `openssl rand -base64 32` and set it in `.env`.",
    );
  }
  for (const [version, raw] of config.byokEncryptionKeys) {
    if (!raw || raw.trim() === "") {
      throw new Error(
        `[config] BYOK_ENCRYPTION_KEY_V${version} must not be empty.`,
      );
    }
    try {
      const buf = Buffer.from(raw, "base64");
      if (buf.length !== 32) {
        throw new Error(
          `[config] BYOK_ENCRYPTION_KEY_V${version} must decode to 32 bytes (got ${buf.length}).`,
        );
      }
    } catch (err) {
      throw new Error(
        `[config] BYOK_ENCRYPTION_KEY_V${version} must be valid base64: ${(err as Error).message}`,
      );
    }
  }
  if (!config.byokEncryptionKeys.has(config.byokCurrentVersion)) {
    throw new Error(
      `[config] BYOK_CURRENT_VERSION=${config.byokCurrentVersion} but no master key is configured for that version. ` +
        `Set BYOK_ENCRYPTION_KEY_V${config.byokCurrentVersion} (or BYOK_ENCRYPTION_KEY for V1).`,
    );
  }
  const previewAuth = config.share.previewAuth;
  const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,31}$/;
  const validatePreviewSecret = (label: string, value: string): void => {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
      throw new Error(`[config] ${label} must use canonical base64.`);
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) {
      throw new Error(
        `[config] ${label} must be a base64-encoded 32-byte secret (got ${decoded.length} bytes).`,
      );
    }
  };
  if (previewAuth.currentSecret) {
    if (!keyIdPattern.test(previewAuth.currentKeyId)) {
      throw new Error(
        "[config] SHARE_PREVIEW_HMAC_CURRENT_KEY_ID has an invalid shape.",
      );
    }
    validatePreviewSecret(
      "SHARE_PREVIEW_HMAC_CURRENT_SECRET",
      previewAuth.currentSecret,
    );
  }
  const hasPreviousId = previewAuth.previousKeyId.length > 0;
  const hasPreviousSecret = previewAuth.previousSecret.length > 0;
  if (hasPreviousId !== hasPreviousSecret) {
    throw new Error(
      "[config] SHARE_PREVIEW_HMAC_PREVIOUS_KEY_ID and SHARE_PREVIEW_HMAC_PREVIOUS_SECRET must be configured together.",
    );
  }
  if (hasPreviousSecret) {
    if (!previewAuth.currentSecret) {
      throw new Error(
        "[config] A previous share-preview key cannot be configured without a current key.",
      );
    }
    if (!keyIdPattern.test(previewAuth.previousKeyId)) {
      throw new Error(
        "[config] SHARE_PREVIEW_HMAC_PREVIOUS_KEY_ID has an invalid shape.",
      );
    }
    if (previewAuth.previousKeyId === previewAuth.currentKeyId) {
      throw new Error(
        "[config] Current and previous share-preview key IDs must differ.",
      );
    }
    validatePreviewSecret(
      "SHARE_PREVIEW_HMAC_PREVIOUS_SECRET",
      previewAuth.previousSecret,
    );
  }
  if (
    !Number.isFinite(previewAuth.maxSkewMs) ||
    previewAuth.maxSkewMs <= 0 ||
    !Number.isInteger(previewAuth.nonceCacheMax) ||
    previewAuth.nonceCacheMax <= 0
  ) {
    throw new Error(
      "[config] Share-preview freshness and nonce-cache limits must be positive.",
    );
  }
  if (
    !Number.isFinite(config.share.previewRateLimit.windowMs) ||
    config.share.previewRateLimit.windowMs <= 0 ||
    !Number.isInteger(config.share.previewRateLimit.max) ||
    config.share.previewRateLimit.max <= 0
  ) {
    throw new Error(
      "[config] Share-preview rate-limit window and max must be positive.",
    );
  }
  if (config.freeTier.enabled) {
    const key = config.freeTier.platformOpenaiApiKey;
    if (!key || key.trim() === "") {
      throw new Error(
        "[config] ENABLE_FREE_TIER=1 requires PLATFORM_OPENAI_API_KEY to be set.",
      );
    }
    const caps = config.freeTier;
    if (!Number.isFinite(caps.dailyUsdPerUser) || caps.dailyUsdPerUser <= 0) {
      throw new Error(
        `[config] FREE_TIER_DAILY_USD_PER_USER must be a positive number (got ${caps.dailyUsdPerUser}).`,
      );
    }
    if (!Number.isFinite(caps.lifetimeUsdPerUser) || caps.lifetimeUsdPerUser <= 0) {
      throw new Error(
        `[config] FREE_TIER_LIFETIME_USD_PER_USER must be a positive number (got ${caps.lifetimeUsdPerUser}).`,
      );
    }
    if (!Number.isFinite(caps.dailyUsdCap) || caps.dailyUsdCap <= 0) {
      throw new Error(
        `[config] FREE_TIER_DAILY_USD_CAP must be a positive number (got ${caps.dailyUsdCap}).`,
      );
    }
    if (!Number.isInteger(caps.dailyQuestions) || caps.dailyQuestions <= 0) {
      throw new Error(
        `[config] FREE_TIER_DAILY_QUESTIONS must be a positive integer (got ${caps.dailyQuestions}).`,
      );
    }
    // Phase 27 §3d: anon caps. Zero or negative values would silently
    // break the resolver — anonDailyQuestionsPerIp=0 always returns
    // anon_exhausted; a non-positive anonMaxOutputTokens would
    // propagate to the OpenAI request body. Fail-fast at boot.
    if (
      !Number.isInteger(caps.anonDailyQuestionsPerIp) ||
      caps.anonDailyQuestionsPerIp <= 0
    ) {
      throw new Error(
        `[config] ANON_DAILY_QUESTIONS_PER_IP must be a positive integer (got ${caps.anonDailyQuestionsPerIp}).`,
      );
    }
    if (
      !Number.isInteger(caps.anonMaxOutputTokens) ||
      caps.anonMaxOutputTokens <= 0
    ) {
      throw new Error(
        `[config] ANON_MAX_OUTPUT_TOKENS must be a positive integer (got ${caps.anonMaxOutputTokens}).`,
      );
    }
    // Phase A — A5: same fail-fast posture for the operational-floor
    // caps. anonDailyUsdCap=0 would hard-disable anon AI (use the
    // anon_lesson_enabled kill switch for that intent instead);
    // anonDailyRunsPerIp=0 would 429 every anon run.
    if (!Number.isFinite(caps.anonDailyUsdCap) || caps.anonDailyUsdCap <= 0) {
      throw new Error(
        `[config] ANON_DAILY_USD_CAP must be a positive number (got ${caps.anonDailyUsdCap}).`,
      );
    }
    if (
      !Number.isInteger(caps.anonDailyRunsPerIp) ||
      caps.anonDailyRunsPerIp <= 0
    ) {
      throw new Error(
        `[config] ANON_DAILY_RUNS_PER_IP must be a positive integer (got ${caps.anonDailyRunsPerIp}).`,
      );
    }
  }
}
