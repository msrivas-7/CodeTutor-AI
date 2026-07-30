import { commandFor, type Language } from "../../execution/commands.js";
import type { CompletionRule, FunctionTestSpec } from "../../../schema/lessonRuleSchema.js";

export type { CompletionRule, FunctionTestSpec };

export interface LessonContext {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  // The language the lesson is authored in. Drives the default entry file
  // when a completion rule omits `file`, and is echoed back to the tutor so
  // syntax examples match the learner's runtime.
  language: Language;
  lessonObjectives: string[];
  // Concepts this lesson INTRODUCES for the first time. Explaining these is the
  // point of the lesson; lean into them when the student asks.
  teachesConceptTags: string[];
  // Concepts this lesson RELIES ON from earlier lessons. Fair game to reference
  // briefly, but don't re-teach from scratch — the learner has already seen them.
  usesConceptTags: string[];
  // Everything the learner has been taught in earlier lessons (plus the course's
  // baseVocabulary). Use to scope explanations: anything outside this set + the
  // lesson's own teaches/uses is "future material" and should be avoided.
  priorConcepts: string[];
  completionRules: CompletionRule[];
  studentProgressSummary: string;
  lessonOrder?: number;
  totalLessons?: number;
}

function formatTagList(tags: string[]): string {
  return tags.length === 0 ? "(none declared)" : tags.join(", ");
}

export function buildLessonContextBlock(ctx: LessonContext): string {
  const entryFile = commandFor(ctx.language).entrypoint;
  const objectives = ctx.lessonObjectives.map((o) => `  - ${o}`).join("\n");
  const task = ctx.completionRules
    .map((r) => {
      if (r.type === "expected_stdout") return `produce stdout containing "${r.expected}"`;
      if (r.type === "forbidden_in_stdout") return `avoid producing stdout containing "${r.pattern}"`;
      if (r.type === "required_file_contains") return `write code in ${r.file ?? entryFile} containing \`${r.pattern}\``;
      if (r.type === "function_tests") return `define the tested function(s) at module scope so the harness can call them`;
      // Phase A — A1: the retrieval check is a separate UI gate the
      // learner answers in their own words; it isn't something the tutor
      // helps "solve" in the editor. Calling it out as a write-this-code
      // task (the prior fall-through "pass custom validation") would push
      // the tutor toward giving away the multiple-choice answer.
      if (r.type === "retrieval_check") return `answer a short comprehension question after the code is correct (this is a learner-facing check — do NOT reveal the answer)`;
      return `pass custom validation`;
    })
    .join("; and ");

  const orderInfo =
    ctx.lessonOrder && ctx.totalLessons
      ? ` (lesson ${ctx.lessonOrder} of ${ctx.totalLessons})`
      : "";

  return `GUIDED LESSON${orderInfo}
You are helping a student with a specific lesson: "${ctx.lessonTitle}".

Learning objectives:
${objectives}

Concepts this lesson TEACHES (new to the learner — lean into these): ${formatTagList(ctx.teachesConceptTags)}
Concepts this lesson USES (already taught earlier — reference briefly, don't re-teach): ${formatTagList(ctx.usesConceptTags)}
Concepts taught in EARLIER lessons (safe to reference): ${formatTagList(ctx.priorConcepts)}

The student must: ${task}
Progress: ${ctx.studentProgressSummary}

IMPORTANT LESSON RULES:
- Stay within the scope of this lesson's objectives.
- Do not introduce concepts that are NOT listed in "TEACHES", "USES", or "EARLIER lessons" above — those are future material the learner hasn't seen yet.
- Reference the specific task the student is working on.
- Guide toward the solution without giving it away.
- If the student is stuck, give progressively stronger hints tied to the lesson task.`;
}
