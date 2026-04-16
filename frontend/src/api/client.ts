const JSON_HEADERS = { "Content-Type": "application/json" };

async function post<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(extraHeaders ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(path, { headers: extraHeaders });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

import type {
  AIAskResult,
  AIMessage,
  AIModel,
  Language,
  Persona,
  ProjectFile,
  RunResult,
  TutorSections,
} from "../types";

export interface AskStreamRequest {
  model: string;
  question: string;
  files: ProjectFile[];
  activeFile?: string;
  language?: string;
  lastRun?: RunResult | null;
  history: AIMessage[];
  stdin?: string | null;
  diffSinceLastTurn?: string | null;
  runsSinceLastTurn?: number;
  editsSinceLastTurn?: number;
  persona?: Persona;
}

export interface AskStreamHandlers {
  onDelta(chunk: string): void;
  onDone(raw: string, sections: TutorSections): void;
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
      const res = await fetch("/api/session/ping", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) return { ok: true };
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

  validateOpenAIKey: (key: string) =>
    post<{ valid: boolean; error?: string }>("/api/ai/validate-key", { key }),
  summarizeHistory: (
    key: string,
    body: { model: string; history: AIMessage[] }
  ) => post<{ summary: string }>("/api/ai/summarize", body, { "X-OpenAI-Key": key }),
  listOpenAIModels: (key: string) =>
    get<{ models: AIModel[] }>("/api/ai/models", { "X-OpenAI-Key": key }),
  askAI: (
    key: string,
    body: {
      model: string;
      question: string;
      files: ProjectFile[];
      activeFile?: string;
      language?: string;
      lastRun?: RunResult | null;
      history: AIMessage[];
    }
  ) => post<AIAskResult>("/api/ai/ask", body, { "X-OpenAI-Key": key }),

  askAIStream: async (
    key: string,
    body: AskStreamRequest,
    handlers: AskStreamHandlers
  ): Promise<void> => {
    let res: Response;
    try {
      res = await fetch("/api/ai/ask/stream", {
        method: "POST",
        headers: { ...JSON_HEADERS, "X-OpenAI-Key": key },
        body: JSON.stringify(body),
        signal: handlers.signal,
      });
    } catch (err) {
      handlers.onError((err as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
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
          let evt: { delta?: string; done?: boolean; error?: string; raw?: string; sections?: TutorSections };
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
            handlers.onDone(evt.raw ?? "", evt.sections ?? {});
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
