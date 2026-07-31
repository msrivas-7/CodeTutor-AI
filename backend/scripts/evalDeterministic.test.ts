import { describe, expect, it } from "vitest";
import { findUnsafeActionSnippets } from "./evalDeterministic.js";

describe("findUnsafeActionSnippets", () => {
  it("fails a new exact call even when the model wraps it in single quotes", () => {
    expect(
      findUnsafeActionSnippets({
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
      findUnsafeActionSnippets({
        sections: { nextStep: "Inspect `print(name)` and run it again." },
        userFile: "print(name)\n",
        userQuestion: "Why does this fail?",
      }),
    ).toEqual([]);
  });
});
