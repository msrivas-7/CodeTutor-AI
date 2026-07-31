import type { AIMessage, EditorSelection, Persona, ProjectFile, RunResult, TutorStage } from "./provider.js";
import { TUTOR_CORE_PROMPT } from "./prompts/coreRules.js";
import { studentSeemsStuck } from "./prompts/stuckDetection.js";
import { PERSONA_BLOCK } from "./prompts/persona.js";
import { buildSituationBlock } from "./prompts/situation.js";
import {
  renderFiles,
  renderRun,
  renderHistory,
  renderStdin,
  renderDiff,
  renderSelection,
} from "./prompts/renderContext.js";
import { TUTOR_RESPONSE_SCHEMA } from "./prompts/schema.js";
import { SUMMARIZE_SYSTEM_PROMPT, buildSummarizeInput } from "./prompts/summarize.js";

export { studentSeemsStuck, TUTOR_RESPONSE_SCHEMA, SUMMARIZE_SYSTEM_PROMPT, buildSummarizeInput };

export interface SystemPromptOptions {
  runsSinceLastTurn?: number;
  editsSinceLastTurn?: number;
  persona?: Persona;
  tutorStage?: TutorStage;
}

export function buildSystemPrompt(
  history: AIMessage[],
  question: string,
  opts: SystemPromptOptions = {},
): string {
  const situation = buildSituationBlock({
    history,
    question,
    runsSinceLastTurn: opts.runsSinceLastTurn,
    editsSinceLastTurn: opts.editsSinceLastTurn,
    tutorStage: opts.tutorStage,
  });
  const personaBlock = opts.persona ? PERSONA_BLOCK[opts.persona] : null;
  return [TUTOR_CORE_PROMPT, situation, personaBlock].filter(Boolean).join("\n\n");
}

export interface BuildUserTurnParams {
  question: string;
  files: ProjectFile[];
  activeFile?: string;
  language?: string;
  lastRun?: RunResult | null;
  history: AIMessage[];
  stdin?: string | null;
  diffSinceLastTurn?: string | null;
  selection?: EditorSelection | null;
}

export function buildUserTurn(p: BuildUserTurnParams): string {
  const sections: string[] = [
    `LANGUAGE: ${p.language ?? "unspecified"}`,
    "",
    "PROJECT FILES:",
    renderFiles(p.files, p.activeFile),
    "",
    "STDIN:",
    renderStdin(p.stdin),
    "",
    "LAST RUN:",
    renderRun(p.lastRun),
    "",
    "CHANGES SINCE LAST TUTOR TURN:",
    renderDiff(p.diffSinceLastTurn),
    "",
    "RECENT CONVERSATION:",
    renderHistory(p.history),
  ];

  const selectionBlock = renderSelection(p.selection);
  if (selectionBlock) {
    sections.push("", "STUDENT SELECTION (focus answer here when relevant):", selectionBlock);
  }

  sections.push("", "STUDENT QUESTION:", p.question);
  return sections.join("\n");
}
