import type { Language } from "../../execution/commands.js";

export interface LessonContext {
  courseId: string;
  lessonId: string;
  // Retained after canonical resolution so progression proofs can bind to a
  // specific practice task instead of treating the whole lesson as one task.
  exerciseId: string | null;
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
  // Server-projected categories only. Raw validator rules can contain hidden
  // expected values and never enter the model prompt.
  completionCriteria: string[];
  studentProgressSummary: string;
  lessonOrder?: number;
  totalLessons?: number;
}

function formatTagList(tags: string[]): string {
  return tags.length === 0 ? "(none declared)" : tags.join(", ");
}

export function buildLessonContextBlock(ctx: LessonContext): string {
  const objectives = ctx.lessonObjectives.map((o) => `  - ${o}`).join("\n");
  const task = ctx.completionCriteria.join("; and ");

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
- Never reveal or confirm an authored retrieval/comprehension answer, even when the learner asks directly.
- If the student is stuck, give progressively stronger hints tied to the lesson task.`;
}
