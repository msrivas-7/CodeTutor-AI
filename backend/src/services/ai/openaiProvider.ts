import {
  AIProviderError,
  type AIAskParams,
  type AIAskResult,
  type AIModel,
  type AIProvider,
  type AIStreamHandlers,
  type TutorSections,
} from "./provider.js";
import {
  SUMMARIZE_SYSTEM_PROMPT,
  TUTOR_RESPONSE_SCHEMA,
  buildSummarizeInput,
  buildSystemPrompt,
  buildUserTurn,
  studentSeemsStuck,
} from "./editorPromptBuilder.js";
import {
  buildGuidedSystemPrompt,
  buildGuidedUserTurn,
} from "./guidedPromptBuilder.js";
import type { AIMessage } from "./provider.js";
import { aiTokensConsumed } from "../metrics.js";

const OPENAI_BASE = "https://api.openai.com/v1";

// Phase 20-P4: server-side cap on the model's output length. Bounds the
// worst case for a prompt-injected "write a 100k-token novel" attack on the
// platform key and keeps any single call's $ predictable. 2000 output
// tokens at nano rates is ~$0.0008 — well inside the per-call cost math.
// Applied to ALL AI calls, not just platform, because there's no legitimate
// tutor exchange that needs more.
const MAX_OUTPUT_TOKENS = 2000;

// Phase 17 / M-A3: full prompt content can contain the learner's code —
// keep it out of the log unless a developer explicitly opts in. In normal
// operation we print sizes only.
const DEBUG_PROMPTS = process.env.DEBUG_PROMPTS === "1";

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

// Node's fetch throws a DOMException with name="AbortError" (or TypeError
// whose `cause` is an AbortError) when the passed signal aborts. Some older
// Node minors also surface the raw "aborted" message from undici — match
// all three so callers can cleanly swallow abort without treating it as an
// upstream failure.
function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; cause?: { name?: string }; message?: string };
  if (e.name === "AbortError") return true;
  if (e.cause?.name === "AbortError") return true;
  if (typeof e.message === "string" && /abort/i.test(e.message)) return true;
  return false;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Pick the lesson-aware (guided) or editor-mode prompt builders based on
// whether the request carries a lessonContext, and classify the turn for the
// telemetry log line. Shared by `ask` and `askStream` — if this contract
// changes, both code paths move together.
function buildPromptInputs(params: AIAskParams): {
  userTurn: string;
  instructions: string;
  mode: "first-turn" | "stuck" | "follow-up";
  priorTutorTurns: number;
  stuck: boolean;
} {
  const guided = !!params.lessonContext;
  const common = {
    question: params.question,
    files: params.files,
    activeFile: params.activeFile,
    lastRun: params.lastRun,
    history: params.history,
    stdin: params.stdin,
    diffSinceLastTurn: params.diffSinceLastTurn,
    selection: params.selection,
  };
  // Guided mode reads language from the lessonContext — that's the authoritative
  // source (lesson.language on the schema); the top-level `params.language` is
  // an editor-mode construct.
  const userTurn = guided
    ? buildGuidedUserTurn({ ...common, language: params.lessonContext!.language })
    : buildUserTurn({ ...common, language: params.language });

  const promptOpts = {
    runsSinceLastTurn: params.runsSinceLastTurn,
    editsSinceLastTurn: params.editsSinceLastTurn,
    persona: params.persona,
  };
  const instructions = guided
    ? buildGuidedSystemPrompt(params.history, params.question, params.lessonContext!, promptOpts)
    : buildSystemPrompt(params.history, params.question, promptOpts);

  const priorTutorTurns = params.history.filter((m) => m.role === "assistant").length;
  const stuck = studentSeemsStuck(params.question);
  const mode = priorTutorTurns === 0 && !stuck ? "first-turn" : stuck ? "stuck" : "follow-up";

  return { userTurn, instructions, mode, priorTutorTurns, stuck };
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
    const { userTurn, instructions, mode, priorTutorTurns, stuck } = buildPromptInputs(params);

    console.log(`\n[openai] ask start -----------------------------`);
    console.log(`[openai]   model=${params.model}  fingerprint=${keyFingerprint(params.key)}`);
    console.log(`[openai]   mode=${mode}  priorTutorTurns=${priorTutorTurns}  stuck=${stuck}`);
    console.log(`[openai]   language=${params.language ?? "(none)"}  activeFile=${params.activeFile ?? "(none)"}  files=${params.files.length}`);
    console.log(`[openai]   lastRun=${params.lastRun ? `${params.lastRun.stage}/exit=${params.lastRun.exitCode}/type=${params.lastRun.errorType}` : "(none)"}`);
    // P-2: question text can be user PII / code; log length only. `mode`
    // (logged above) already captures intent. Full content is still wire-
    // sent to OpenAI; only stdout stays scrubbed unless DEBUG_PROMPTS=1.
    console.log(`[openai]   question: len=${params.question.length}`);
    console.log(`[openai]   prompt sizes: instructions=${instructions.length} userTurn=${userTurn.length}`);
    if (DEBUG_PROMPTS) {
      console.log(`[openai]   --- question ---\n${clip(params.question, 300)}`);
      console.log(`[openai]   --- instructions (system) ---\n${clip(instructions, 1500)}`);
      console.log(`[openai]   --- input (user turn) ---\n${clip(userTurn, 1500)}`);
    }

    const body = {
      model: params.model,
      instructions,
      input: userTurn,
      max_output_tokens: MAX_OUTPUT_TOKENS,
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
      signal: params.signal,
    });
    if (!res.ok) {
      const err = await parseError(res);
      console.log(`[openai] ask error status=${res.status} body=${clip(err, 300)}`);
      throw new AIProviderError(err, res.status);
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

    const usage =
      typeof json.usage?.input_tokens === "number" &&
      typeof json.usage?.output_tokens === "number"
        ? {
            inputTokens: json.usage.input_tokens,
            outputTokens: json.usage.output_tokens,
          }
        : undefined;

    if (usage) {
      const fs = params.fundingSource ?? "byok";
      aiTokensConsumed.inc({ model: params.model, kind: "input", funding_source: fs }, usage.inputTokens);
      aiTokensConsumed.inc({ model: params.model, kind: "output", funding_source: fs }, usage.outputTokens);
    }

    return { sections, raw, usage };
  },

  async summarize({
    key,
    model,
    fundingSource,
    history,
  }: {
    key: string;
    model: string;
    fundingSource?: "byok" | "platform";
    history: AIMessage[];
  }): Promise<{ summary: string; usage?: import("./provider.js").TokenUsage }> {
    if (history.length === 0) return { summary: "" };
    const input = buildSummarizeInput(history);
    console.log(`[openai] summarize model=${model} turns=${history.length}`);
    const res = await openaiFetch("/responses", key, {
      method: "POST",
      body: JSON.stringify({
        model,
        instructions: SUMMARIZE_SYSTEM_PROMPT,
        input,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
    });
    if (!res.ok) {
      const err = await parseError(res);
      console.log(`[openai] summarize error status=${res.status} body=${clip(err, 200)}`);
      throw new AIProviderError(err, res.status);
    }
    const json = (await res.json()) as {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    let summary = json.output_text ?? "";
    if (!summary && json.output) {
      summary = json.output
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text" || typeof c.text === "string")
        .map((c) => c.text ?? "")
        .join("");
    }
    const usage =
      typeof json.usage?.input_tokens === "number" &&
      typeof json.usage?.output_tokens === "number"
        ? {
            inputTokens: json.usage.input_tokens,
            outputTokens: json.usage.output_tokens,
          }
        : undefined;
    if (usage) {
      const fs = fundingSource ?? "byok";
      aiTokensConsumed.inc({ model, kind: "input", funding_source: fs }, usage.inputTokens);
      aiTokensConsumed.inc({ model, kind: "output", funding_source: fs }, usage.outputTokens);
    }
    console.log(`[openai] summarize done chars=${summary.length}`);
    return { summary: summary.trim(), usage };
  },

  async askStream(params: AIAskParams, handlers: AIStreamHandlers): Promise<void> {
    const { userTurn, instructions, mode, priorTutorTurns, stuck } = buildPromptInputs(params);

    console.log(`\n[openai] stream start ---------------------------`);
    console.log(`[openai]   model=${params.model}  fingerprint=${keyFingerprint(params.key)}`);
    console.log(`[openai]   mode=${mode}  priorTutorTurns=${priorTutorTurns}  stuck=${stuck}`);
    // P-2: question text is gated behind DEBUG_PROMPTS=1.
    console.log(`[openai]   question: len=${params.question.length}`);
    if (DEBUG_PROMPTS) {
      console.log(`[openai]   --- question ---\n${clip(params.question, 300)}`);
    }

    const body = {
      model: params.model,
      instructions,
      input: userTurn,
      stream: true,
      max_output_tokens: MAX_OUTPUT_TOKENS,
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
        signal: params.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        console.log(`[openai] stream aborted before headers`);
        return;
      }
      handlers.onError((err as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
      const err = await parseError(res);
      console.log(`[openai] stream error status=${res.status} body=${clip(err, 300)}`);
      handlers.onError(err, res.status);
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
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    const processEvent = (data: string) => {
      if (!data) return;
      let evt: {
        type?: string;
        delta?: string;
        response?: {
          error?: { message?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      };
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
      } else if (evt.type === "response.completed") {
        // Terminal event includes aggregate usage. OpenAI doesn't emit usage
        // on partial events, so this is where per-turn cost is fixed.
        const u = evt.response?.usage;
        if (typeof u?.input_tokens === "number" && typeof u?.output_tokens === "number") {
          usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
          const fs = params.fundingSource ?? "byok";
          aiTokensConsumed.inc({ model: params.model, kind: "input", funding_source: fs }, u.input_tokens);
          aiTokensConsumed.inc({ model: params.model, kind: "output", funding_source: fs }, u.output_tokens);
        }
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
      if (isAbortError(err)) {
        console.log(`[openai] stream aborted after ${Date.now() - started}ms`);
        return;
      }
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
    const usageLog = usage
      ? ` in=${usage.inputTokens} out=${usage.outputTokens}`
      : "";
    console.log(`[openai] stream end (${elapsed}ms, ${raw.length} chars${usageLog})`);
    handlers.onDone(raw, sections, usage);
  },
};
