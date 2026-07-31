import { describe, expect, it } from "vitest";
import { findUnsafeOutputSnippets } from "./evalDeterministic.js";

describe("findUnsafeOutputSnippets", () => {
  it("fails a new exact call even when the model wraps it in single quotes", () => {
    expect(
      findUnsafeOutputSnippets({
        sections: {
          nextStep: "Use 'print(\"Age: \" + str(age))' now.",
        },
        userFile: 'age = 12\nprint("Age: " + age)\n',
        userQuestion: "Why is this a TypeError?",
      }),
    ).toContain("nextStep introduced a new pasteable call");
  });

  it("allows a reference to a call already visible in the learner file", () => {
    expect(
      findUnsafeOutputSnippets({
        sections: { nextStep: "Inspect `print(name)` and run it again." },
        userFile: "print(name)\n",
        userQuestion: "Why does this fail?",
      }),
    ).toEqual([]);
  });

  it("checks prose, walkthrough, questions, and citation reasons", () => {
    expect(
      findUnsafeOutputSnippets({
        sections: {
          summary: "Replace it with `total = sum(values)`.",
          explain: "Then call render(result).",
          walkthrough: [{ body: "Return `answer => answer + 1`." }],
          checkQuestions: ["What happens after save(result)?"],
          citations: [{ path: "main.py", line: 1, reason: "Use print(answer)." }],
        },
        userFile: "values = [1, 2]\n",
        userQuestion: "How do I finish this?",
      }),
    ).toEqual(
      expect.arrayContaining([
        "summary introduced a new pasteable call",
        "explain introduced a new pasteable call",
        "walkthrough[0].body introduced a pasteable code construct",
        "checkQuestions[0] introduced a new pasteable call",
        "citations[0].reason introduced a new pasteable call",
      ]),
    );
  });
});
