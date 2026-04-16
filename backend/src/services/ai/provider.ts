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

export interface TutorSections {
  whatIThink?: string | null;
  whatToCheck?: string | null;
  hint?: string | null;
  nextStep?: string | null;
  strongerHint?: string | null;
}

export interface AIModel {
  id: string;
  label: string;
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
}

export interface AIAskResult {
  sections: TutorSections;
  raw: string;
}

export interface AIStreamHandlers {
  onDelta(chunk: string): void;
  onDone(raw: string, sections: TutorSections): void;
  onError(message: string): void;
}

export interface AIProvider {
  validateKey(key: string): Promise<{ valid: boolean; error?: string }>;
  listModels(key: string): Promise<AIModel[]>;
  ask(params: AIAskParams): Promise<AIAskResult>;
  askStream(params: AIAskParams, handlers: AIStreamHandlers): Promise<void>;
}
