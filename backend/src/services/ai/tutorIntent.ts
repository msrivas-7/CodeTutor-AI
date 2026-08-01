import type {
  AIMessage,
  ProjectFile,
  TutorStage,
  TutorIntent,
} from "./provider.js";

const WALKTHROUGH = [
  /\bwalk(?:\s+me)?\s+through\b/,
  /\bwalkthrough\b/,
  /\bline\s+by\s+line\b/,
  /\btrace\s+through\b/,
  /\bhow\s+(?:this|the)\s+(?:code|file)\s+(?:flows?|works?)\b/,
  /\bwhat\s+does\s+(?:this|the|my)\s+(?:code|file)\s+do\b/,
  /\bnot\s+sure\s+how\s+it\s+(?:actually\s+)?flows?\b/,
];

const CHECKIN = [
  /\b(?:am|did)\s+i\b.*\b(?:right|close|correct)\b/,
  /\bis\s+(?:this|my|the)\b.*\b(?:right|okay|ok|correct|close|better|track|approach)\b/,
  /\b(?:right|on the right)\s+track\b/,
  /\bdoes\s+this\s+look\s+right\b/,
  /\bis\s+there\s+a\s+better\s+way\b/,
  /\bchecking\b.*\bis\s+this\b/,
  /\bpractice\s+exercise\s+right\b/,
  /\bchanging\s+the\s+right\s+part\b/,
  /\bapproach\s+(?:okay|ok|right|sound)\b/,
  /\b(?:answer|choice)\b.*\bright\b/,
];

const DEBUG = [
  /\b(?:error|exception|traceback|nameerror|typeerror|referenceerror|syntaxerror)\b/,
  /\b(?:bug|crash(?:es|ed|ing)?|broken|infinite\s+loop)\b/,
  /\b(?:doesn'?t|does not|won'?t|will not|isn'?t|is not)\s+(?:work|run|print|compile)\b/,
  /\b(?:what(?:'s| is)|why)\s+wrong\b/,
  /\bunexpected\s+(?:output|result|behavior)\b/,
  /\bstill\s+says\b/,
];

const HOWTO = [
  /\bhow\s+(?:do|can|should|would)\s+i\b/,
  /\bhow\s+should\s+i\b/,
  /\bhow\s+do\s+i\s+pass\b/,
  /\bwrite\s+(?:me\s+)?(?:the\s+)?(?:complete|finished|a)\b/,
  /\bguide\s+me\b/,
  /\bhow\s+i\s+(?:show|make|build|create|add|print|read|loop)\b/,
];

const CONCEPT = [
  /\bwhat\s+(?:is|are)\b/,
  /\bwhat\s+does\b/,
  /\bwhat\b.*\bmean\b/,
  /\b(?:difference|different)\s+between\b/,
  /\bwhy\s+(?:use|does|is|are)\b/,
  /\bexplain\s+(?:the\s+)?(?:idea|concept|term|variables?|strings?)\b/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Stable server-side turn classification. The model receives this result as a
 * trusted instruction and cannot relabel the UI by returning a different
 * `intent`. Rules are deliberately small, explainable, and covered by tests;
 * ambiguous requests fall back to concept help rather than a high-risk fix.
 */
export function classifyTutorIntent({
  question,
  files,
  history,
  tutorStage = "clarify",
}: {
  question: string;
  files: ProjectFile[];
  history?: AIMessage[];
  tutorStage?: TutorStage;
}): TutorIntent {
  const text = question.trim().toLocaleLowerCase();
  // Browser history is learner-controlled evidence, not progression proof.
  // Explicit read-only help promises are safe on the first turn because the
  // output firewall can ground them entirely in visible code/instructions.
  // All ambiguous, answer-seeking, hint, and check-in requests still require
  // the signed progression proof and fall back to one Socratic question.
  if (tutorStage === "clarify") {
    if (
      matchesAny(text, WALKTHROUGH) ||
      (files.length > 0 && /^(?:please\s+)?explain[.!?]?$/.test(text))
    ) return "walkthrough";
    if (
      /\b(?:explain|understand)\b[^.!?]{0,60}\b(?:task|instructions?|lesson)\b|\bwhat should i do in this lesson\b/i.test(text)
    ) {
      return "concept";
    }
    return "socratic";
  }

  if (
    matchesAny(text, WALKTHROUGH) ||
    (files.length > 0 && /^(?:please\s+)?explain[.!?]?$/.test(text))
  ) {
    return "walkthrough";
  }
  // A learner asking whether their change is right is a check-in even when
  // they also mention the error that motivated the change.
  if (matchesAny(text, CHECKIN)) return "checkin";
  if (matchesAny(text, DEBUG)) return "debug";
  if (matchesAny(text, HOWTO)) return "howto";
  if (matchesAny(text, CONCEPT)) return "concept";

  const priorAssistant = history?.at(-1)?.role === "assistant";
  if (priorAssistant && /^(?:continue|go on|and then|next)\b/.test(text)) {
    return "walkthrough";
  }
  return "concept";
}
