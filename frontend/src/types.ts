export type Language =
  | "python"
  | "javascript"
  | "typescript"
  | "c"
  | "cpp"
  | "java"
  | "go"
  | "rust"
  | "ruby";

export interface ProjectFile {
  path: string;
  content: string;
}

export type ErrorType = "none" | "compile" | "runtime" | "timeout" | "system";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  errorType: ErrorType;
  durationMs: number;
  stage: "compile" | "run" | "setup";
}

export const LANGUAGES: Language[] = [
  "python",
  "javascript",
  "typescript",
  "c",
  "cpp",
  "java",
  "go",
  "rust",
  "ruby",
];

export const LANGUAGE_LABEL: Record<Language, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  c: "C",
  cpp: "C++",
  java: "Java",
  go: "Go",
  rust: "Rust",
  ruby: "Ruby",
};

export const LANGUAGE_ENTRYPOINT: Record<Language, string> = {
  python: "main.py",
  javascript: "main.js",
  typescript: "main.ts",
  c: "main.c",
  cpp: "main.cpp",
  java: "Main.java",
  go: "main.go",
  rust: "main.rs",
  ruby: "main.rb",
};

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

// Flat, intent-aware schema. The model fills only the fields relevant to the
// classified `intent` and leaves the rest null.
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
  stuckness?: Stuckness | null;
}

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
  sections?: TutorSections;
}

export interface AIModel {
  id: string;
  label: string;
}

export interface AIAskResult {
  sections: TutorSections;
  raw: string;
}

export function monacoLangFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "py": return "python";
    case "js": return "javascript";
    case "ts": return "typescript";
    case "c":
    case "h": return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp": return "cpp";
    case "java": return "java";
    case "go": return "go";
    case "rs": return "rust";
    case "rb": return "ruby";
    case "json": return "json";
    case "md": return "markdown";
    default: return "plaintext";
  }
}
