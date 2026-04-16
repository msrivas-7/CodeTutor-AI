import type {
  AIAskParams,
  AIAskResult,
  AIModel,
  AIProvider,
  AIStreamHandlers,
  TutorSections,
} from "./provider.js";
import {
  SUMMARIZE_SYSTEM_PROMPT,
  TUTOR_RESPONSE_SCHEMA,
  buildSummarizeInput,
  buildSystemPrompt,
  buildUserTurn,
  studentSeemsStuck,
} from "./promptBuilder.js";
import type { AIMessage } from "./provider.js";

const OPENAI_BASE = "https://api.openai.com/v1";

// Truncate long strings for the log so the terminal stays readable. Full
// payloads go to OpenAI regardless; this is just what we print.
function clip(s: string, n = 800): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + ` … [+${s.length - n} chars]`;
}

function keyFingerprint(key: string): string {
  // Log only a safe fingerprint of the key so we can tell two requests apart
  // without leaking the key itself.
  if (key.length < 10) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

// Allow-list of model id prefixes we expose in the dropdown. OpenAI's /models
// endpoint returns hundreds of entries (fine-tunes, embeddings, TTS, whisper…);
// most of them can't run the Responses API or aren't useful for tutoring. We
// filter for chat-capable GPT families. Ordered roughly by how useful they are
// for a code tutor.
const USEFUL_MODEL_PREFIXES = ["gpt-4.1", "gpt-4o", "gpt-4-turbo", "o4-mini", "o3", "gpt-4", "gpt-3.5"];

function rank(id: string): number {
  for (let i = 0; i < USEFUL_MODEL_PREFIXES.length; i++) {
    if (id.startsWith(USEFUL_MODEL_PREFIXES[i])) return i;
  }
  return 999;
}

function isUsefulModel(id: string): boolean {
  // Drop non-chat model families explicitly.
  const bad = ["embedding", "whisper", "tts", "dall-e", "davinci", "babbage", "moderation", "audio", "realtime", "image"];
  if (bad.some((b) => id.includes(b))) return false;
  return USEFUL_MODEL_PREFIXES.some((p) => id.startsWith(p));
}

async function openaiFetch(path: string, key: string, init?: RequestInit): Promise<Response> {
  return fetch(`${OPENAI_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export const openaiProvider: AIProvider = {
  async validateKey(key) {
    console.log(`[openai] validate-key fingerprint=${keyFingerprint(key)}`);
    if (!key.startsWith("sk-") && !key.startsWith("sk_")) {
      console.log(`[openai] validate-key result=invalid reason=bad-prefix`);
      return { valid: false, error: "key doesn't look like an OpenAI key (expected sk-… prefix)" };
    }
    const res = await openaiFetch("/models", key, { method: "GET" });
    if (res.ok) {
      console.log(`[openai] validate-key result=valid`);
      return { valid: true };
    }
    const error = await parseError(res);
    console.log(`[openai] validate-key result=invalid reason=${clip(error, 120)}`);
    return { valid: false, error };
  },

  async listModels(key) {
    console.log(`[openai] list-models fingerprint=${keyFingerprint(key)}`);
    const res = await openaiFetch("/models", key, { method: "GET" });
    if (!res.ok) {
      const err = await parseError(res);
      console.log(`[openai] list-models error=${clip(err, 120)}`);
      throw new Error(err);
    }
    const body = (await res.json()) as { data: { id: string }[] };
    const filtered = body.data.filter((m) => isUsefulModel(m.id));
    console.log(`[openai] list-models total=${body.data.length} chat-capable=${filtered.length}`);
    const models: AIModel[] = filtered
      .sort((a, b) => {
        const ra = rank(a.id);
        const rb = rank(b.id);
        if (ra !== rb) return ra - rb;
        return a.id.localeCompare(b.id);
      })
      .map((m) => ({ id: m.id, label: m.id }));
    return models;
  },

  async ask(params: AIAskParams): Promise<AIAskResult> {
    const userTurn = buildUserTurn({
      question: params.question,
      files: params.files,
      activeFile: params.activeFile,
      language: params.language,
      lastRun: params.lastRun,
      history: params.history,
      stdin: params.stdin,
      diffSinceLastTurn: params.diffSinceLastTurn,
    });

    const instructions = buildSystemPrompt(params.history, params.question, {
      runsSinceLastTurn: params.runsSinceLastTurn,
      editsSinceLastTurn: params.editsSinceLastTurn,
      persona: params.persona,
    });

    const priorTutorTurns = params.history.filter((m) => m.role === "assistant").length;
    const stuck = studentSeemsStuck(params.question);
    const mode = priorTutorTurns === 0 && !stuck
      ? "first-turn"
      : stuck
        ? "stuck"
        : "follow-up";

    console.log(`\n[openai] ask start -----------------------------`);
    console.log(`[openai]   model=${params.model}  fingerprint=${keyFingerprint(params.key)}`);
    console.log(`[openai]   mode=${mode}  priorTutorTurns=${priorTutorTurns}  stuck=${stuck}`);
    console.log(`[openai]   language=${params.language ?? "(none)"}  activeFile=${params.activeFile ?? "(none)"}  files=${params.files.length}`);
    console.log(`[openai]   lastRun=${params.lastRun ? `${params.lastRun.stage}/exit=${params.lastRun.exitCode}/type=${params.lastRun.errorType}` : "(none)"}`);
    console.log(`[openai]   question: ${clip(params.question, 300)}`);
    console.log(`[openai]   --- instructions (system) ---\n${clip(instructions, 1500)}`);
    console.log(`[openai]   --- input (user turn) ---\n${clip(userTurn, 1500)}`);

    const body = {
      model: params.model,
      instructions,
      input: userTurn,
      text: {
        format: {
          type: "json_schema",
          name: "tutor_response",
          schema: TUTOR_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    };

    const started = Date.now();
    const res = await openaiFetch("/responses", params.key, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await parseError(res);
      console.log(`[openai] ask error status=${res.status} body=${clip(err, 300)}`);
      throw new Error(err);
    }

    // The Responses API returns `output_text` as a convenience concat of all
    // text content in the response. For json_schema format this is the JSON
    // document. Fall back to walking `output[].content[].text` if absent.
    const json = (await res.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };

    let raw = json.output_text ?? "";
    if (!raw && json.output) {
      raw = json.output
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text" || typeof c.text === "string")
        .map((c) => c.text ?? "")
        .join("");
    }

    let sections: TutorSections = {};
    let parseOk = true;
    try {
      sections = JSON.parse(raw) as TutorSections;
    } catch {
      parseOk = false;
      // Model bypassed structured output (shouldn't happen with strict=true).
      // Fall back to putting the whole reply in "summary" so the user sees
      // something rather than an error.
      sections = { summary: raw };
    }

    const elapsed = Date.now() - started;
    const filled = Object.entries(sections)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k]) => k);
    console.log(`[openai]   --- response (${elapsed}ms, tokens in=${json.usage?.input_tokens ?? "?"} out=${json.usage?.output_tokens ?? "?"}) ---`);
    console.log(`[openai]   parseOk=${parseOk}  sectionsFilled=[${filled.join(", ") || "(none)"}]`);
    console.log(`[openai]   raw: ${clip(raw, 1500)}`);
    console.log(`[openai] ask end -------------------------------\n`);

    return { sections, raw };
  },

  async summarize({
    key,
    model,
    history,
  }: {
    key: string;
    model: string;
    history: AIMessage[];
  }): Promise<string> {
    if (history.length === 0) return "";
    const input = buildSummarizeInput(history);
    console.log(`[openai] summarize model=${model} turns=${history.length}`);
    const res = await openaiFetch("/responses", key, {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: SUMMARIZE_SYSTEM_PROMPT,
        input,
      }),
    });
    if (!res.ok) {
      const err = await parseError(res);
      console.log(`[openai] summarize error status=${res.status} body=${clip(err, 200)}`);
      throw new Error(err);
    }
    const json = (await res.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    let summary = json.output_text ?? "";
    if (!summary && json.output) {
      summary = json.output
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text" || typeof c.text === "string")
        .map((c) => c.text ?? "")
        .join("");
    }
    console.log(`[openai] summarize done chars=${summary.length}`);
    return summary.trim();
  },

  async askStream(params: AIAskParams, handlers: AIStreamHandlers): Promise<void> {
    const userTurn = buildUserTurn({
      question: params.question,
      files: params.files,
      activeFile: params.activeFile,
      language: params.language,
      lastRun: params.lastRun,
      history: params.history,
      stdin: params.stdin,
      diffSinceLastTurn: params.diffSinceLastTurn,
    });
    const instructions = buildSystemPrompt(params.history, params.question, {
      runsSinceLastTurn: params.runsSinceLastTurn,
      editsSinceLastTurn: params.editsSinceLastTurn,
      persona: params.persona,
    });

    const priorTutorTurns = params.history.filter((m) => m.role === "assistant").length;
    const stuck = studentSeemsStuck(params.question);
    const mode = priorTutorTurns === 0 && !stuck ? "first-turn" : stuck ? "stuck" : "follow-up";

    console.log(`\n[openai] stream start ---------------------------`);
    console.log(`[openai]   model=${params.model}  fingerprint=${keyFingerprint(params.key)}`);
    console.log(`[openai]   mode=${mode}  priorTutorTurns=${priorTutorTurns}  stuck=${stuck}`);
    console.log(`[openai]   question: ${clip(params.question, 300)}`);

    const body = {
      model: params.model,
      instructions,
      input: userTurn,
      stream: true,
      text: {
        format: {
          type: "json_schema",
          name: "tutor_response",
          schema: TUTOR_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    };

    const started = Date.now();
    let res: Response;
    try {
      res = await openaiFetch("/responses", params.key, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (err) {
      handlers.onError((err as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
      const err = await parseError(res);
      console.log(`[openai] stream error status=${res.status} body=${clip(err, 300)}`);
      handlers.onError(err);
      return;
    }

    // OpenAI streams SSE: lines prefixed `data: ` separated by blank lines.
    // Each event's data is a JSON object whose `type` drives how we interpret
    // it. We only care about `response.output_text.delta` (incremental JSON)
    // and the terminal events (`response.completed`, `response.failed`, etc).
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let raw = "";
    let finalFailure: string | null = null;

    const processEvent = (data: string) => {
      if (!data) return;
      let evt: { type?: string; delta?: string; response?: { error?: { message?: string } } };
      try {
        evt = JSON.parse(data);
      } catch {
        return;
      }
      if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
        raw += evt.delta;
        handlers.onDelta(evt.delta);
      } else if (evt.type === "response.failed" || evt.type === "response.error") {
        finalFailure = evt.response?.error?.message ?? "response failed";
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Split on blank-line separators. An SSE event can span multiple
        // `data:` lines; concat them.
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""));
          const data = dataLines.join("\n");
          if (data === "[DONE]") continue;
          processEvent(data);
        }
      }
    } catch (err) {
      handlers.onError((err as Error).message);
      return;
    }

    if (finalFailure) {
      handlers.onError(finalFailure);
      return;
    }

    let sections: TutorSections = {};
    try {
      sections = JSON.parse(raw) as TutorSections;
    } catch {
      sections = { summary: raw };
    }

    const elapsed = Date.now() - started;
    console.log(`[openai] stream end (${elapsed}ms, ${raw.length} chars)`);
    handlers.onDone(raw, sections);
  },
};
