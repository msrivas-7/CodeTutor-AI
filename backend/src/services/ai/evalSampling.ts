import { createHash } from "node:crypto";
import type {
  AIMessage,
  ProjectFile,
  TutorIntent,
  TutorSections,
  TutorStage,
} from "./provider.js";

export const AI_EVAL_CONSENT_VERSION = 1 as const;
export const AI_EVAL_SAMPLING_POLICY_VERSION = 1 as const;
export const AI_EVAL_REDACTION_VERSION = 1 as const;
export const AI_EVAL_SAMPLE_RATE = 0.05;
export const AI_EVAL_RETENTION_DAYS = 30;

const SUBJECT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT_HASH_LABEL = "codetutor-ai-eval-subject-v1";
const SAMPLE_HASH_LABEL = "codetutor-ai-eval-sample-v1";

const SAFE_WORDS = new Set(
  (
    "a about after again all already also am an and another any are as ask at " +
    "because before between both but by check close code concept correct could " +
    "debug did do does doing error explain fail first fix for from get go good " +
    "has have help here how i if in into is it its lesson line look make mean " +
    "more my next no not now of on one or output please question right run see " +
    "should so some step still string than that the their them then there these " +
    "they think this through to try two understand use value variable way what " +
    "when where which why with work works wrong you your approach summary diagnose " +
    "example walkthrough hint stronger pitfalls comprehension low medium high " +
    "socratic python javascript beginner tutor response input result loop function " +
    "condition list number text type return true false none yes"
  ).split(/\s+/),
);

const SECTION_ORDER: Array<keyof TutorSections> = [
  "summary",
  "diagnose",
  "explain",
  "example",
  "walkthrough",
  "checkQuestions",
  "hint",
  "nextStep",
  "strongerHint",
  "pitfalls",
  "comprehensionCheck",
];

export interface EvalRedactionStats {
  code: number;
  sensitive: number;
  identifiers: number;
}

export interface RedactedEvalText {
  text: string;
  stats: EvalRedactionStats;
}

export interface EvalSamplingConsent {
  version: typeof AI_EVAL_CONSENT_VERSION;
  subjectToken: string;
}

export interface ProjectedEvalSample {
  requestId: string;
  subjectTokenHash: string;
  consentVersion: number;
  samplingPolicyVersion: number;
  redactionVersion: number;
  model: string;
  language: string;
  courseId: string;
  lessonId: string;
  intent: TutorIntent;
  tutorStage: TutorStage;
  questionRedacted: string;
  responseRedacted: string;
  contentFingerprint: string;
  fileCount: number;
  sourceBytesBucket: "0" | "1-1024" | "1025-4096" | "4097-16384" | "16385+";
  historyTurnCount: number;
  hadRunResult: boolean;
  runErrorType: "none" | "compile" | "runtime" | "timeout" | "system" | null;
  sectionKeys: string[];
  codeRedactionCount: number;
  sensitiveRedactionCount: number;
  identifierRedactionCount: number;
}

export function isValidEvalSubjectToken(token: string): boolean {
  return SUBJECT_TOKEN_RE.test(token);
}

export function hashEvalSubjectToken(token: string): string {
  if (!isValidEvalSubjectToken(token)) {
    throw new Error("invalid eval sampling subject token");
  }
  return createHash("sha256")
    .update(`${SUBJECT_HASH_LABEL}:${token}`)
    .digest("hex");
}

/** Stable unbiased 5% bucket over browser-generated UUID request IDs. */
export function shouldSampleEvalRequest(requestId: string): boolean {
  const digest = createHash("sha256")
    .update(`${SAMPLE_HASH_LABEL}:${requestId}`)
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 < AI_EVAL_SAMPLE_RATE;
}

function replaceCounted(
  value: string,
  pattern: RegExp,
  replacement: string,
): { value: string; count: number } {
  let count = 0;
  return {
    value: value.replace(pattern, () => {
      count += 1;
      return replacement;
    }),
    count,
  };
}

function looksLikeCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    /^(?:def|class|import|from|const|let|var|function|for|while|if|elif|else|try|catch|return)\b/.test(trimmed) ||
    /(?:=>|===|!==|::|\{\}|\[\]|\bprint\s*\(|\bconsole\.\w+\s*\()/.test(trimmed) ||
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=/.test(trimmed) ||
    /[{};]\s*$/.test(trimmed)
  );
}

function normalizeSpacing(value: string): string {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Conservative pre-insert redaction. Unknown words are identifiers by
 * default; this intentionally sacrifices prose fidelity rather than attempt
 * unreliable name/identifier detection after storage.
 */
export function redactEvalText(input: string, maxLength: number): RedactedEvalText {
  const stats: EvalRedactionStats = { code: 0, sensitive: 0, identifiers: 0 };
  let value = input.normalize("NFKC").replace(/\r\n?/g, "\n");

  for (const pattern of [/```[\s\S]*?```/g, /`[^`\n]+`/g]) {
    const next = replaceCounted(value, pattern, " [code] ");
    value = next.value;
    stats.code += next.count;
  }

  value = value
    .split("\n")
    .map((line) => {
      if (!looksLikeCodeLine(line)) return line;
      stats.code += 1;
      return "[code]";
    })
    .join("\n");

  const sensitivePatterns: Array<[RegExp, string]> = [
    [/(?:sk|ghp|github_pat|xox[baprs]|AKIA)[-_A-Za-z0-9]{12,}/g, "[secret]"],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[secret]"],
    [/\b(?:password|passwd|secret|token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "[secret]"],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]"],
    [/\bhttps?:\/\/[^\s)\]}]+/gi, "[url]"],
    [/(?:^|\s)(?:\.{0,2}\/|~\/|\/[A-Za-z0-9._-]|[A-Za-z]:\\)[^\s,;:)}\]]+/g, " [path]"],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[identifier]"],
    [/(?<!\w)(?:\+?\d[\d ()-]{7,}\d)(?!\w)/g, "[phone]"],
    [/["'][^"'\n]{1,200}["']/g, "[literal]"],
  ];
  for (const [pattern, replacement] of sensitivePatterns) {
    const next = replaceCounted(value, pattern, ` ${replacement} `);
    value = next.value;
    stats.sensitive += next.count;
  }

  const tokens = value.match(/\[[a-z_]+\]|[A-Za-z][A-Za-z'-]*|\d+(?:\.\d+)?|[^\sA-Za-z\d]+/g) ?? [];
  const safeTokens = tokens.map((token) => {
    if (/^\[[a-z_]+\]$/.test(token)) return token;
    if (/^\d/.test(token)) {
      stats.sensitive += 1;
      return "[number]";
    }
    if (/^[A-Za-z]/.test(token)) {
      const normalized = token.toLowerCase().replace(/^['-]+|['-]+$/g, "");
      const beginsUppercase = /^[A-Z]/.test(token);
      if (SAFE_WORDS.has(normalized) && !beginsUppercase) return normalized;
      // Preserve the sentence-leading pronoun I; redact every other proper or
      // unknown word, including learner names and code identifiers.
      if (token === "I") return "i";
      stats.identifiers += 1;
      return "[identifier]";
    }
    return token;
  });

  const text = normalizeSpacing(safeTokens.join(" "))
    .replace(/\s+([,.;:!?])/g, "$1")
    .slice(0, maxLength)
    .trim();

  return { text: text || "[redacted]", stats };
}

function projectTutorResponse(sections: TutorSections): { text: string; keys: string[] } {
  const parts: string[] = [];
  const keys: string[] = [];
  for (const key of SECTION_ORDER) {
    const value = sections[key];
    if (value == null) continue;
    if (typeof value === "string" && value.trim()) {
      keys.push(key);
      parts.push(`${key}: ${value}`);
    } else if (Array.isArray(value) && value.length > 0) {
      keys.push(key);
      for (const item of value) {
        if (typeof item === "string") parts.push(`${key}: ${item}`);
        else if (item && typeof item === "object" && "body" in item) {
          parts.push(`${key}: ${String(item.body)}`);
        }
      }
    }
  }
  return { text: parts.join("\n") || "response unavailable", keys };
}

function sourceBytesBucket(files: ProjectFile[]): ProjectedEvalSample["sourceBytesBucket"] {
  const bytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  if (bytes === 0) return "0";
  if (bytes <= 1024) return "1-1024";
  if (bytes <= 4096) return "1025-4096";
  if (bytes <= 16_384) return "4097-16384";
  return "16385+";
}

export function projectEvalSample(input: {
  requestId: string;
  consent: EvalSamplingConsent;
  model: string;
  language: string;
  courseId: string;
  lessonId: string;
  intent: TutorIntent;
  tutorStage: TutorStage;
  question: string;
  files: ProjectFile[];
  history: AIMessage[];
  lastRun?: { errorType: ProjectedEvalSample["runErrorType"] } | null;
  sections: TutorSections;
}): ProjectedEvalSample {
  if (input.consent.version !== AI_EVAL_CONSENT_VERSION) {
    throw new Error("unsupported eval sampling consent version");
  }
  const question = redactEvalText(input.question, 2000);
  const responseProjection = projectTutorResponse(input.sections);
  const response = redactEvalText(responseProjection.text, 6000);
  const contentFingerprint = createHash("sha256")
    .update([
      AI_EVAL_REDACTION_VERSION,
      input.intent,
      input.tutorStage,
      question.text,
      response.text,
    ].join("\u001f"))
    .digest("hex");

  return {
    requestId: input.requestId,
    subjectTokenHash: hashEvalSubjectToken(input.consent.subjectToken),
    consentVersion: AI_EVAL_CONSENT_VERSION,
    samplingPolicyVersion: AI_EVAL_SAMPLING_POLICY_VERSION,
    redactionVersion: AI_EVAL_REDACTION_VERSION,
    model: input.model,
    language: input.language,
    courseId: input.courseId,
    lessonId: input.lessonId,
    intent: input.intent,
    tutorStage: input.tutorStage,
    questionRedacted: question.text,
    responseRedacted: response.text,
    contentFingerprint,
    fileCount: input.files.length,
    sourceBytesBucket: sourceBytesBucket(input.files),
    historyTurnCount: Math.min(input.history.length, 100),
    hadRunResult: input.lastRun != null,
    runErrorType: input.lastRun?.errorType ?? null,
    sectionKeys: responseProjection.keys,
    codeRedactionCount: question.stats.code + response.stats.code,
    sensitiveRedactionCount: question.stats.sensitive + response.stats.sensitive,
    identifierRedactionCount: question.stats.identifiers + response.stats.identifiers,
  };
}
