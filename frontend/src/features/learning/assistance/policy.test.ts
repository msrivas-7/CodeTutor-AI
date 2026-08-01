import { describe, expect, it } from "vitest";
import type { AssistanceMove } from "../types";
import { deriveAssistanceContextV0 } from "./contextV0";
import { createAssistanceEpisodeState } from "./episode";
import type { AssistanceEvidence } from "./evidence";
import { selectAssistanceDecision } from "./policy";

const evidence: AssistanceEvidence = {
  code: "python-unclosed-parenthesis",
  key: "python-unclosed-parenthesis:main.py:1",
  path: "main.py",
  line: 1,
  label: "Syntax error",
};
const move: AssistanceMove = {
  id: "notice-unclosed-parenthesis",
  trigger: {
    type: "repeated_error",
    errorCode: "python-unclosed-parenthesis",
    minAttempts: 2,
  },
  learningMove: "observe",
  conceptTags: ["syntax"],
  question: "Which opening parenthesis needs a partner?",
  maxScaffoldLevel: 1,
  productiveResponse: "Close it, then run again.",
  endsWhen: "evidence_changes",
};

function context(blockingAttention = false) {
  return deriveAssistanceContextV0({
    projectContext: "lesson:course/lesson",
    projectRevision: 2,
    courseId: "course",
    lessonId: "lesson",
    latestRunEvidence: evidence,
    latestRunFailed: true,
    hasAcceptedRunResult: true,
    historicallyComplete: true,
    blockingAttention,
    learnerRequestedTutor: false,
  });
}

describe("selectAssistanceDecision", () => {
  it("bridges current evidence first, then selects authored copy at threshold", () => {
    const episode = {
      ...createAssistanceEpisodeState("course/lesson"),
      trackedEvidenceKey: evidence.key,
      currentEvidence: evidence,
      attempts: 1,
      lastAttemptRevision: 1,
    };
    expect(selectAssistanceDecision(true, context(), episode, [move])).toEqual({
      kind: "result_bridge",
      move: null,
    });
    expect(
      selectAssistanceDecision(true, context(), { ...episode, attempts: 2 }, [move]),
    ).toEqual({ kind: "result_bridge", move });
  });

  it("honors the internal flag, attention ownership, and dismissal", () => {
    const episode = {
      ...createAssistanceEpisodeState("course/lesson"),
      trackedEvidenceKey: evidence.key,
      currentEvidence: evidence,
      attempts: 2,
      lastAttemptRevision: 2,
    };
    expect(selectAssistanceDecision(false, context(), episode, [move])).toEqual({ kind: "hidden" });
    expect(selectAssistanceDecision(true, context(true), episode, [move])).toEqual({ kind: "hidden" });
    expect(
      selectAssistanceDecision(
        true,
        context(),
        { ...episode, suppressedEvidenceKey: evidence.key },
        [move],
      ),
    ).toEqual({ kind: "hidden" });
  });

  it("lets current failure own attention over historical completion", () => {
    const derived = context();
    expect(derived.historicallyComplete).toBe(true);
    expect(derived.currentValidity).toBe("failing");
    expect(derived.attentionOwner).toBe("run-result");
  });
});
