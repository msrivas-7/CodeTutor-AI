// AI provider abstraction. Only OpenAI is implemented; the interface exists so
// we can swap in Anthropic/etc. without touching routes or prompt code.

import type { Language } from "../execution/commands.js";

export interface ProjectFile {
  path: string;
  content: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  errorType: "none" | "compile" | "runtime" | "timeout" | "system";
  durationMs: number;
  stage: "compile" | "run" | "setup";
}

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export type TutorIntent =
  | "socratic"
  | "debug"
  | "concept"
  | "howto"
  | "walkthrough"
  | "checkin";

// This value is owned by the server route, never inferred from browser
// history. "clarify" is the safe default: one question only. A route may
// supply "approach" only after it verifies the signed per-task progression
// proof returned by a successfully completed first tutor turn.
export type TutorStage = "clarify" | "approach";

export type Persona = "beginner" | "intermediate" | "advanced";

export type Stuckness = "low" | "medium" | "high";

export interface TutorCitation {
  path: string;
  line: number;
  column?: number | null;
  reason: string;
}

export interface TutorWalkStep {
  body: string;
  path?: string | null;
  line?: number | null;
}

// Flat, intent-aware schema. Every field is optional because the model fills
// only the fields relevant to the classified `intent` and leaves the rest
// null. The UI renders only non-null fields, in an intent-aware order.
export interface TutorSections {
  intent?: TutorIntent | null;
  conversationMove?: "none" | "greeting" | "redirect" | "clarify" | "soft-boundary" | null;
  conversationReply?: string | null;
  summary?: string | null;
  diagnose?: string | null;
  explain?: string | null;
  example?: string | null;
  walkthrough?: TutorWalkStep[] | null;
  checkQuestions?: string[] | null;
  hint?: string | null;
  nextStep?: string | null;
  strongerHint?: string | null;
  pitfalls?: string | null;
  citations?: TutorCitation[] | null;
  comprehensionCheck?: string | null;
  // Phase 4: the model's own read of the student's stuckness. Used for a small
  // UI nudge (not a content change). Always emitted alongside strongerHint when
  // set to "high".
  stuckness?: Stuckness | null;
}

export interface AIModel {
  id: string;
  label: string;
  qualityStatus?: "evaluated" | "unevaluated";
  contextualTutorEligible?: boolean;
  qualityLabel?: string;
  evalSetVersion?: string | null;
  registryVersion?: string;
}

// A span the student pulled out of the editor to focus the tutor on. Sent as
// a distinct block in the user-turn so the model can anchor its explanation
// on the exact range the student is asking about, rather than inferring it
// from the full file.
export interface EditorSelection {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

// Token accounting for a single tutor call. The model's own usage field on
// Responses API replies; we forward it to the client so per-turn cost can be
// shown without a round-trip to the pricing API.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIAskParams {
  key: string;
  model: string;
  // Phase 20-P4: funding source is labeled on token-consumed metrics so the
  // operator can split platform-funded spend from user-BYOK spend. The
  // provider never gates on this; it's just a passthrough label.
  fundingSource?: "byok" | "platform";
  question: string;
  files: ProjectFile[];
  activeFile?: string;
  language?: Language;
  lastRun?: RunResult | null;
  history: AIMessage[];
  tutorStage?: TutorStage;
  // Phase 2 context — everything below is optional; the prompt builder falls
  // back to sensible defaults when omitted.
  stdin?: string | null;
  diffSinceLastTurn?: string | null;
  runsSinceLastTurn?: number;
  editsSinceLastTurn?: number;
  // Phase 4 — user-chosen experience level. Shapes tone, vocabulary, and how
  // much prior knowledge the tutor assumes. Omitted → model uses its default
  // (a reasonable middle ground).
  persona?: Persona;
  // Optional presentation-only first name from sanitized auth metadata.
  // Never use it for authorization, ownership, quota, or model routing.
  learnerName?: string | null;
  // Phase 5 — optional span of the editor the student wants the tutor to
  // focus on (captured via Cmd+K in Monaco).
  selection?: EditorSelection | null;
  // Caller's abort signal. The provider wires it into upstream fetch + SSE
  // read loop; when it fires (client disconnect, request-wide deadline) the
  // OpenAI call is cancelled so we stop burning the user's tokens and free
  // the response slot. Non-stream `ask` also honors it.
  signal?: AbortSignal;
  // Phase 27 precondition: optional per-request output-token cap. If
  // omitted, defaults to the provider's MAX_OUTPUT_TOKENS (2000).
  // Anonymous callers pass a tighter value (e.g. 512) so a single
  // anon request can't stretch the bounded-cost envelope. The
  // provider clamps to min(supplied, MAX_OUTPUT_TOKENS) — callers
  // can never ask for MORE than the global ceiling.
  maxOutputTokens?: number;
  // Guided learning mode — when present, the tutor uses lesson-aware prompting.
  lessonContext?: {
    courseId: string;
    lessonId: string;
    exerciseId: string | null;
    lessonTitle: string;
    language: Language;
    lessonObjectives: string[];
    teachesConceptTags: string[];
    usesConceptTags: string[];
    priorConcepts: string[];
    completionCriteria: string[];
    studentProgressSummary: string;
    lessonOrder?: number;
    totalLessons?: number;
  } | null;
}

export interface AIAskResult {
  sections: TutorSections;
  raw: string;
  usage?: TokenUsage;
  /** False only when the final rendered teaching-value contract failed. */
  hasTeachingValue?: boolean;
}

export interface AIStreamHandlers {
  onDelta(chunk: string): void;
  onDone(
    raw: string,
    sections: TutorSections,
    usage?: TokenUsage,
    hasTeachingValue?: boolean,
  ): void | Promise<void>;
  // `status` carries the upstream HTTP status when the failure came from
  // the provider (e.g. 401 from OpenAI on bad key). Absent for transport
  // errors or parse failures where no status exists. Route handlers use
  // this to decide whether to trip the provider-auth kill flag.
  onError(message: string, status?: number): void | Promise<void>;
  // Fires when the client aborted (TCP close, request deadline) before a
  // terminal `response.completed` / `response.failed` event arrived.
  // Token counts are ESTIMATES (chars / 4): inputTokens = full prompt
  // we sent (OpenAI bills input in full once the request is accepted),
  // outputTokens = length of delta buffer accumulated pre-abort. The
  // caller uses these to record a real-cost ledger row so the free-tier
  // dollar caps (L2/L3/L4) still see the spend — even though the abort
  // row doesn't count against the 30/day question quota.
  onAbort?(raw: string, estimatedUsage: TokenUsage): void | Promise<void>;
}

// Error class thrown by the AI provider when an upstream HTTP call fails.
// Routes inspect `.status` to decide whether to trip the platform-auth kill
// flag (401 on a platform key → flip the flag; anything else → pass through).
// Callers that don't care about status can treat it as a plain `Error`.
export class AIProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
  }
}

export interface AIProvider {
  validateKey(key: string): Promise<{ valid: boolean; error?: string }>;
  listModels(key: string): Promise<AIModel[]>;
  ask(params: AIAskParams): Promise<AIAskResult>;
  askStream(params: AIAskParams, handlers: AIStreamHandlers): Promise<void>;
  summarize(params: {
    key: string;
    model: string;
    fundingSource?: "byok" | "platform";
    history: AIMessage[];
    signal?: AbortSignal;
  }): Promise<{ summary: string; usage?: TokenUsage }>;
}
