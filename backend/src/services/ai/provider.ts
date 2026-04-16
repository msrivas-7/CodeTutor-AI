// AI provider abstraction. Only OpenAI is implemented; the interface exists so
// we can swap in Anthropic/etc. without touching routes or prompt code.

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
  | "debug"
  | "concept"
  | "howto"
  | "walkthrough"
  | "checkin";

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
  question: string;
  files: ProjectFile[];
  activeFile?: string;
  language?: string;
  lastRun?: RunResult | null;
  history: AIMessage[];
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
  // Phase 5 — optional span of the editor the student wants the tutor to
  // focus on (captured via Cmd+K in Monaco).
  selection?: EditorSelection | null;
}

export interface AIAskResult {
  sections: TutorSections;
  raw: string;
  usage?: TokenUsage;
}

export interface AIStreamHandlers {
  onDelta(chunk: string): void;
  onDone(raw: string, sections: TutorSections, usage?: TokenUsage): void;
  onError(message: string): void;
}

export interface AIProvider {
  validateKey(key: string): Promise<{ valid: boolean; error?: string }>;
  listModels(key: string): Promise<AIModel[]>;
  ask(params: AIAskParams): Promise<AIAskResult>;
  askStream(params: AIAskParams, handlers: AIStreamHandlers): Promise<void>;
  summarize(params: { key: string; model: string; history: AIMessage[] }): Promise<string>;
}
