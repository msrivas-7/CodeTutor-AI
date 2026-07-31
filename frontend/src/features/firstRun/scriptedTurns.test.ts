import { describe, expect, it } from "vitest";
import {
  STRONGER_HINT,
  WRONG_EDIT_EMPTY,
  WRONG_EDIT_ERROR,
  WRONG_EDIT_GENERIC,
  WRONG_EDIT_LITERAL_EXAMPLE,
} from "./scriptedTurns";

describe("first-run rescue pedagogy", () => {
  it("offers structural evidence without a pasteable complete solution", () => {
    for (const turn of [WRONG_EDIT_GENERIC(), STRONGER_HINT()]) {
      expect(turn).not.toMatch(/line-for-line/i);
      expect(turn).not.toMatch(/print\(["'`]Hello,\s*[^.…]+!["'`]\)/i);
    }
    expect(STRONGER_HINT()).toMatch(/parenthes|quotes/i);
  });

  it("uses one clarifying question only for every first scripted rescue", () => {
    for (const turn of [
      WRONG_EDIT_LITERAL_EXAMPLE(),
      WRONG_EDIT_EMPTY(),
      WRONG_EDIT_ERROR(),
      WRONG_EDIT_GENERIC(),
    ]) {
      expect(turn.endsWith("?")).toBe(true);
      expect(turn.match(/\?/g)).toHaveLength(1);
      expect(turn).not.toMatch(/\b(?:change|replace|swap|use|add|make sure|try)\b/i);
      expect(turn).not.toContain("print(");
    }
  });
});
