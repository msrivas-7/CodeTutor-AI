import { describe, expect, it } from "vitest";
import {
  findDegradedTutorOutput,
  findUnexpectedOutputIntent,
  findUnsafeOutputSnippets,
} from "./evalDeterministic.js";

describe("findUnexpectedOutputIntent", () => {
  it("rejects a response intent that would select the wrong rendered interaction", () => {
    expect(
      findUnexpectedOutputIntent({ intent: "checkin" }, ["socratic"]),
    ).toEqual(["output intent checkin is not one of socratic"]);
  });

  it("accepts an explicitly approved semantic reclassification", () => {
    expect(
      findUnexpectedOutputIntent({ intent: "howto" }, ["checkin", "howto"]),
    ).toEqual([]);
  });
});

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

describe("findDegradedTutorOutput", () => {
  it("fails a check-in whose model review could not be trusted", () => {
    expect(
      findDegradedTutorOutput({
        intent: "checkin",
        diagnose:
          "I couldn’t complete a reliable review of the cited code in this response.",
      }),
    ).toEqual(["checkin used the transparent review-failure fallback"]);
  });

  it("fails a walkthrough whose unsafe steps were all removed", () => {
    expect(
      findDegradedTutorOutput({ intent: "walkthrough", walkthrough: [] }),
    ).toEqual(["walkthrough contained no safe concrete steps"]);
  });

  it("fails a generic walkthrough firewall fallback", () => {
    expect(
      findDegradedTutorOutput({
        intent: "walkthrough",
        walkthrough: [
          { body: "The list is created here.", path: "main.py", line: 1 },
          {
            body: "Inspect this step in the current flow.",
            path: "main.py",
            line: 2,
          },
        ],
      }),
    ).toEqual([
      "walkthrough[1].body used the generic safety fallback",
    ]);
  });

  it("allows a concrete grounded walkthrough", () => {
    expect(
      findDegradedTutorOutput({
        intent: "walkthrough",
        walkthrough: [
          { body: "The loop adds each value to total.", path: "main.py", line: 3 },
        ],
      }),
    ).toEqual([]);
  });
});
