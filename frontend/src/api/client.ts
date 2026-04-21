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
// call site. The /api/health and /api/ai/validate-key routes are still
// callable pre-auth; they simply don't include the Authorization header if
// no session is present.
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
  updatedAt: string;
}

export interface UserPreferencesPatch {
  persona?: UserPreferences["persona"];
  openaiModel?: string | null;
  theme?: UserPreferences["theme"];
  welcomeDone?: boolean;
  workspaceCoachDone?: boolean;
  editorCoachDone?: boolean;
  uiLayout?: Record<string, unknown>;
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

export const api = {
  startSession: () => post<{ sessionId: string }>("/api/session"),
  rebindSession: (sessionId: string) =>
    post<{ sessionId: string; reused: boolean }>("/api/session/rebind", { sessionId }),
  // Returns a result object so callers (the heartbeat loop) can distinguish
  // 404 "session is gone" from transient network errors without parsing
  // thrown messages.
  pingSession: async (
    sessionId: string
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
    try {
      const auth = await authHeaders();
      const res = await fetch(`${API_BASE}/api/session/ping`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) return { ok: true };
      await handle401(res);
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    }
  },
  endSession: (sessionId: string) => post<{ ok: boolean }>("/api/session/end", { sessionId }),
  sessionStatus: (sessionId: string) =>
    get<{ alive: boolean; containerAlive: boolean; lastSeen: number }>(
      `/api/session/${sessionId}/status`
    ),
  health: () => get<{ ok: boolean; uptime: number }>("/api/health"),
  snapshotProject: (sessionId: string, files: ProjectFile[]) =>
    post<{ ok: boolean; fileCount: number }>("/api/project/snapshot", { sessionId, files }),
  execute: (sessionId: string, language: Language, stdin?: string) =>
    post<RunResult>("/api/execute", { sessionId, language, stdin }),
  executeTests: (sessionId: string, language: Language, tests: FunctionTest[]) =>
    post<ExecuteTestsResponse>("/api/execute/tests", { sessionId, language, tests }),

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
  getEditorProject: () => get<EditorProjectResponse>("/api/user/editor-project"),
  saveEditorProject: (body: EditorProjectPayload) =>
    put<EditorProjectResponse>("/api/user/editor-project", body),

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

  // Phase 20-P1: global feedback channel. Body is always non-empty plaintext;
  // diagnostics is opt-in and passed through verbatim (the client is the
  // authoritative shape). Returns the row id so the UI can mention it in
  // the thank-you screen (useful for support tickets that reference it).
  submitFeedback: (body: {
    body: string;
    category: "bug" | "idea" | "other";
    diagnostics?: Record<string, string | number | boolean | null>;
  }) => post<{ id: string; createdAt: string }>("/api/feedback", body),
  askAIStream: async (
    body: AskStreamRequest,
    handlers: AskStreamHandlers
  ): Promise<void> => {
    let res: Response;
    try {
      const auth = await authHeaders();
      res = await fetch(`${API_BASE}/api/ai/ask/stream`, {
        method: "POST",
        headers: { ...JSON_HEADERS, ...CSRF_HEADER, ...auth },
        body: JSON.stringify(body),
        signal: handlers.signal,
      });
    } catch (err) {
      handlers.onError((err as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
      await handle401(res);
      const text = await res.text().catch(() => "");
      handlers.onError(text || `HTTP ${res.status}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
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
            handlers.onError(evt.error);
            return;
          }
          if (evt.delta !== undefined) {
            handlers.onDelta(evt.delta);
          }
          if (evt.done) {
            handlers.onDone(evt.raw ?? "", evt.sections ?? {}, evt.usage);
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      handlers.onError((err as Error).message);
    }
  },
};
