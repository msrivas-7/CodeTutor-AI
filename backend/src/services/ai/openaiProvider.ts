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
import { parseTutorOutput } from "./tutorOutput.js";
import { decorateModel, rankByTeachingQuality } from "./modelRegistry.js";
import { classifyTutorIntent } from "./tutorIntent.js";
import {
  applyTutorOutputPolicy,
  hasTutorTeachingValue,
  tutorValueRecovery,
} from "./tutorPolicy.js";

const OPENAI_BASE = "https://api.openai.com/v1";

// Phase 20-P4: server-side cap on the model's output length. Bounds the
// worst case for a prompt-injected "write a 100k-token novel" attack on the
// platform key and keeps any single call's $ predictable. 2000 output
// tokens at nano rates is ~$0.0008 — well inside the per-call cost math.
// Applied to ALL AI calls, not just platform, because there's no legitimate
// tutor exchange that needs more. Phase 27: callers may pass
// AIAskParams.maxOutputTokens to request a TIGHTER cap (e.g. anonymous
// users get 512); the provider clamps to min(supplied, MAX_OUTPUT_TOKENS).
export const MAX_OUTPUT_TOKENS = 2000;

// Tutor turns need reliable, concise structured output rather than deep
// deliberation. Responses API output limits include hidden reasoning tokens;
// low effort leaves the bounded allowance available for the JSON learners
// actually see and reduces latency/cost without weakening the output schema.
export const TUTOR_REASONING_EFFORT = "low" as const;

function reasoningForModel(model: string): { effort: typeof TUTOR_REASONING_EFFORT } | undefined {
  const normalized = model.trim().toLocaleLowerCase();
  // The Responses API exposes `reasoning` only for GPT-5-or-later and
  // o-series models. Legacy GPT-4.1 requests are non-reasoning and must not
  // receive an unsupported request field.
  const gptMajor = normalized.match(/^gpt-(\d+)(?:[.-]|$)/)?.[1];
  const supportsReasoning =
    (gptMajor !== undefined && Number(gptMajor) >= 5) || /^o\d/.test(normalized);
  if (!supportsReasoning) {
    return undefined;
  }
  return { effort: TUTOR_REASONING_EFFORT };
}

// Phase 27 precondition: server-side request deadline. Caps any single AI
// call so a stalled upstream / runaway stream / client that walked away
// can't hold the response slot indefinitely. 25s is generous for a
// streaming tutor response (typical: 4–8s for nano on tutor sections);
// callers needing a tighter SLA can pass their own AbortSignal in
// params.signal — the two are merged.
export const REQUEST_DEADLINE_MS = 25_000;

// Phase 27 precondition: pre-flight input-size guard. Refuses to send if
// the rendered prompt (instructions + userTurn) exceeds this byte count.
// 250 KB ≈ ~62K tokens upper bound — well below model context windows
// for any current GPT family, but small enough to bound malicious
// payload growth (a content-injected 1MB userTurn would otherwise burn
// ~250K input tokens at nano = ~$0.025 per request, multiplied across
// rapid retries). At this layer we fail fast with a 413 rather than
// truncate silently — silent truncation can change the prompt's
// meaning in ways that are worse than a clear refusal.
export const MAX_PROMPT_BYTES = 250_000;

/**
 * Merge a caller-supplied AbortSignal with a server-side deadline timer.
 * Either source firing aborts the returned signal. Returns a `cancel`
 * function the call site MUST invoke after the upstream resolves so the
 * timer doesn't leak — TS `Promise.finally` is the right place.
 */
function buildSignalWithDeadline(
  caller: AbortSignal | undefined,
  deadlineMs: number,
): { signal: AbortSignal; cancel: () => void; timedOut: () => boolean } {
  const ctl = new AbortController();
  let timedOutFlag = false;
  if (caller?.aborted) ctl.abort();
  const onCallerAbort = () => ctl.abort();
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOutFlag = true;
    ctl.abort();
  }, deadlineMs);
  return {
    signal: ctl.signal,
    cancel: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
    timedOut: () => timedOutFlag,
  };
}

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

// BYOK should expose the same quality floor as the managed Tutor. OpenAI's
// /models endpoint contains many unrelated and legacy models, so the picker
// admits only GPT-5-or-later text models that have independently passed the
// CodeTutor contextual gate in modelRegistry.
function isGptFiveOrLaterTextModel(id: string): boolean {
  const normalized = id.toLocaleLowerCase();
  const excluded = ["audio", "realtime", "image", "transcribe", "tts"];
  if (excluded.some((family) => normalized.includes(family))) return false;
  const major = normalized.match(/^gpt-(\d+)(?:[.-]|$)/)?.[1];
  return major !== undefined && Number(major) >= 5;
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
// SEC-C1 follow-up: when a client aborts mid-stream, OpenAI never emits a
// terminal `usage` event — but we still need to record real cost so the
// free-tier dollar caps see the spend. We can't call tiktoken from here
// without adding a native dep, so use the OpenAI-recommended char/4 rough
// estimate. The error is intentionally biased slightly
// high, which is the fail-safe direction for cap enforcement — cap trips
// sooner under abuse, not later).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Helper exposed for the /ask (non-stream) abort path. Callers compute an
// estimated upper-bound cost without having to duplicate prompt-builder
// logic at the route layer.
export function estimateInputTokensForAsk(params: AIAskParams): number {
  const { userTurn, instructions } = buildPromptInputs(params);
  return estimateTokens(instructions) + estimateTokens(JSON.stringify(userTurn));
}

export interface AIAskReservationEstimate {
  reservedInputTokens: number;
  reservedOutputTokens: number;
  promptBytes: number;
}

// Chat message framing and provider-side schema bookkeeping are not present
// in the rendered prompt strings. Reserve a fixed ceiling in addition to the
// byte fallback so reported input usage cannot cross the admission estimate.
const RESERVATION_INPUT_OVERHEAD_TOKENS = 512;

/**
 * Fail-safe token ceiling for pre-provider budget reservation. UTF-8 bytes are
 * a conservative upper bound for tokenizer output (byte fallback is the worst
 * case), unlike the chars/4 estimate used only for post-abort accounting.
 * Calling this before reserve also guarantees an oversized prompt is rejected
 * before it can consume reservation capacity.
 */
export function estimateReservationForAsk(
  params: AIAskParams,
): AIAskReservationEstimate {
  const { userTurn, instructions } = buildPromptInputs(params);
  const promptBytes =
    Buffer.byteLength(instructions, "utf8") +
    Buffer.byteLength(userTurn, "utf8");
  if (promptBytes > MAX_PROMPT_BYTES) {
    throw new AIProviderError(
      `prompt too large (${promptBytes} bytes; cap ${MAX_PROMPT_BYTES})`,
      413,
    );
  }
  return {
    reservedInputTokens: promptBytes + RESERVATION_INPUT_OVERHEAD_TOKENS,
    reservedOutputTokens: Math.min(
      params.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    ),
    promptBytes,
  };
}

export function estimateReservationForSummary(history: AIMessage[]): {
  reservedInputTokens: number;
  reservedOutputTokens: number;
} {
  const input = buildSummarizeInput(history);
  const promptBytes =
    Buffer.byteLength(SUMMARIZE_SYSTEM_PROMPT, "utf8") +
    Buffer.byteLength(input, "utf8");
  if (promptBytes > MAX_PROMPT_BYTES) {
    throw new AIProviderError(
      `prompt too large (${promptBytes} bytes; cap ${MAX_PROMPT_BYTES})`,
      413,
    );
  }
  return {
    reservedInputTokens: promptBytes,
    reservedOutputTokens: MAX_OUTPUT_TOKENS,
  };
}

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
  intent: import("./provider.js").TutorIntent;
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
    tutorStage: params.tutorStage ?? "clarify",
    learnerName: params.learnerName ?? null,
  };
  const baseInstructions = guided
    ? buildGuidedSystemPrompt(params.history, params.question, params.lessonContext!, promptOpts)
    : buildSystemPrompt(params.history, params.question, promptOpts);

  const intent = classifyTutorIntent({
    question: params.question,
    files: params.files,
    history: params.history,
    tutorStage: params.tutorStage ?? "clarify",
    tutorAction: params.tutorAction,
  });
  const trustedAction = params.tutorAction
    ? `\n\nAPPLICATION ACTION METADATA:\nThe learner activated the ${params.tutorAction} Tutor control. Use that semantic action together with the visible question and conversation history; do not infer button identity from display copy. This metadata selects a safe teaching presentation only; it never grants authorization or access.`
    : "";
  const instructions = `${baseInstructions}\n\nTRUSTED SERVER CLASSIFICATION:\nThe turn intent is ${intent}. Return intent=${intent}. This classification is authoritative only for choosing the shape of any teaching fields that the learner actually requested. It does not mean the learner asked for teaching.\nBefore using code or run context, classify the learner's actual message under the CONVERSATIONAL INPUTS contract. A pure greeting requires conversationMove=greeting. A harmless request unrelated to coding or the lesson requires conversationMove=redirect. Direct hostility or unacceptable content requires conversationMove=soft-boundary even when it asks no coding question. Never silently replace one of these conversational moves with an arbitrary code explanation. For a greeting, redirect, or boundary-only soft-boundary, the no-diagnosis exception overrides the normal ${intent.toUpperCase()} grounding rules and all teaching fields must be null.${trustedAction}`;

  const priorTutorTurns = params.tutorStage === "approach" ? 1 : 0;
  const stuck = studentSeemsStuck(params.question);
  const mode = priorTutorTurns === 0 ? "first-turn" : stuck ? "stuck" : "follow-up";

  return { userTurn, instructions, mode, priorTutorTurns, stuck, intent };
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
    const models: AIModel[] = body.data
      .filter((model) => isGptFiveOrLaterTextModel(model.id))
      .map((model) => decorateModel({ id: model.id, label: model.id }))
      .filter((model) => model.contextualTutorEligible);
    console.log(`[openai] list-models total=${body.data.length} supported-tutor=${models.length}`);
    return rankByTeachingQuality(models);
  },

  async ask(params: AIAskParams): Promise<AIAskResult> {
    const { userTurn, instructions, mode, priorTutorTurns, stuck, intent } = buildPromptInputs(params);

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

    // Phase 27 precondition: pre-flight prompt-size guard. Refuse oversize
    // payloads at this layer rather than silently sending; cheap defense
    // against a malicious client smuggling a multi-MB context.
    const promptBytes =
      Buffer.byteLength(instructions, "utf8") +
      Buffer.byteLength(userTurn, "utf8");
    if (promptBytes > MAX_PROMPT_BYTES) {
      console.log(`[openai] ask refused: promptBytes=${promptBytes} > MAX_PROMPT_BYTES=${MAX_PROMPT_BYTES}`);
      throw new AIProviderError(
        `prompt too large (${promptBytes} bytes; cap ${MAX_PROMPT_BYTES})`,
        413,
      );
    }
    // Phase 27 precondition: clamp to global output-token ceiling. Callers
    // may request lower (anonymous = 512); none can exceed MAX_OUTPUT_TOKENS.
    const maxOutputTokens = Math.min(
      params.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    );
    const reasoning = reasoningForModel(params.model);

    const body = {
      model: params.model,
      instructions,
      input: userTurn,
      max_output_tokens: maxOutputTokens,
      ...(reasoning ? { reasoning } : {}),
      text: {
        format: {
          type: "json_schema",
          name: "tutor_response",
          schema: TUTOR_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    };

    // Phase 27 precondition: server-side request deadline merged with the
    // caller's signal. Either firing aborts the upstream fetch AND the
    // response-body read — the try/finally must wrap BOTH, otherwise a
    // chunked / slow body read past 25s holds the response slot
    // indefinitely (defeating the purpose of the deadline).
    const deadline = buildSignalWithDeadline(params.signal, REQUEST_DEADLINE_MS);
    const started = Date.now();
    let res: Response;
    let json: {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    try {
      res = await openaiFetch("/responses", params.key, {
        method: "POST",
        body: JSON.stringify(body),
        signal: deadline.signal,
      });
      if (!res.ok) {
        const err = await parseError(res);
        console.log(`[openai] ask error status=${res.status} body=${clip(err, 300)}`);
        throw new AIProviderError(err, res.status);
      }
      // The Responses API returns `output_text` as a convenience concat of all
      // text content in the response. For json_schema format this is the JSON
      // document. Fall back to walking `output[].content[].text` if absent.
      json = (await res.json()) as {
        output_text?: string;
        output?: { content?: { type?: string; text?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      };
    } finally {
      deadline.cancel();
    }

    let raw = json.output_text ?? "";
    if (!raw && json.output) {
      raw = json.output
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text" || typeof c.text === "string")
        .map((c) => c.text ?? "")
        .join("");
    }

    let sections: TutorSections;
    let parseOk = true;
    try {
      sections = applyTutorOutputPolicy({
        sections: parseTutorOutput(raw, params.files),
        params,
        intent,
        priorTutorTurns,
      });
      raw = JSON.stringify(sections);
    } catch (err) {
      parseOk = false;
      console.warn(
        `[openai] invalid structured output; applying safe fallback: ${(err as Error).message}`,
      );
      sections = applyTutorOutputPolicy({
        sections: {},
        params,
        intent,
        priorTutorTurns,
      });
      raw = JSON.stringify(sections);
    }

    const elapsed = Date.now() - started;
    const filled = Object.entries(sections)
      .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      .map(([k]) => k);
    console.log(`[openai]   --- response (${elapsed}ms, tokens in=${json.usage?.input_tokens ?? "?"} out=${json.usage?.output_tokens ?? "?"}) ---`);
    console.log(`[openai]   parseOk=${parseOk}  sectionsFilled=[${filled.join(", ") || "(none)"}]`);
    if (DEBUG_PROMPTS) console.log(`[openai]   raw: ${clip(raw, 1500)}`);
    else console.log(`[openai]   responseChars=${raw.length}`);
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

    const hasTeachingValue = hasTutorTeachingValue(sections, params);
    if (!hasTeachingValue) {
      sections = tutorValueRecovery(params);
      raw = JSON.stringify(sections);
    }
    return { sections, raw, usage, hasTeachingValue };
  },

  async summarize({
    key,
    model,
    fundingSource,
    history,
    signal,
  }: {
    key: string;
    model: string;
    fundingSource?: "byok" | "platform";
    history: AIMessage[];
    signal?: AbortSignal;
  }): Promise<{ summary: string; usage?: import("./provider.js").TokenUsage }> {
    if (history.length === 0) return { summary: "" };
    const input = buildSummarizeInput(history);
    console.log(`[openai] summarize model=${model} turns=${history.length}`);
    const deadline = buildSignalWithDeadline(signal, REQUEST_DEADLINE_MS);
    let json: {
      output_text?: string;
      output?: { content?: { type?: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      const res = await openaiFetch("/responses", key, {
        method: "POST",
        body: JSON.stringify({
          model,
          instructions: SUMMARIZE_SYSTEM_PROMPT,
          input,
          max_output_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: deadline.signal,
      });
      if (!res.ok) {
        const err = await parseError(res);
        console.log(`[openai] summarize error status=${res.status} body=${clip(err, 200)}`);
        throw new AIProviderError(err, res.status);
      }
      json = (await res.json()) as typeof json;
    } finally {
      deadline.cancel();
    }
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
    const { userTurn, instructions, mode, priorTutorTurns, stuck, intent } = buildPromptInputs(params);

    console.log(`\n[openai] stream start ---------------------------`);
    console.log(`[openai]   model=${params.model}  fingerprint=${keyFingerprint(params.key)}`);
    console.log(`[openai]   mode=${mode}  priorTutorTurns=${priorTutorTurns}  stuck=${stuck}`);
    // P-2: question text is gated behind DEBUG_PROMPTS=1.
    console.log(`[openai]   question: len=${params.question.length}`);
    if (DEBUG_PROMPTS) {
      console.log(`[openai]   --- question ---\n${clip(params.question, 300)}`);
    }

    // Phase 27 precondition: pre-flight prompt-size guard.
    const promptBytes =
      Buffer.byteLength(instructions, "utf8") +
      Buffer.byteLength(userTurn, "utf8");
    if (promptBytes > MAX_PROMPT_BYTES) {
      console.log(`[openai] stream refused: promptBytes=${promptBytes} > MAX_PROMPT_BYTES=${MAX_PROMPT_BYTES}`);
      await handlers.onError(
        `prompt too large (${promptBytes} bytes; cap ${MAX_PROMPT_BYTES})`,
        413,
      );
      return;
    }
    // Phase 27 precondition: clamp output cap.
    const maxOutputTokens = Math.min(
      params.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    );
    const reasoning = reasoningForModel(params.model);

    const body = {
      model: params.model,
      instructions,
      input: userTurn,
      stream: true,
      max_output_tokens: maxOutputTokens,
      ...(reasoning ? { reasoning } : {}),
      text: {
        format: {
          type: "json_schema",
          name: "tutor_response",
          schema: TUTOR_RESPONSE_SCHEMA,
          strict: true,
        },
      },
    };

    // Phase 27 precondition: server-side deadline merged with caller's signal.
    const deadline = buildSignalWithDeadline(params.signal, REQUEST_DEADLINE_MS);
    const started = Date.now();
    let res: Response;
    try {
      res = await openaiFetch("/responses", params.key, {
        method: "POST",
        body: JSON.stringify(body),
        signal: deadline.signal,
      });
    } catch (err) {
      deadline.cancel();
      if (isAbortError(err)) {
        const reason = deadline.timedOut() ? "deadline" : "client";
        console.log(`[openai] stream aborted (${reason}) before headers`);
        // Even pre-headers, OpenAI may have received the request body and
        // billed input tokens. Record an estimated-cost ledger row.
        await handlers.onAbort?.("", {
          inputTokens: estimateTokens(instructions) + estimateTokens(JSON.stringify(userTurn)),
          outputTokens: 0,
        });
        return;
      }
      await handlers.onError((err as Error).message);
      return;
    }

    if (!res.ok || !res.body) {
      deadline.cancel();
      const err = await parseError(res);
      console.log(`[openai] stream error status=${res.status} body=${clip(err, 300)}`);
      await handlers.onError(err, res.status);
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
        // Structured model text is buffered until it has passed schema,
        // navigation, intent, and answer-leak policy. Streaming unvalidated
        // JSON would briefly expose unsafe content before the final parser had
        // a chance to remove it.
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
      deadline.cancel();
      if (isAbortError(err)) {
        const reason = deadline.timedOut() ? "deadline" : "client";
        console.log(`[openai] stream aborted (${reason}) after ${Date.now() - started}ms, raw=${raw.length} chars`);
        // Input: full prompt is billed by OpenAI once the request was
        // accepted. Output: what we actually received via delta events
        // before the abort. Both are rough — see estimateTokens comment.
        await handlers.onAbort?.(raw, {
          inputTokens: estimateTokens(instructions) + estimateTokens(JSON.stringify(userTurn)),
          outputTokens: estimateTokens(raw),
        });
        return;
      }
      await handlers.onError((err as Error).message);
      return;
    }
    // Stream loop exited normally — clear the deadline timer.
    deadline.cancel();

    if (finalFailure) {
      await handlers.onError(finalFailure);
      return;
    }

    let sections: TutorSections;
    try {
      sections = applyTutorOutputPolicy({
        sections: parseTutorOutput(raw, params.files),
        params,
        intent,
        priorTutorTurns,
      });
      raw = JSON.stringify(sections);
    } catch (err) {
      console.warn(
        `[openai] invalid streamed structured output; applying safe fallback: ${(err as Error).message}`,
      );
      sections = applyTutorOutputPolicy({
        sections: {},
        params,
        intent,
        priorTutorTurns,
      });
      raw = JSON.stringify(sections);
    }

    const elapsed = Date.now() - started;
    const usageLog = usage
      ? ` in=${usage.inputTokens} out=${usage.outputTokens}`
      : "";
    console.log(`[openai] stream end (${elapsed}ms, ${raw.length} chars${usageLog})`);
    const hasTeachingValue = hasTutorTeachingValue(sections, params);
    if (!hasTeachingValue) {
      sections = tutorValueRecovery(params);
      raw = JSON.stringify(sections);
    }
    await handlers.onDone(raw, sections, usage, hasTeachingValue);
  },
};
