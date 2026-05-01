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

// Read the response body once for an error path, then wrap it in ApiError.
// We also `console.error` the raw so the detail survives in devtools even
// though the user-facing alert shows only the friendly message.
async function throwApiError(res: Response, path: string): Promise<never> {
  const body = await res.text().catch(() => "");
  console.error(`[api] ${path} failed: ${res.status} ${body}`);
  throw new ApiError(res.status, body, path);
}

// Phase 18a: attach the Supabase access token to every backend request so
// the `authMiddleware` on the server side can identify the user. We fetch
// the session lazily per-request — the SDK caches and auto-refreshes, so
// `getSession()` returns synchronously from cache in the common path.
//
// `signOutOn401` centralises the "token is invalid" response: we clear the
// Supabase session (which triggers onAuthStateChange → RequireAuth → /login)
// and propagate the error up. This keeps stale-session handling out of every
// call site. /api/health is callable pre-auth; every other backend route
// (including /api/ai/validate-key — both UI call sites live behind
// RequireAuth) requires an Authorization header.
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function handle401(res: Response): Promise<void> {
  if (res.status !== 401) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* best-effort — the state listener will flush anyway */
  }
}

// QA-H3: registry of in-flight fetches keyed by sessionId so a rebind that
// returns a *different* id can abort them atomically. Without this, a
// snapshot/execute/status call fired before the rebind lands with the old
// sessionId in its body, the backend 404s it, and the UI flashes a spurious
// "session not found" error against a session that was just successfully
// recreated under a new id.
const sessionAbortRegistry = new Map<string, Set<AbortController>>();

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

async function post<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth, ...(extraHeaders ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { ...CSRF_HEADER, ...auth },
  });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

// Phase 25: DELETE-with-body. Some admin destructive endpoints
// (kill session, kill all-for-user) carry a phrase-confirm body even
// though the HTTP semantics are deletion.
async function delJson<T>(path: string, body: unknown): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...CSRF_HEADER, ...auth },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...auth, ...(extraHeaders ?? {}) } });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}

import type {
  AIMessage,
  AIModel,
  EditorSelection,
  Language,
  Persona,
  ProjectFile,
  RunResult,
  TokenUsage,
  TutorSections,
} from "../types";
import type { CompletionRule, FunctionTest, TestReport } from "../features/learning/types";

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
  lastCode?: Record<string, string> | null;
  lastOutput?: string | null;
  practiceCompletedIds?: string[];
  practiceExerciseCode?: Record<string, Record<string, string>>;
}

export interface EditorProjectPayload {
  language: string;
  files: Record<string, string>;
  activeFile: string | null;
  openTabs: string[];
  fileOrder: string[];
  stdin: string;
}

export interface EditorProjectResponse extends EditorProjectPayload {
  updatedAt: string;
}

export interface AskStreamRequest {
  model: string;
  question: string;
  files: ProjectFile[];
  activeFile?: string;
  language?: Language;
  lastRun?: RunResult | null;
  history: AIMessage[];
  stdin?: string | null;
  diffSinceLastTurn?: string | null;
  runsSinceLastTurn?: number;
  editsSinceLastTurn?: number;
  persona?: Persona;
  selection?: EditorSelection | null;
  lessonContext?: {
    courseId: string;
    lessonId: string;
    lessonTitle: string;
    language: Language;
    lessonObjectives: string[];
    teachesConceptTags: string[];
    usesConceptTags: string[];
    priorConcepts: string[];
    completionRules: CompletionRule[];
    studentProgressSummary: string;
    lessonOrder?: number;
    totalLessons?: number;
  } | null;
}

export interface AskStreamHandlers {
  onDelta(chunk: string): void;
  onDone(raw: string, sections: TutorSections, usage?: TokenUsage): void;
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
  | "aci_warm_max_pool_size";

export interface SystemConfigEntry {
  value: boolean | number;
  source: "override" | "env";
  envDefault: boolean | number;
  setBy: string | null;
  setAt: string | null;
  reason: string | null;
}

export interface SystemConfigResponse {
  config: Record<SystemConfigKey, SystemConfigEntry>;
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
  | "platform_auth_unstick";

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

// Phase 25: dashboard snapshot.
export interface AdminDashboardSnapshot {
  generatedAt: string;
  sessions: {
    local: number;
    aci: number;
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
    dailyUsdCap: number;
    lastFiredKey: string | null;
  };
  queues: {
    dockerExecInflight: number;
    dockerExecQueued: number;
    renderActive: number;
    renderWaiting: number;
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
      const auth = await authHeaders();
      const res = await fetch(`${API_BASE}/api/session/ping`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
        body: JSON.stringify({ sessionId }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as {
          backendBootId?: string;
        } | null;
        return { ok: true, backendBootId: body?.backendBootId };
      }
      await handle401(res);
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
      const auth = await authHeaders();
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/status`, {
        headers: { ...auth },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await handle401(res);
        await throwApiError(res, `/api/session/${sessionId}/status`);
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
      const auth = await authHeaders();
      const res = await fetch(`${API_BASE}/api/project/snapshot`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
        body: JSON.stringify({ sessionId, files }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await handle401(res);
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
      const auth = await authHeaders();
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
        body: JSON.stringify({ sessionId, language, stdin }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await handle401(res);
        await throwApiError(res, "/api/execute");
      }
      return (await res.json()) as RunResult;
    } finally {
      releaseSessionRequest(sessionId, ctrl);
    }
  },
  executeTests: async (
    sessionId: string,
    language: Language,
    tests: FunctionTest[],
  ) => {
    const ctrl = registerSessionRequest(sessionId);
    try {
      const auth = await authHeaders();
      const res = await fetch(`${API_BASE}/api/execute/tests`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
        body: JSON.stringify({ sessionId, language, tests }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        await handle401(res);
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
  // 404 when no share exists for this (course, lesson), or when the
  // most recent share predates the lesson's current completion (i.e.,
  // the lesson was reset+re-completed since). The dialog calls this on
  // open: 200 → jump straight to created state with the existing token,
  // 404 → compose state for a fresh share.
  getMyShareForLesson: (courseId: string, lessonId: string) =>
    get<{
      shareToken: string;
      url: string;
      ogImageUrl: string | null;
      ogStoryImageUrl: string | null;
      createdAt: string;
      displayName: string | null;
    }>(
      `/api/shares/mine?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lessonId)}`,
    ),

  // Phase 20-P0 #9: DELETE with a body for the confirm-email guard. The
  // generic `del<T>` helper doesn't send a body; inline the fetch so we
  // don't complicate the helper surface for a single callsite.
  deleteAccount: async (confirmEmail: string): Promise<{ ok: boolean }> => {
    const path = "/api/user/account";
    const auth = await authHeaders();
    const res = await fetch(`${API_BASE}${path}`, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
      body: JSON.stringify({ confirmEmail }),
    });
    if (!res.ok) {
      await handle401(res);
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
  summarizeHistory: (body: { model: string; history: AIMessage[] }) =>
    post<{ summary: string }>("/api/ai/summarize", body),
  listOpenAIModels: () => get<{ models: AIModel[] }>("/api/ai/models"),

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
  // Exhaustion card telemetry — all three button outcomes feed this counter.
  // Both endpoints return 204 so we can't go through `post<T>` (which parses
  // JSON). Inline fetch with the shared auth + CSRF headers.
  reportExhaustionClick: async (
    outcome: "dismissed" | "clicked_byok" | "clicked_paid_interest",
  ): Promise<void> => {
    const auth = await authHeaders();
    const res = await fetch(`${API_BASE}/api/user/ai-exhaustion-click`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
      body: JSON.stringify({ outcome }),
    });
    if (!res.ok) {
      await handle401(res);
      await throwApiError(res, "/api/user/ai-exhaustion-click");
    }
  },
  // Willingness-to-pay signal. Server reads email/display_name from the
  // auth session; the client sends no body.
  submitPaidAccessInterest: async (): Promise<void> => {
    const auth = await authHeaders();
    const res = await fetch(`${API_BASE}/api/user/paid-access-interest`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
    });
    if (!res.ok) {
      await handle401(res);
      await throwApiError(res, "/api/user/paid-access-interest");
    }
  },
  // Round 5: user-initiated withdrawal ("clicked by mistake"). Deletes the
  // row; the next /ai-status refetch reports hasShownPaidInterest=false and
  // every mounted surface restores the CTA in lockstep.
  withdrawPaidAccessInterest: async (): Promise<void> => {
    const auth = await authHeaders();
    const res = await fetch(`${API_BASE}/api/user/paid-access-interest`, {
      method: "DELETE",
      headers: { ...CSRF_HEADER, ...auth },
    });
    if (!res.ok) {
      await handle401(res);
      await throwApiError(res, "/api/user/paid-access-interest");
    }
  },

  // P-3: triggers a download of a JSON bundle containing every row the
  // logged-in user owns across public.*. The backend sets the
  // Content-Disposition; we turn the Blob into an <a download> click so the
  // browser's Downloads UX kicks in (no new tab, no inline render).
  downloadUserExport: async (): Promise<void> => {
    const auth = await authHeaders();
    const res = await fetch(`${API_BASE}/api/user/export`, {
      method: "GET",
      headers: { ...auth },
    });
    if (!res.ok) {
      await handle401(res);
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
    handlers: AskStreamHandlers
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
      const auth = await authHeaders();
      res = await fetch(`${API_BASE}/api/ai/ask/stream`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
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
      await handle401(res);
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
            handlers.onDone(evt.raw ?? "", evt.sections ?? {}, evt.usage);
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

  adminSetSystemConfig: (
    key: SystemConfigKey,
    body: {
      value: boolean | number;
      reason: string;
      confirmDisable?: string;
      confirmReduction?: string;
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
    opts: { cursor?: string; limit?: number; eventType?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.eventType) qs.set("eventType", opts.eventType);
    const suffix = qs.toString() ? `?${qs}` : "";
    return get<AdminAuditLogResponse>(`/api/admin/audit-log${suffix}`);
  },

  // ----------------------------------------------------------------------
  // Phase 25 admin additions
  // ----------------------------------------------------------------------

  adminGetDashboard: () => get<AdminDashboardSnapshot>("/api/admin/dashboard"),

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
};

// PUT JSON helper (the existing post / patch helpers don't cover PUT,
// and admin routes use PUT for set-override / set-system-config).
async function putJson<T>(path: string, body: unknown): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...CSRF_HEADER, ...auth },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await handle401(res);
    await throwApiError(res, path);
  }
  return res.json() as Promise<T>;
}
