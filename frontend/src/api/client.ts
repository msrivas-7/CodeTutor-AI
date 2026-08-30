// Phase 17 / H-A3: mutating routes require a custom header so the backend
// can reject simple cross-origin POSTs (which can't set arbitrary headers
// without tripping CORS preflight, which the backend then rejects by
// Origin). Attach to every POST from this client.
const JSON_HEADERS = { "Content-Type": "application/json" };
const CSRF_HEADER = { "X-Requested-With": "codetutor" };

// Phase 19d: on SWA the frontend runs on a separate origin from the VM, so
// `/api/*` must resolve to the VM's absolute URL. In dev this is empty and
// `/api/*` stays same-origin (Vite proxies — see vite.config.ts).
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

import { supabase } from "../auth/supabaseClient";
import { ApiError } from "./ApiError";
import { readDistributionAttribution } from "../features/distribution/attribution";

// Read the response body once for an error path, then wrap it in ApiError.
// We also `console.error` the raw so the detail survives in devtools even
// though the user-facing alert shows only the friendly message.
async function throwApiError(res: Response, path: string): Promise<never> {
  const body = await res.text().catch(() => "");
  console.error(`[api] ${path} failed: ${res.status} ${body}`);
  const retryAfterRaw = res.headers.get("Retry-After");
  const retryAfterSeconds = retryAfterRaw
    ? Math.max(0, Number.parseInt(retryAfterRaw, 10))
    : null;
  throw new ApiError(
    res.status,
    body,
    path,
    Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
  );
}

// Phase 18a: attach the Supabase access token to every backend request so
// the `authMiddleware` on the server side can identify the user. We fetch
// the session lazily per-request — the SDK caches and auto-refreshes, so
// `getSession()` returns synchronously from cache in the common path.
//
// /api/health is callable pre-auth; every other backend route (including
// /api/ai/validate-key) requires an Authorization header.
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

let refreshInFlight: Promise<string | null> | null = null;

// Admin operations are intentionally bounded. The console is an incident-
// response surface: an unanswered request must become a visible retry state
// instead of leaving an operator to guess whether a skeleton is still alive.
// Keep this longer than the normal 5 s polling cadence, while still short
// enough to be useful during an outage.
export const ADMIN_REQUEST_TIMEOUT_MS = 10_000;
// Model changes deliberately combine live provider discovery, guarded config
// storage, an authoritative reread, and audit logging. Keep the normal admin
// read budget sharp, but do not let this longer mutation report failure while
// the server is still completing an accepted change.
export const TUTOR_MODEL_ADMIN_TIMEOUT_MS = 30_000;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = supabase.auth
    .refreshSession()
    .then(({ data, error }) => {
      if (error) return null;
      return data.session?.access_token ?? null;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Authenticated requests get one explicit token-refresh retry on 401. A
 * second 401 is returned to the caller as a recoverable action error; it does
 * not silently sign the learner out or destroy the route they were using.
 */
async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isAdminRequest = path.startsWith("/api/admin/");
  const isTutorModelMutation = path === "/api/admin/tutor-model" &&
    init.method !== undefined && init.method.toUpperCase() !== "GET";
  const timeoutController = isAdminRequest ? new AbortController() : null;
  const callerSignal = init.signal;
  let timedOut = false;
  const forwardAbort = () => timeoutController?.abort(callerSignal?.reason);
  if (callerSignal && timeoutController) {
    if (callerSignal.aborted) forwardAbort();
    else callerSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeoutId = timeoutController
    ? globalThis.setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, isTutorModelMutation
        ? TUTOR_MODEL_ADMIN_TIMEOUT_MS
        : ADMIN_REQUEST_TIMEOUT_MS)
    : null;

  const send = async (tokenOverride?: string | null) => {
    const auth = tokenOverride
      ? { Authorization: `Bearer ${tokenOverride}` }
      : await authHeaders();
    return fetch(`${API_BASE}${path}`, {
      ...init,
      signal: timeoutController?.signal ?? callerSignal,
      headers: { ...auth, ...(init.headers ?? {}) },
    });
  };
  try {
    let res = await send();
    if (res.status !== 401) return res;
    const refreshed = await refreshAccessToken();
    if (!refreshed) return res;
    res = await send(refreshed);
    return res;
  } catch (error) {
    if (timedOut) {
      throw new Error(
        "The admin request took too long. Check the connection and try again.",
      );
    }
    throw error;
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

// QA-H3: registry of in-flight fetches keyed by sessionId so a rebind that
// returns a *different* id can abort them atomically. Without this, a
// snapshot/execute/status call fired before the rebind lands with the old
// sessionId in its body, the backend 404s it, and the UI flashes a spurious
// "session not found" error against a session that was just successfully
// recreated under a new id.
const sessionAbortRegistry = new Map<string, Set<AbortController>>();
const anonRunAbortRegistry = new Set<AbortController>();

function registerSessionRequest(sessionId: string): AbortController {
  const ctrl = new AbortController();
  let bucket = sessionAbortRegistry.get(sessionId);
  if (!bucket) {
    bucket = new Set();
    sessionAbortRegistry.set(sessionId, bucket);
  }
  bucket.add(ctrl);
  return ctrl;
}

function releaseSessionRequest(sessionId: string, ctrl: AbortController): void {
  const bucket = sessionAbortRegistry.get(sessionId);
  if (!bucket) return;
  bucket.delete(ctrl);
  if (bucket.size === 0) sessionAbortRegistry.delete(sessionId);
}

export function abortSessionRequests(sessionId: string): number {
  const bucket = sessionAbortRegistry.get(sessionId);
  if (!bucket) return 0;
  const n = bucket.size;
  for (const ctrl of bucket) ctrl.abort();
  sessionAbortRegistry.delete(sessionId);
  return n;
}

export function abortAnonRunRequests(): number {
  const count = anonRunAbortRegistry.size;
  for (const controller of anonRunAbortRegistry) controller.abort();
  anonRunAbortRegistry.clear();
  return count;
}

async function post<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await authenticatedFetch(path, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...(extraHeaders ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await authenticatedFetch(path, {
    method: "PATCH",
    headers: { ...JSON_HEADERS, ...CSRF_HEADER },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await authenticatedFetch(path, {
    method: "PUT",
    headers: { ...JSON_HEADERS, ...CSRF_HEADER },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await authenticatedFetch(path, {
    method: "DELETE",
    headers: { ...CSRF_HEADER },
  });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

// Phase 25: DELETE-with-body. Some admin destructive endpoints
// (kill session, kill all-for-user) carry a phrase-confirm body even
// though the HTTP semantics are deletion.
async function delJson<T>(path: string, body: unknown): Promise<T> {
  const res = await authenticatedFetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...CSRF_HEADER },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await authenticatedFetch(path, { headers: { ...(extraHeaders ?? {}) } });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

import type {
  AIMessage,
  AIModel,
  ContextualTutorOfferRequest,
  EditorSelection,
  Language,
  Persona,
  ProjectFile,
  RunResult,
  TokenUsage,
  TutorAction,
  TutorSections,
} from "../types";
import type { CompletionRule, FunctionTest, SourceCheck, TestReport } from "../features/learning/types";

export interface ExecuteTestsResponse {
  report: TestReport;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

// Phase 20-P4: /api/user/ai-status response shape. Mirrors the backend's
// CredentialNoneReason union in services/ai/credential.ts — keep in sync.
export type AIStatusNoneReason =
  | "no_key"
  | "free_disabled"
  | "free_exhausted"
  | "daily_usd_per_user_hit"
  | "lifetime_usd_per_user_hit"
  | "usd_cap_hit"
  | "denylisted"
  | "provider_auth_failed";

export interface AIStatusResponse {
  source: "byok" | "platform" | "none";
  reason?: AIStatusNoneReason;
  remainingToday: number | null;
  capToday: number | null;
  resetAtUtc: string | null;
  // Phase 20-P4: once a user has clicked the paid-interest CTA anywhere,
  // every surface hides the button — one signal per user is enough and more
  // clutter is noise. Backend derives from EXISTS on paid_access_interest.
  hasShownPaidInterest: boolean;
  /** Independent Release 1C runtime model-call gate. */
  contextualTutorEnabled: boolean;
}

// Phase 18b: per-user data API surface. Every shape here mirrors the
// backend's db/*.ts types; mismatches surface as runtime shape errors
// rather than type errors, so keep the two in sync when the schema moves.

export interface UserPreferences {
  persona: "beginner" | "intermediate" | "advanced";
  openaiModel: string | null;
  theme: "system" | "light" | "dark";
  welcomeDone: boolean;
  workspaceCoachDone: boolean;
  editorCoachDone: boolean;
  uiLayout: Record<string, unknown>;
  // Phase 18e: BYOK presence flag. The plaintext key lives only on the
  // backend (encrypted at rest in user_preferences) — the frontend only
  // learns whether one is set, never the value itself.
  hasOpenaiKey: boolean;
  // First-run cinematic: timestamp of the last time the daily welcome-
  // back overlay was shown. Server-backed so one device's heartbeat
  // suppresses the next device's — a learner who got welcomed on
  // laptop at 9am shouldn't be re-welcomed on phone at noon.
  lastWelcomeBackAt: string | null;
  // Phase 22D: opt-in for the streak re-engagement email. Defaults TRUE
  // for new accounts. Settings panel exposes a toggle; the email's
  // unsubscribe link flips this to false directly via the unsubscribe
  // route (bypasses the patch path).
  emailOptIn: boolean;
  // Phase 27: hide the streak system entirely for this user. Defaults
  // FALSE; when TRUE, StreakChip + lesson-complete streak section +
  // share-page streak count + daily streak email are all suppressed.
  // Streak data on the server is preserved; toggling back to FALSE
  // resumes display from the persisted value.
  disableStreaks: boolean;
  updatedAt: string;
  // Phase 25: account-freeze flag. When true, the user is blocked from
  // creating new sessions and the authed shell renders a generic
  // "account suspended — contact support" banner. Backend's
  // sessionManager.startSession returns 403 ACCOUNT_FROZEN. The
  // operator's internal freeze reason is NOT exposed here — it's
  // audit-trail only and stays server-side.
  accountFrozen?: boolean;
}

export interface UserPreferencesPatch {
  persona?: UserPreferences["persona"];
  openaiModel?: string | null;
  theme?: UserPreferences["theme"];
  welcomeDone?: boolean;
  workspaceCoachDone?: boolean;
  editorCoachDone?: boolean;
  uiLayout?: Record<string, unknown>;
  lastWelcomeBackAt?: string | null;
  emailOptIn?: boolean;
  disableStreaks?: boolean;
}

export interface ServerCourseProgress {
  courseId: string;
  status: "not_started" | "in_progress" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  lastLessonId: string | null;
  completedLessonIds: string[];
}

export interface ServerCoursePatch {
  status?: ServerCourseProgress["status"];
  startedAt?: string | null;
  completedAt?: string | null;
  lastLessonId?: string | null;
  completedLessonIds?: string[];
}

export interface ServerLessonProgress {
  courseId: string;
  lessonId: string;
  status: "not_started" | "in_progress" | "completed";
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  attemptCount: number;
  runCount: number;
  hintCount: number;
  timeSpentMs: number;
  lastCode: Record<string, string> | null;
  draftRevision: number;
  draftWriterId: string | null;
  draftUpdatedAt: string | null;
  lastOutput: string | null;
  practiceCompletedIds: string[];
  practiceExerciseCode: Record<string, Record<string, string>>;
}

export interface ServerLessonPatch {
  status?: ServerLessonProgress["status"];
  startedAt?: string | null;
  completedAt?: string | null;
  attemptCount?: number;
  runCount?: number;
  hintCount?: number;
  timeSpentMs?: number;
  lastOutput?: string | null;
  practiceCompletedIds?: string[];
  practiceExerciseCode?: Record<string, Record<string, string>>;
  practiceEvidence?: PracticeEvidencePayload;
}

export interface PracticeEvidencePayload {
  exerciseId: string;
  requestId: string;
  attemptCount: number;
  hintCount: number;
  timeSpentMs: number;
  modelAssisted: boolean;
}

export type ConceptMemoryState =
  | "unseen"
  | "encountered"
  | "practiced"
  | "remembered"
  | "retained";

export interface ConceptMemoryItem {
  conceptTag: string;
  state: ConceptMemoryState;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastRetrievalAt: string | null;
  practiceCount: number;
  supportedRetrievalCount: number;
  independentRetrievalCount: number;
  refreshDue: boolean;
}

export interface ConceptMemoryResponse {
  courseId: string;
  refreshAfterDays: number;
  concepts: ConceptMemoryItem[];
}

export interface MemoryWarmupPrompt {
  episodeId: string;
  courseId: string;
  lessonId: string;
  warmupId: string;
  warmupVersion: number;
  conceptTags: string[];
  prompt: string;
  choices: string[];
  attemptCount: number;
}

export interface MemoryWarmupAnswer {
  episodeId: string;
  isCorrect: boolean;
  attemptNumber: number;
  completed: boolean;
  firstAttemptCorrect: boolean;
  explanation: string;
}

export interface EditorProjectPayload {
  language: string;
  files: Record<string, string>;
  activeFile: string | null;
  openTabs: string[];
  fileOrder: string[];
  stdin: string;
  expectedRevision: number;
  writerId: string;
}

export interface EditorProjectResponse extends Omit<EditorProjectPayload, "expectedRevision" | "writerId"> {
  revision: number;
  writerId: string | null;
  updatedAt: string;
}

export interface AskStreamRequest {
  /** One identifier per user-accepted action; never reused for a new action. */
  requestId: string;
  /** Omitted for platform-funded requests; the backend owns that choice. */
  model?: string;
  question: string;
  tutorAction?: TutorAction;
  contextualOffer?: ContextualTutorOfferRequest;
  files: ProjectFile[];
  activeFile?: string;
  language?: Language;
  lastRun?: RunResult | null;
  history: AIMessage[];
  tutorProgressToken?: string;
  stdin?: string | null;
  diffSinceLastTurn?: string | null;
  runsSinceLastTurn?: number;
  editsSinceLastTurn?: number;
  persona?: Persona;
  selection?: EditorSelection | null;
  lessonContext?: {
    courseId: string;
    lessonId: string;
    exerciseId?: string | null;
  } | null;
  evalSamplingConsent?: {
    version: 1;
    subjectToken: string;
  };
}

export interface AskStreamHandlers {
  onDelta(chunk: string): void;
  onDone(
    raw: string,
    sections: TutorSections,
    usage?: TokenUsage,
    tutorProgressToken?: string,
    remainingToday?: number | null,
    countsTowardQuota?: boolean,
  ): void;
  onError(message: string): void;
  signal?: AbortSignal;
}

// -------------------------------------------------------------------------
// Phase 20-P5: admin types
// -------------------------------------------------------------------------

export interface AdminUserOverride {
  userId: string;
  dailyQuestionsCap: number | null;
  dailyUsdCap: number | null;
  lifetimeUsdCap: number | null;
  setBy: string | null;
  setAt: string;
  reason: string | null;
}

export interface AdminUserListEntry {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  questionsToday: number;
  usdToday: number;
  usdLifetime: number;
  override: AdminUserOverride | null;
  denylisted: boolean;
}

export interface AdminDenylistRow {
  userId: string;
  reason: string;
  deniedAt: string;
  frozen: boolean;
  frozenReason: string | null;
  frozenAt: string | null;
  frozenSetBy: string | null;
}

export interface AdminUsersListResponse {
  users: AdminUserListEntry[];
  page: number;
  perPage: number;
  hasMore: boolean;
}

export interface AdminUserDetailResponse {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    createdAt: string;
    lastSignInAt: string | null;
  };
  questionsToday: number;
  usdToday: number;
  usdLifetime: number;
  override: AdminUserOverride | null;
  denylisted: boolean;
  // Phase 25: full denylist row when present (frozen state + reasons).
  denylist: AdminDenylistRow | null;
}

export type SystemConfigKey =
  | "free_tier_enabled"
  | "free_tier_daily_questions"
  | "free_tier_daily_usd_per_user"
  | "free_tier_lifetime_usd_per_user"
  | "free_tier_daily_usd_cap"
  // Phase 21C kill switches — admin-toggleable for fast incident
  // response. Boolean: `true` = the kill is engaged.
  | "share_public_disabled"
  | "share_create_disabled"
  | "share_render_disabled"
  | "share_preview_disabled"
  // Phase 24B operational knobs — admin-toggleable for fast spike
  // response. `aci_overflow_enabled = false` is the runtime kill switch
  // (no new ACI spawns; cap shrinks to local-only). Daily $ cap and
  // max overflow are dial-tweakable without redeploy.
  | "aci_overflow_enabled"
  | "aci_daily_usd_cap"
  | "aci_max_overflow"
  // Slice 8.5: warm-pool master toggle. Default off; flip on if cold-
  // start latency surfaces post-launch.
  | "aci_warm_pool_enabled"
  // P2-2: warm-pool hysteresis knobs.
  | "aci_warm_high_watermark"
  | "aci_warm_low_watermark"
  | "aci_warm_max_pool_size"
  // Phase 27-v2.2 Fix 7c — master kill switch for /api/anon/*. False
  // 503s the anon trial path on the next request (60s cache TTL).
  | "anon_lesson_enabled"
  // Phase A — A2: granular kill for the phone-graduation magic link.
  | "anon_laptop_invite_disabled"
  // Phase A — A5 operational floor: anon-only global daily $ ceiling
  // and per-IP daily container-spawn cap on /api/anon/run.
  | "anon_daily_usd_cap"
  | "anon_daily_runs_per_ip"
  | "ai_eval_sampling_enabled"
  | "contextual_tutor_enabled";

export interface SystemConfigEntry {
  value: boolean | number;
  source: "override" | "env";
  envDefault: boolean | number;
  setBy: string | null;
  setAt: string | null;
  reason: string | null;
  bounds:
    | { type: "number"; min: number; max: number; step: string }
    | { type: "boolean" };
}

export interface SystemConfigResponse {
  config: Record<SystemConfigKey, SystemConfigEntry>;
}

export interface AdminTutorModelCandidate {
  id: string;
  label: string;
  qualityStatus: "evaluated" | "unevaluated";
  qualityLabel: string;
  evalSetVersion: string | null;
  availableToPlatform: boolean;
  selectable: boolean;
  recommended: boolean;
  priceUsdPerMillion: { input: number; output: number } | null;
  costMultiplierVsRecommended: number | null;
  unavailableReason: string | null;
}

export interface AdminTutorModelState {
  current: {
    model: string;
    source: "override" | "fallback";
    setBy: string | null;
    setAt: string | null;
    reason: string | null;
    invalidOverride: string | null;
  };
  fallbackModel: string;
  candidates: AdminTutorModelCandidate[];
  discoveryError: string | null;
}

export type AdminAuditEventType =
  | "user_override_set"
  | "user_override_cleared"
  | "system_config_set"
  | "system_config_cleared"
  | "denylist_added"
  | "denylist_removed"
  | "tab_opened"
  | "rejected_attempt"
  // Phase 25 additions
  | "session_terminated"
  | "session_terminated_bulk"
  | "user_frozen"
  | "user_unfrozen"
  | "budget_watcher_reset"
  | "platform_auth_unstick"
  // Phase 26 additions
  | "user_force_signout"
  // Phase B8 governed evaluation review.
  | "eval_sample_viewed"
  | "eval_sample_reviewed"
  | "eval_sample_queue_resolved";

export type AdminAuditLogCategory = "changes" | "reviews" | "all";

export interface AdminAuditLogEntry {
  id: string;
  actorId: string;
  eventType: AdminAuditEventType;
  targetUserId: string | null;
  targetKey: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export interface AdminAuditLogResponse {
  entries: AdminAuditLogEntry[];
  nextCursor: string | null;
}

// Phase 27-v2.2 Fix 7b: anon-trial-path summary for the new admin tab.
// Read-only; the kill switch toggle goes through adminSetSystemConfig.
export interface AdminAnonSummary {
  generatedAt: string;
  /** Today's anon questions counted against quota (counts_toward_quota). */
  questionsToday: number;
  /** Distinct ip_hash values seen today. */
  distinctIpsToday: number;
  /** IPs that hit the per-IP daily cap today (count == anonDailyQuestionsPerIp). */
  exhaustedIpsToday: number;
  /** Per-IP cap and combined L4 daily cap (for context). */
  perIpDailyCap: number;
  /** Cumulative abuse signals since process boot (Counter snapshot). */
  abuseSignals: {
    anon_lesson_not_allowed: number;
    model_rejection: number;
    /** Phase A — A4: fabricated-API tripwire hits (all tutor routes). */
    tutor_suspect_api: number;
  };
  /** Unique privacy-bounded same-day cohorts. Every later stage is
   *  intersected with its prerequisite, so conversion stays <= 100%. */
  funnelEvents: {
    anon_page_view: number;
    anon_first_run: number;
    anon_lesson_completed: number;
    anon_wall_opened: number;
    anon_signup_completed: number;
    anon_lesson2_reached: number;
  };
  distributionChannels: Array<{
    source: "direct" | "organic" | "share";
    anon_page_view: number;
    anon_first_run: number;
    anon_lesson_completed: number;
    anon_signup_completed: number;
    anon_lesson2_reached: number;
  }>;
  killSwitch: {
    /** True if /api/anon/* is currently enabled. */
    enabled: boolean;
    /** "override" if system_config has a row, "env" otherwise. */
    source: "override" | "env";
    setBy: string | null;
    setAt: string | null;
    reason: string | null;
  };
}

// Phase 25: dashboard snapshot.
export interface AdminDashboardSnapshot {
  generatedAt: string;
  sessions: {
    /** Total local active = authed + anon. */
    local: number;
    /** Authed-only local (from sessionManager). */
    localAuthed: number;
    /** Anon ephemeral local sessions in flight. */
    localAnon: number;
    /** Total ACI active = authed + anon. */
    aci: number;
    /** Authed-only ACI. */
    aciAuthed: number;
    /** Anon ACI in flight when overflow routes anon. */
    aciAnon: number;
    total: number;
    capLocal: number;
    capAbsolute: number;
    counterDrift: number;
  };
  aci: {
    enabled: boolean;
    costTrackerState: "hydrated" | "degraded";
    spentTodayUsd: number;
    dailyUsdCap: number;
    activeSessions: number;
    configRefreshAgeMs: number | null;
  };
  freeTier: {
    enabled: boolean;
    spentTodayUsd: number;
    /** Phase 27-v2.2 Fix 7a — authed-only spend today; sums with
     *  spentTodayUsdAnon to spentTodayUsd. */
    spentTodayUsdAuthed: number;
    /** Phase 27-v2.2 Fix 7a — anon-only spend today. */
    spentTodayUsdAnon: number;
    dailyUsdCap: number;
    lastFiredKey: string | null;
  };
  queues: {
    dockerExecInflight: number;
    dockerExecQueued: number;
    renderActive: number;
    renderWaiting: number;
  };
  /** Phase A — A5: projected monthly burn (fixed infra baseline + AI
   *  spend extrapolated from the trailing 7 days). Directional. */
  burn: {
    infraMonthlyUsd: number;
    aiSpendLast7dUsd: number;
    aiDailyAvgUsd: number;
    projectedMonthlyUsd: number;
  };
  health: {
    db: "ok" | "fail";
    platformAuth: "ok" | "failed";
    platformAuthSinceMs: number | null;
  };
  bootId: string;
  rates: {
    httpResponses: Record<string, number>;
    aciSpawnAttempts: Record<string, number>;
  };
}

export interface AdminSession {
  sessionId: string;
  userId: string;
  userEmail: string | null;
  backend: "local" | "aci";
  ageMs: number;
  lastSeenMs: number;
  selectedModel: string | null;
}

export interface AdminSessionsResponse {
  sessions: AdminSession[];
  total: number;
}

export interface AdminEmailLogEntry {
  id: string;
  userId: string;
  kind: string;
  toEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  acsOpId: string | null;
  sentAt: string;
  capabilitiesRedacted: true;
}

export interface AdminEmailLogResponse {
  entries: AdminEmailLogEntry[];
  nextCursor: string | null;
}

export interface AdminBudgetWatcherState {
  lastFiredKey: string | null;
  dailyCapUsd: number;
  spentTodayUsd: number;
}

export interface AdminEvalSample {
  id: string;
  model: string;
  language: string;
  courseId: string;
  lessonId: string;
  intent: string;
  tutorStage: string;
  questionRedacted: string;
  responseRedacted: string;
  contentFingerprint: string;
  fileCount: number;
  sourceBytesBucket: string;
  historyTurnCount: number;
  hadRunResult: boolean;
  runErrorType: string | null;
  sectionKeys: string[];
  redactionCounts: { code: number; sensitive: number; identifiers: number };
  disposition: "pending_review" | "review_complete" | "synthesis_queued" | "rejected";
  reviewCount: number;
  distinctVerdictCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface AdminEvalSynthesisQueueItem {
  id: string;
  sampleId: string;
  sourceFingerprint: string;
  reviewCount: number;
  distinctVerdictCount: number;
  state: "pending_synthesis" | "synthetic_case_authored" | "rejected";
  syntheticCaseId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminPlatformAuthState {
  failed: boolean;
  sinceMs: number | null;
}

// Phase 21B: learning streak.
export interface UserStreakResponse {
  current: number;
  longest: number;
  lastActiveDate: string | null;
  lastFreezeUsed: string | null;
  isActiveToday: boolean;
  isAtRisk: boolean;
  resetAtUtc: string;
  freezeActive: boolean;
  wasFirstToday: boolean;
  freezeUsedToday: boolean;
}

export interface StreakHistoryResponse {
  /** UTC dates 'YYYY-MM-DD', oldest → newest, length = days. */
  windowDates: string[];
  /** Subset of windowDates where qualifying activity was recorded. */
  activeDates: string[];
  /** Subset of windowDates where the freeze covered a missed day. */
  freezeUsedDates: string[];
  /** Today's UTC date. */
  todayUtc: string;
}

// Phase 21C: shared lesson completions (cinematic share artifact).
export type ShareMastery = "strong" | "okay" | "shaky";

export interface SharedLessonCompletion {
  shareToken: string;
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
  mastery: ShareMastery;
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
  ogImageUrl: string | null;
  /** Phase 21C-ext: 9:16 Story-format image (1080×1920). Null until
   *  the fire-and-forget render+upload pipeline lands; the
   *  ShareDialog polls until this becomes non-null. */
  ogStoryImageUrl: string | null;
  viewCount: number;
  createdAt: string;
}

// Post-audit: lesson title / order / course title / total are NOT
// part of the wire schema anymore. The backend looks them up
// canonically from the published course catalog (defends against
// brand-impersonation shares).
export interface CreateShareBody {
  courseId: string;
  lessonId: string;
  mastery: ShareMastery;
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
}

export interface OwnerShare {
  shareToken: string;
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  displayName: string | null;
  codeSnippet: string;
  mastery: ShareMastery;
  timeSpentMs: number;
  attemptCount: number;
  viewCount: number;
  url: string;
  ogImageUrl: string | null;
  ogStoryImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  revision: number;
}

// Phase 21A: saved tutor messages.
export interface SavedTutorMessage {
  id: string;
  courseId: string | null;
  lessonId: string | null;
  exerciseId: string | null;
  messageId: string;
  role: "assistant";
  content: string;
  sections: Record<string, unknown> | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedTutorScope {
  courseId: string | null;
  lessonId: string | null;
  exerciseId: string | null;
}

export interface SaveTutorMessageBody extends SavedTutorScope {
  messageId: string;
  content: string;
  sections?: Record<string, unknown> | null;
  model?: string | null;
}

export const api = {
  startSession: () =>
    post<{ sessionId: string; backendBootId?: string }>("/api/session"),
  resumeSession: () =>
    post<{ sessionId: string; backendBootId?: string }>("/api/session/resume"),
  rebindSession: (sessionId: string) =>
    post<{ sessionId: string; reused: boolean; backendBootId?: string }>(
      "/api/session/rebind",
      { sessionId },
    ),
  // Returns a result object so callers (the heartbeat loop) can distinguish
  // 404 "session is gone" from transient network errors without parsing
  // thrown messages.
  pingSession: async (
    sessionId: string,
  ): Promise<
    | { ok: true; backendBootId?: string }
    | {
        ok: false;
        status: number;
        error: string;
        backendBootId?: string;
      }
  > => {
    const ctrl = registerSessionRequest(sessionId);
    try {
      const res = await authenticatedFetch("/api/session/ping", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify({ sessionId }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as {
          backendBootId?: string;
        } | null;
        return { ok: true, backendBootId: body?.backendBootId };
      }
      const text = await res.text().catch(() => "");
      // QA-L5: a 404 that comes from a cold backend includes a bootId that
      // differs from the one the frontend cached on its last successful
      // start/rebind. Parse it out of the JSON body so the heartbeat hook
      // can diff them without string-sniffing.
      let backendBootId: string | undefined;
      try {
        const body = JSON.parse(text) as { backendBootId?: string };
        backendBootId = body.backendBootId;
      } catch {
        /* body wasn't JSON (e.g. proxy HTML) — leave bootId undefined */
      }
      return {
        ok: false,
        status: res.status,
        error: text || `HTTP ${res.status}`,
        backendBootId,
      };
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    } finally {
      releaseSessionRequest(sessionId, ctrl);
    }
  },
  endSession: (sessionId: string) => post<{ ok: boolean }>("/api/session/end", { sessionId }),
  sessionStatus: async (sessionId: string) => {
    const ctrl = registerSessionRequest(sessionId);
    try {
      const path = `/api/session/${sessionId}/status`;
      const res = await authenticatedFetch(path, {
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await throwApiError(res, path);
      }
      return (await res.json()) as {
        alive: boolean;
        containerAlive: boolean;
        lastSeen: number;
      };
    } finally {
      releaseSessionRequest(sessionId, ctrl);
    }
  },
  health: () => get<{ ok: boolean; uptime: number }>("/api/health"),
  snapshotProject: async (sessionId: string, files: ProjectFile[]) => {
    const ctrl = registerSessionRequest(sessionId);
    try {
      const res = await authenticatedFetch("/api/project/snapshot", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify({ sessionId, files }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await throwApiError(res, "/api/project/snapshot");
      }
      return (await res.json()) as { ok: boolean; fileCount: number };
    } finally {
      releaseSessionRequest(sessionId, ctrl);
    }
  },
  execute: async (sessionId: string, language: Language, stdin?: string) => {
    const ctrl = registerSessionRequest(sessionId);
    try {
      const res = await authenticatedFetch("/api/execute", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify({ sessionId, language, stdin }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await throwApiError(res, "/api/execute");
      }
      return (await res.json()) as RunResult;
    } finally {
      releaseSessionRequest(sessionId, ctrl);
    }
  },
  cancelExecution: async (sessionId: string): Promise<void> => {
    const path = "/api/execute/cancel";
    const res = await authenticatedFetch(path, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) await throwApiError(res, path);
  },
  /**
   * Phase 27-v2.1 — anon (unauthed) one-shot Python execution. Used by
   * useLessonRunner when LessonPage is in mode="anon" (the /try/
   * trial flow). The backend route at `/api/anon/run` spawns an
   * ephemeral container per request — no sessionId, no per-user
   * snapshot store. Subject to ENABLE_ANON_LESSON kill switch +
   * sessionCreateLimit (30/min/IP).
   *
   * The body shape mirrors the authed runProject path: `{ language,
   * files, stdin? }`. No CSRF / Authorization required (route is
   * unauthed by design); the kill switch + per-IP rate limits are
   * the load-bearing defenses.
   */
  runAnon: async (
    language: Language,
    files: ProjectFile[],
    stdin?: string,
  ) => {
    const controller = new AbortController();
    anonRunAbortRegistry.add(controller);
    try {
      const res = await fetch(`${API_BASE}/api/anon/run`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify({ language, files, stdin }),
        signal: controller.signal,
      });
      if (!res.ok) {
        await throwApiError(res, "/api/anon/run");
      }
      return (await res.json()) as RunResult;
    } finally {
      anonRunAbortRegistry.delete(controller);
    }
  },

  deleteAnonEvalSamples: (subjectToken: string) =>
    delJson<{ ok: true }>("/api/anon/eval-samples", { subjectToken }),

  // Phase A — A2 (device contract): magic-link graduation handoff.
  // Returns the URL on success so the dialog can also render a QR that
  // an out-of-band laptop camera can scan without waiting for email
  // delivery. The backend never returns the raw email or token-source
  // beyond what the caller already supplied — see `anonLaptopInvite.ts`.
  createAnonLaptopInvite: async (body: {
    email: string;
    code: string;
    name: string | null;
  }): Promise<{ ok: true; url: string; warn?: "EMAIL_SEND_FAILED" }> => {
    const res = await fetch(`${API_BASE}/api/anon/laptop-link`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Pass structured error codes through so the dialog can map
      // them to user-facing copy: "rate-limited", "trial paused", etc.
      await throwApiError(res, "/api/anon/laptop-link");
    }
    return (await res.json()) as {
      ok: true;
      url: string;
      warn?: "EMAIL_SEND_FAILED";
    };
  },

  // Companion redemption call. Used by /start?invite=<token> to fetch
  // the lesson-1 code + name and re-stash them before forwarding to
  // signup. Single-use server-side — a second call with the same
  // token returns 410 INVITE_USED.
  redeemAnonLaptopInvite: async (
    token: string,
  ): Promise<{ code: string; name: string | null }> => {
    const res = await fetch(`${API_BASE}/api/anon/laptop-link/redeem`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      await throwApiError(res, "/api/anon/laptop-link/redeem");
    }
    return (await res.json()) as { code: string; name: string | null };
  },

  // Phase A — A6 (memory v0): fire-and-forget concept-tag write for
  // the anon path. AnonLessonPage calls this when LessonCompletePanel
  // mounts — the server reads the lesson's tags from the catalog and
  // writes ip_hash-keyed rows. Errors are silent at the call site;
  // the authed-side ledger write at handoff time is the safety net.
  postAnonConceptTag: async (body: {
    courseId: "python-fundamentals";
    lessonId: "hello-world";
  }): Promise<void> => {
    try {
      await fetch(`${API_BASE}/api/anon/concept-tag`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      // Network failure — fail-soft, the authed-side ledger write at
      // handoff covers the gap.
    }
  },

  // Phase A — A3 (anon-share unlock): create a share artifact for an
  // anon learner (no userId). The server returns a public `/s/:token`
  // URL that anyone can open without signup — the K-factor lever the
  // pre-A3 wall path was eating. Body shape mirrors the authed POST
  // /api/shares except courseId/lessonId are literals (server allowlist
  // hard-locks anon to lesson 1).
  createAnonShare: async (body: {
    courseId: "python-fundamentals";
    lessonId: "hello-world";
    mastery: "strong" | "okay" | "shaky";
    timeSpentMs: number;
    attemptCount: number;
    codeSnippet: string;
    displayName: string | null;
  }): Promise<{ shareToken: string; url: string }> => {
    const res = await fetch(`${API_BASE}/api/anon/shares`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await throwApiError(res, "/api/anon/shares");
    }
    return (await res.json()) as { shareToken: string; url: string };
  },
  executeTests: async (
    sessionId: string,
    language: Language,
    tests: FunctionTest[],
    sourceChecks: SourceCheck[] = [],
  ) => {
    const ctrl = registerSessionRequest(sessionId);
    try {
      const res = await authenticatedFetch("/api/execute/tests", {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify({ sessionId, language, tests, sourceChecks }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await throwApiError(res, "/api/execute/tests");
      }
      return (await res.json()) as ExecuteTestsResponse;
    } finally {
      releaseSessionRequest(sessionId, ctrl);
    }
  },

  // ── Phase 18b user-data endpoints ─────────────────────────────────
  getPreferences: () => get<UserPreferences>("/api/user/preferences"),
  patchPreferences: (body: UserPreferencesPatch) =>
    patch<UserPreferences>("/api/user/preferences", body),
  listCourseProgress: () =>
    get<{ courses: ServerCourseProgress[] }>("/api/user/courses"),
  patchCourseProgress: (courseId: string, body: ServerCoursePatch) =>
    patch<ServerCourseProgress>(
      `/api/user/courses/${encodeURIComponent(courseId)}`,
      body,
    ),
  deleteCourseProgress: (courseId: string) =>
    del<{ course: boolean; lessons: number }>(
      `/api/user/courses/${encodeURIComponent(courseId)}`,
    ),
  listLessonProgress: (courseId?: string) => {
    const q = courseId ? `?courseId=${encodeURIComponent(courseId)}` : "";
    return get<{ lessons: ServerLessonProgress[] }>(`/api/user/lessons${q}`);
  },
  patchLessonProgress: (
    courseId: string,
    lessonId: string,
    body: ServerLessonPatch,
  ) =>
    patch<ServerLessonProgress>(
      `/api/user/lessons/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}`,
      body,
    ),
  saveLessonDraft: (
    courseId: string,
    lessonId: string,
    body: {
      code: Record<string, string>;
      expectedRevision: number;
      writerId: string;
    },
  ) =>
    put<ServerLessonProgress>(
      `/api/user/lessons/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}/draft`,
      body,
    ),
  resetLessonProgress: (courseId: string, lessonId: string) =>
    del<{ reset: ServerLessonProgress; course: ServerCourseProgress }>(
      `/api/user/lessons/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}`,
    ),
  resetPracticeProgress: (courseId: string, lessonId: string) =>
    del<ServerLessonProgress>(
      `/api/user/lessons/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}/practice`,
    ),
  getConceptMemory: (courseId: string) =>
    get<ConceptMemoryResponse>(
      `/api/user/memory?courseId=${encodeURIComponent(courseId)}`,
    ),
  getMemoryWarmup: (courseId: string, lessonId: string) => {
    const query = new URLSearchParams({ courseId, lessonId });
    return get<{ warmup: MemoryWarmupPrompt | null }>(
      `/api/user/memory/warmup?${query.toString()}`,
    );
  },
  answerMemoryWarmup: (
    episodeId: string,
    body: { requestId: string; choiceIndex: number },
  ) =>
    post<MemoryWarmupAnswer>(
      `/api/user/memory/warmup/${encodeURIComponent(episodeId)}/answer`,
      body,
    ),
  // P-H4: batch heartbeat flush. Items are additive per-lesson delta ms;
  // the backend adds each to the existing time_spent_ms. Used by the
  // useLessonLoader tick loop + pagehide flush path. Returns {written} so
  // tests can assert the DB saw the bump; the hook itself doesn't care.
  sendLessonHeartbeat: (
    items: Array<{ courseId: string; lessonId: string; deltaMs: number }>,
  ) =>
    post<{ written: number }>(`/api/user/lessons/heartbeat`, { items }),
  getEditorProject: () => get<EditorProjectResponse>("/api/user/editor-project"),
  saveEditorProject: (body: EditorProjectPayload) =>
    put<EditorProjectResponse>("/api/user/editor-project", body),

  // Phase 21B: learning streak — read-only; writes are inline server-side
  // from any qualifying-action handler (lesson PATCH, ai/ask/stream).
  getUserStreak: () => get<UserStreakResponse>("/api/user/streak"),
  getStreakHistory: (days: number = 14) =>
    get<StreakHistoryResponse>(`/api/user/streak/history?days=${days}`),

  // Phase 21A: saved tutor messages — per (course, lesson, exercise) scope.
  // Editor-scope saves use null for all three.
  listSavedTutorMessages: (scope: SavedTutorScope) => {
    const qs = new URLSearchParams({
      courseId: scope.courseId ?? "null",
      lessonId: scope.lessonId ?? "null",
      exerciseId: scope.exerciseId ?? "null",
    });
    return get<{ messages: SavedTutorMessage[] }>(
      `/api/user/saved-tutor-messages?${qs.toString()}`,
    );
  },
  listAllSavedTutorMessages: () =>
    get<{ messages: SavedTutorMessage[] }>("/api/user/saved-tutor-messages/all"),
  saveTutorMessage: (body: SaveTutorMessageBody) =>
    post<{ saved: SavedTutorMessage }>("/api/user/saved-tutor-messages", body),
  deleteSavedTutorMessage: (id: string) =>
    del<{ ok: boolean }>(
      `/api/user/saved-tutor-messages/${encodeURIComponent(id)}`,
    ),

  // Phase 21C: cinematic share. createShare/revokeShare are authed +
  // mutating; getShare is anonymous-readable for the /s/:token route.
  createShare: (body: CreateShareBody) =>
    post<{ shareToken: string; url: string }>("/api/shares", body),
  getShare: (token: string) =>
    get<SharedLessonCompletion>(
      `/api/shares/${encodeURIComponent(token)}`,
    ),
  revokeShare: (token: string) =>
    del<{ ok: boolean }>(`/api/shares/${encodeURIComponent(token)}`),
  // "Have I already shared this lesson?" — owner-scoped lookup. Returns
  // 404 when no active share exists for this (course, lesson). The dialog calls this on
  // open: 200 → jump straight to created state with the existing token,
  // 404 → compose state for a fresh share.
  getMyShareForLesson: (courseId: string, lessonId: string) =>
    get<OwnerShare>(
      `/api/shares/mine?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lessonId)}`,
    ),
  listMyShares: () => get<{ shares: OwnerShare[] }>("/api/shares/mine/all"),
  updateShare: (
    token: string,
    body: { displayName?: string | null; refreshSnapshot?: boolean },
  ) =>
    patch<OwnerShare>(`/api/shares/${encodeURIComponent(token)}`, body),
  rotateShare: (token: string) =>
    post<OwnerShare>(`/api/shares/${encodeURIComponent(token)}/rotate`, {}),

  // Phase 20-P0 #9: DELETE with a body for the confirm-email guard. The
  // generic `del<T>` helper doesn't send a body; inline the fetch so we
  // don't complicate the helper surface for a single callsite.
  deleteAccount: async (confirmEmail: string): Promise<{ ok: boolean }> => {
    const path = "/api/user/account";
    const res = await authenticatedFetch(path, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify({ confirmEmail }),
    });
    if (!res.ok) {
      await throwApiError(res, path);
    }
    return res.json();
  },
  validateOpenAIKey: (key: string) =>
    post<{ valid: boolean; error?: string }>("/api/ai/validate-key", { key }),
  saveOpenAIKey: (key: string) =>
    put<{ ok: boolean }>("/api/user/openai-key", { key }),
  deleteOpenAIKey: () => del<{ ok: boolean }>("/api/user/openai-key"),
  // Phase 18e: the key is stored server-side now; these routes look it up
  // via the authenticated userId, so the client no longer forwards one.
  summarizeHistory: (body: { model?: string; history: AIMessage[] }) =>
    post<{ summary: string }>("/api/ai/summarize", {
      ...body,
      requestId: crypto.randomUUID(),
    }),
  listOpenAIModels: () => get<{ models: AIModel[] }>("/api/ai/models"),
  cancelAIAsk: async (
    requestId: string,
    endpoint = "/api/ai/ask/cancel",
  ): Promise<void> => {
    const res = await authenticatedFetch(endpoint, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify({ requestId }),
    });
    if (!res.ok) await throwApiError(res, endpoint);
  },

  // Phase 20-P1: global feedback channel. Body-or-mood is required (backend
  // refine()); diagnostics is opt-in and passed through verbatim. Returns
  // the row id so the UI can reference it in the thank-you screen. The
  // lesson-end chip uses this with `{ body: "", mood, lessonId }` to persist
  // a mood signal even when the learner doesn't type anything.
  // Phase 20-P4: /api/user/ai-status — UI reads this to decide whether to
  // render FreeTierPill (source=platform), the existing UsageChip toolbar
  // (source=byok), or the ExhaustionCard (source=none / free_exhausted).
  getAIStatus: () =>
    get<AIStatusResponse>("/api/user/ai-status"),
  getAnonAIStatus: () =>
    get<{ contextualTutorEnabled: boolean }>("/api/anon/ai-status"),
  // Exhaustion card telemetry — all three button outcomes feed this counter.
  // Both endpoints return 204 so we can't go through `post<T>` (which parses
  // JSON). Inline fetch with the shared auth + CSRF headers.
  reportExhaustionClick: async (
    outcome: "dismissed" | "clicked_byok" | "clicked_paid_interest",
  ): Promise<void> => {
    const res = await authenticatedFetch("/api/user/ai-exhaustion-click", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
      body: JSON.stringify({ outcome }),
    });
    if (!res.ok) {
      await throwApiError(res, "/api/user/ai-exhaustion-click");
    }
  },
  // Willingness-to-pay signal. Server reads email/display_name from the
  // auth session; the client sends no body.
  submitPaidAccessInterest: async (): Promise<void> => {
    const res = await authenticatedFetch("/api/user/paid-access-interest", {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER },
    });
    if (!res.ok) {
      await throwApiError(res, "/api/user/paid-access-interest");
    }
  },
  // Round 5: user-initiated withdrawal ("clicked by mistake"). Deletes the
  // row; the next /ai-status refetch reports hasShownPaidInterest=false and
  // every mounted surface restores the CTA in lockstep.
  withdrawPaidAccessInterest: async (): Promise<void> => {
    const res = await authenticatedFetch("/api/user/paid-access-interest", {
      method: "DELETE",
      headers: { ...CSRF_HEADER },
    });
    if (!res.ok) {
      await throwApiError(res, "/api/user/paid-access-interest");
    }
  },

  // P-3: triggers a download of a JSON bundle containing every row the
  // logged-in user owns across public.*. The backend sets the
  // Content-Disposition; we turn the Blob into an <a download> click so the
  // browser's Downloads UX kicks in (no new tab, no inline render).
  downloadUserExport: async (): Promise<void> => {
    const res = await authenticatedFetch("/api/user/export", {
      method: "GET",
    });
    if (!res.ok) {
      await throwApiError(res, "/api/user/export");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codetutor-export-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  submitFeedback: (body: {
    body: string;
    category: "bug" | "idea" | "other";
    diagnostics?: Record<string, string | number | boolean | null>;
    mood?: "good" | "okay" | "bad" | null;
    lessonId?: string | null;
  }) => post<{ id: string; createdAt: string }>("/api/feedback", body),
  askAIStream: async (
    body: AskStreamRequest,
    handlers: AskStreamHandlers,
    options?: {
      /**
       * Phase 27-v2.1 — caller-overridable endpoint. Defaults to the
       * authed `/api/ai/ask/stream`. Anon callers (LessonPage in
       * mode="anon") pass `/api/anon/ai/ask/stream` so the trial path
       * uses the unauthed AI surface (subject to L_anon per-IP cap).
       * Auth headers are still attempted; the unauthed route ignores
       * them on its end (no Authorization required).
       */
      endpoint?: string;
    },
  ): Promise<void> => {
    // QA-H2: no-chunk watchdog. If the SSE stream produces no data for
    // STREAM_STALL_MS, abort the fetch and surface it as an error — a
    // silently-dead TCP connection would otherwise leave the UI spinner
    // up indefinitely (caddy + socket-proxy reset tends to manifest this
    // way). Each successful read resets the timer.
    const STREAM_STALL_MS = 30_000;
    // Chain the caller's signal into our own controller so the watchdog
    // can abort independently of the caller. AbortSignal.any exists but
    // isn't in every target; wire it manually.
    const streamCtrl = new AbortController();
    const bridgeAbort = () => streamCtrl.abort();
    if (handlers.signal) {
      if (handlers.signal.aborted) streamCtrl.abort();
      else handlers.signal.addEventListener("abort", bridgeAbort, { once: true });
    }
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const kickWatchdog = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        streamCtrl.abort();
      }, STREAM_STALL_MS);
    };
    const clearWatchdog = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
      if (handlers.signal) handlers.signal.removeEventListener("abort", bridgeAbort);
    };

    let res: Response;
    try {
      const endpoint = options?.endpoint ?? "/api/ai/ask/stream";
      res = await authenticatedFetch(endpoint, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER },
        body: JSON.stringify(body),
        signal: streamCtrl.signal,
      });
    } catch (err) {
      clearWatchdog();
      handlers.onError((err as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
      clearWatchdog();
      const text = await res.text().catch(() => "");
      handlers.onError(text || `HTTP ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    // QA gap #2: the reader can EOF cleanly without a terminal `{done:true}`
    // frame if the reverse proxy resets mid-stream (caddy flap, socket-proxy
    // restart). Track whether any terminal frame was seen; if the loop exits
    // without one, surface an error so the retry affordance renders rather
    // than silently clearing the asking-indicator.
    let terminalFrameSeen = false;
    kickWatchdog();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        kickWatchdog();
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""));
          const data = dataLines.join("\n");
          if (!data) continue;
          let evt: {
            delta?: string;
            done?: boolean;
            error?: string;
            raw?: string;
            sections?: TutorSections;
            usage?: TokenUsage;
            tutorProgressToken?: string;
            remainingToday?: number | null;
            countsTowardQuota?: boolean;
          };
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }
          if (evt.error) {
            terminalFrameSeen = true;
            clearWatchdog();
            handlers.onError(evt.error);
            return;
          }
          if (evt.delta !== undefined) {
            handlers.onDelta(evt.delta);
          }
          if (evt.done) {
            terminalFrameSeen = true;
            clearWatchdog();
            handlers.onDone(
              evt.raw ?? "",
              evt.sections ?? {},
              evt.usage,
              evt.tutorProgressToken,
              evt.remainingToday,
              evt.countsTowardQuota,
            );
            return;
          }
        }
      }
      clearWatchdog();
      if (!terminalFrameSeen) {
        // Stream closed cleanly but without a done/error frame — proxy
        // reset, backend crash, or truncated response. Surface this so the
        // retry affordance renders; otherwise the learner sees the asking
        // indicator clear with no output and no way to recover.
        handlers.onError("stream ended without completion — please retry");
      }
    } catch (err) {
      clearWatchdog();
      // QA-H2: when the watchdog fires we abort streamCtrl, which surfaces
      // here as an AbortError. Distinguish that from a caller-initiated
      // abort (user clicked Stop) — the former is a user-visible error,
      // the latter is expected.
      if ((err as Error).name === "AbortError") {
        if (stalled) handlers.onError("stream stalled — no response for 30s");
        return;
      }
      handlers.onError((err as Error).message);
    }
  },

  // ----------------------------------------------------------------------
  // Phase 20-P5: admin surface. All routes are gated server-side by
  // adminGuard; the client adds them as a flat namespace inside `api` so
  // call sites read as `api.adminListUsers()` etc.
  // ----------------------------------------------------------------------

  adminStatus: () => get<{ isAdmin: boolean }>("/api/user/admin-status"),

  adminListUsers: (opts: { page?: number; perPage?: number; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.page) qs.set("page", String(opts.page));
    if (opts.perPage) qs.set("perPage", String(opts.perPage));
    if (opts.search) qs.set("search", opts.search);
    const suffix = qs.toString() ? `?${qs}` : "";
    return get<AdminUsersListResponse>(`/api/admin/users${suffix}`);
  },

  adminGetUser: (userId: string) =>
    get<AdminUserDetailResponse>(`/api/admin/users/${encodeURIComponent(userId)}`),

  adminSetUserOverride: (
    userId: string,
    body: {
      dailyQuestionsCap: number | null;
      dailyUsdCap: number | null;
      lifetimeUsdCap: number | null;
      reason: string;
    },
  ) =>
    putJson<{ override: AdminUserOverride }>(
      `/api/admin/users/${encodeURIComponent(userId)}/override`,
      body,
    ),

  adminClearUserOverride: (userId: string) =>
    del<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/override`),

  adminGetSystemConfig: () =>
    get<SystemConfigResponse>("/api/admin/system-config"),

  adminGetTutorModel: () =>
    get<AdminTutorModelState>("/api/admin/tutor-model"),

  adminSetTutorModel: (body: {
    model: string;
    reason: string;
    expectedSetAt: string | null;
    confirmCostImpact?: true;
  }) => putJson<{ current: AdminTutorModelState["current"] }>(
    "/api/admin/tutor-model",
    body,
  ),

  adminClearTutorModel: (body: { reason: string; expectedSetAt: string | null }) =>
    delJson<{ current: AdminTutorModelState["current"] }>(
      "/api/admin/tutor-model",
      body,
    ),

  adminSetSystemConfig: (
    key: SystemConfigKey,
    body: {
      value: boolean | number;
      reason: string;
      confirmDisable?: string;
      confirmReduction?: string;
      // Phase 27-v2.2 Fix 7c — required when toggling
      // anon_lesson_enabled to false. See PHRASE_DISABLE_ANON in
      // ProjectCapsSection / PHRASE_DISABLE_ANON_LESSON in admin.ts.
      confirmAnonDisable?: string;
    },
  ) =>
    putJson<SystemConfigEntry & { key: SystemConfigKey }>(
      `/api/admin/system-config/${encodeURIComponent(key)}`,
      body,
    ),

  adminClearSystemConfig: (key: SystemConfigKey) =>
    del<{ ok: boolean; value: boolean | number; source: "env" }>(
      `/api/admin/system-config/${encodeURIComponent(key)}`,
    ),

  adminGetAuditLog: (
    opts: {
      cursor?: string;
      limit?: number;
      eventType?: string;
      category?: AdminAuditLogCategory;
      query?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.eventType) qs.set("eventType", opts.eventType);
    if (opts.category) qs.set("category", opts.category);
    if (opts.query) qs.set("query", opts.query);
    const suffix = qs.toString() ? `?${qs}` : "";
    return get<AdminAuditLogResponse>(`/api/admin/audit-log${suffix}`);
  },

  // ----------------------------------------------------------------------
  // Phase 25 admin additions
  // ----------------------------------------------------------------------

  adminGetDashboard: () => get<AdminDashboardSnapshot>("/api/admin/dashboard"),

  // Phase 27-v2.2 Fix 7b: admin anon-trial-path summary.
  adminGetAnonSummary: () =>
    get<AdminAnonSummary>("/api/admin/anon-summary"),

  adminListSessions: () => get<AdminSessionsResponse>("/api/admin/sessions"),

  adminKillSession: (
    sessionId: string,
    body: { reason: string; confirmKill: string },
  ) =>
    delJson<{ ok: boolean; sessionId: string }>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}`,
      body,
    ),

  adminKillSessionsByUser: (
    userId: string,
    body: { reason: string; confirmKill: string },
  ) =>
    delJson<{ ok: boolean; count: number; sessionIds: string[] }>(
      `/api/admin/sessions/by-user/${encodeURIComponent(userId)}`,
      body,
    ),

  adminSetDenylist: (userId: string, body: { reason: string }) =>
    putJson<{ denylist: AdminDenylistRow }>(
      `/api/admin/users/${encodeURIComponent(userId)}/denylist`,
      body,
    ),

  adminClearDenylist: (userId: string) =>
    del<{ ok: boolean }>(
      `/api/admin/users/${encodeURIComponent(userId)}/denylist`,
    ),

  adminFreezeUser: (
    userId: string,
    body: { reason: string; confirmFreeze: string },
  ) =>
    putJson<{ status: AdminDenylistRow }>(
      `/api/admin/users/${encodeURIComponent(userId)}/freeze`,
      body,
    ),

  adminUnfreezeUser: (userId: string) =>
    del<{ status: AdminDenylistRow }>(
      `/api/admin/users/${encodeURIComponent(userId)}/freeze`,
    ),

  // Phase 26 (audit H-1 / SRE F3.2): force-signout. Use AFTER demoting a
  // compromised admin (DELETE FROM user_roles) to invalidate their
  // existing JWT. Without this, their ~1h refresh window keeps them
  // authed for non-admin routes.
  adminForceSignOut: (
    userId: string,
    body: { reason: string; confirmSignout: string },
  ) =>
    post<{ ok: boolean; sessionsKilled: number; streamsAborted: number }>(
      `/api/admin/users/${encodeURIComponent(userId)}/force-signout`,
      body,
    ),

  adminListEmailLog: (
    opts: {
      cursor?: string;
      limit?: number;
      kind?: string;
      toEmailLike?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.kind) qs.set("kind", opts.kind);
    if (opts.toEmailLike) qs.set("toEmailLike", opts.toEmailLike);
    const suffix = qs.toString() ? `?${qs}` : "";
    return get<AdminEmailLogResponse>(`/api/admin/email-log${suffix}`);
  },

  adminListEmailLogKinds: () =>
    get<{ kinds: string[] }>("/api/admin/email-log/kinds"),

  adminGetBudgetWatcher: () =>
    get<AdminBudgetWatcherState>("/api/admin/budget-watcher"),

  adminResetBudgetWatcher: (body: { reason: string; confirmReset: string }) =>
    post<{ ok: boolean }>("/api/admin/budget-watcher/reset", body),

  adminGetPlatformAuth: () =>
    get<AdminPlatformAuthState>("/api/admin/platform-auth"),

  adminUnstickPlatformAuth: (body: { reason: string; confirmUnstick: string }) =>
    post<{ ok: boolean; wasFailed: boolean }>(
      "/api/admin/platform-auth/unstick",
      body,
    ),

  adminListEvalSamples: (disposition = "pending_review") =>
    get<{ samples: AdminEvalSample[]; nextCursor: string | null }>(
      `/api/admin/eval-samples?limit=100&disposition=${encodeURIComponent(disposition)}`,
    ),

  adminReviewEvalSample: (
    sampleId: string,
    body: {
      verdict: "pass" | "fail" | "ambiguous" | "reject_privacy";
      issueCodes: Array<
        | "factual_error"
        | "unhelpful"
        | "too_much_answer"
        | "poor_grounding"
        | "unsafe_content"
        | "redaction_concern"
        | "ambiguous_rubric"
      >;
      note?: string | null;
    },
  ) => put<{ ok: true }>(`/api/admin/eval-samples/${sampleId}/review`, body),

  adminListEvalSynthesisQueue: () =>
    get<{ items: AdminEvalSynthesisQueueItem[] }>(
      "/api/admin/eval-synthesis-queue?limit=100",
    ),

  adminResolveEvalSynthesisQueue: (
    queueId: string,
    body: {
      state: "synthetic_case_authored" | "rejected";
      syntheticCaseId?: string | null;
      reason: string;
    },
  ) => put<{ ok: true }>(`/api/admin/eval-synthesis-queue/${queueId}`, body),

  // Phase 27-v2: anon→authed handoff. Called from StartPage on first
  // mount after a freshly-signed-up user lands there from SignupPage
  // / AuthCallbackPage. Body comes from sessionStorage (see
  // anonStash.ts). Day 4 implements the idempotent writes:
  // lesson_progress (status=completed, last_code), course_progress
  // (in_progress, completedLessonIds), and user_preferences
  // (welcome_done + workspace_coach_done from stash flags). Returns
  // applied:true on first apply, applied:false when the lesson was
  // already complete (refresh-during-handoff or replay scenarios).
  postAnonHandoff: (body: AnonHandoffBody) =>
    post<AnonHandoffResponse>("/api/anon-handoff", body),

  // Phase 27-v2.2 Fix 6 — funnel telemetry. Fire-and-forget by design:
  // a failed POST must not break the UX. The backend's table is
  // 42P01-tolerant (telemetry drops if migration not applied), and the
  // route returns 204 on success. Caller does not await the result;
  // any thrown promise is swallowed so a network blip doesn't surface
  // to the user as a banner. Reason is only meaningful for
  // anon_wall_opened — the backend coerces it to null otherwise.
  postFunnelEvent: (
    event:
      | "anon_page_view"
      | "anon_first_run"
      | "anon_lesson_completed"
      | "anon_wall_opened"
      | "anon_signup_completed"
      | "anon_lesson2_reached",
    reason?: "save" | "next-lesson" | "exhausted" | "share" | "trial-paused",
  ): void => {
    // Fire-and-forget. We don't use the `post<T>` helper because:
    //   - That expects a JSON response body; the route returns 204.
    //   - That calls handle401 → supabase.auth.signOut on 401, which
    //     would cascade-reset stores. Telemetry is fire-and-forget by
    //     design — a server hiccup must NEVER drop the user's session.
    // Backend route is unauthed + no csrfGuard, so we ship just the
    // JSON content-type header. Direct fetch with .catch swallow keeps
    // the UX bulletproof on any failure.
    void fetch(`${API_BASE}/api/telemetry/event`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        event,
        reason,
        attribution: readDistributionAttribution(),
      }),
    }).catch(() => {
      /* swallow — telemetry must not break the UX */
    });
  },

  // Release 0A: explicit distribution outcomes. These are deliberately
  // separate from link creation: `share_completed` means the native share
  // sheet resolved, while copied/cancelled/dismissed retain their own signal.
  // The backend accepts only these two bounded enums and no token or code.
  postShareOutcome: (
    outcome: "copied" | "share_completed" | "cancelled" | "dismissed",
    surface: "authenticated" | "anonymous",
  ): void => {
    void fetch(`${API_BASE}/api/telemetry/share-outcome`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ outcome, surface }),
    }).catch(() => {
      /* telemetry is never part of the share UX success path */
    });
  },
};

export interface AnonHandoffBody {
  courseId: "python-fundamentals";
  lessonId: "hello-world";
  code: string;
  name: string | null;
  /**
   * Honest record of orientation surfaces that fired on the anon
   * path. Mirrored into user_preferences columns by the handoff
   * endpoint (welcome_done, workspace_coach_done). welcomeDone=true
   * is what suppresses /welcome cinematic + ?firstRun=1 choreography
   * post-signup; workspaceCoachDone is gated on Day 6 (false today
   * because the coach hasn't been mounted on anon yet).
   */
  flags: {
    welcomeDone: boolean;
    workspaceCoachDone: boolean;
  };
  evalSamplingSubjectToken?: string;
}

export interface AnonHandoffResponse {
  ok: true;
  applied: boolean;
  /** Day 1: stub === true; Day 4 onwards: stub === false. */
  stub?: boolean;
}

// PUT JSON helper (the existing post / patch helpers don't cover PUT,
// and admin routes use PUT for set-override / set-system-config).
async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await authenticatedFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...CSRF_HEADER },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}
