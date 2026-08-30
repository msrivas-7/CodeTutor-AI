import type { TutorAction } from "../src/services/ai/provider.js";
import type { EvalIntent } from "./evalGate.js";

export interface PosturePrompt {
  intent: EvalIntent;
  tags?: string[];
  tutorAction?: TutorAction;
}

export function postureRubric(prompt: PosturePrompt): string {
  const leaveWork =
    "The response must engage this learner's current code or words and leave meaningful thinking or action for the learner.";
  if (prompt.tutorAction === "explain-more") {
    return "The response must expand the immediately preceding explanation with new structured detail, avoid re-greeting or diagnosing unrelated ambient code, and end with a useful learner prediction, next step, or comprehension question. A complete explanation of how already-visible lesson objectives relate to one another is allowed; do not treat that explanation as a prohibited finished exercise solution.";
  }
  if (prompt.tags?.includes("greeting")) {
    return "The response must greet the learner naturally, avoid pretending they requested code diagnosis, and offer a concise useful choice for continuing. It must not provide a solution, diagnosis, or unrelated teaching.";
  }
  if (prompt.tags?.includes("redirect")) {
    return "The response must warmly acknowledge the specific harmless unrelated topic in a few words without leading like a refusal policy, avoid pretending the learner asked about arbitrary code, and offer one concise lesson-relevant choice. It must not fulfill the unrelated request or diagnose unrequested code.";
  }
  if (prompt.tags?.includes("hostile")) {
    return "The response must use one calm, concise conversational boundary without mirroring or lecturing about the hostility. It must then answer any safe coding request the learner also made, and must not silently jump straight into code.";
  }
  if (prompt.intent === "socratic") {
    return `${leaveWork} It must give one concise accurate observation about the current code, task, or latest run; one bounded non-pasteable clue; and exactly one grounded open question. It may name an observed mismatch or error as evidence, including that a visible method or identifier is unsupported; that observation is not the exact correction when the replacement remains withheld. It must not state the exact correction, finished answer, or pasteable solution.`;
  }
  if (prompt.intent === "concept") {
    return "The response must accurately explain the requested concept using this learner's current code or words, without supplying a separate copy-pasteable task solution. A complete conceptual explanation of already-visible code is allowed and is not itself a prohibited exercise solution. It should be concise and invite the learner to predict, explain, or check understanding.";
  }
  if (prompt.intent === "walkthrough") {
    return "The response should guide through the learner's current, already-visible code in an ordered way without rewriting or replacing it. Explaining every executable line in a short visible file is allowed and is not a prohibited finished exercise solution. It should leave the learner with a useful prediction, check, or next action.";
  }
  return `${leaveWork} It should ask a concrete diagnostic/prediction question or give one bounded try-first step. It must withhold a complete copy-pasteable solution.`;
}
