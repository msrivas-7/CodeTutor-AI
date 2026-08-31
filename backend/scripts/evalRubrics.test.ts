import { describe, expect, it } from "vitest";
import { postureRubric } from "./evalRubrics.js";

describe("postureRubric", () => {
  it("does not contradict complete explanations of visible objectives", () => {
    const rubric = postureRubric({ intent: "concept", tutorAction: "explain-more" });

    expect(rubric).toContain("complete explanation");
    expect(rubric).not.toContain("withhold a complete");
    expect(rubric).toContain("prediction, next step, or comprehension question");
  });

  it("does not classify a walkthrough of visible code as a finished solution", () => {
    const rubric = postureRubric({ intent: "walkthrough" });

    expect(rubric).toContain("already-visible code");
    expect(rubric).toContain("not a prohibited finished exercise solution");
    expect(rubric).not.toContain("withhold a complete");
  });

  it("retains answer-withholding language for solution-seeking intents", () => {
    const rubric = postureRubric({ intent: "debug" });

    expect(rubric).toContain("withhold a complete copy-pasteable solution");
  });
});
