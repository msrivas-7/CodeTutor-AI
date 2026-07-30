import { describe, expect, it } from "vitest";
import { STRONGER_HINT, WRONG_EDIT_GENERIC } from "./scriptedTurns";

describe("first-run rescue pedagogy", () => {
  it("offers structural evidence without a pasteable complete solution", () => {
    for (const turn of [WRONG_EDIT_GENERIC(), STRONGER_HINT()]) {
      expect(turn).not.toMatch(/line-for-line/i);
      expect(turn).not.toMatch(/print\(["'`]Hello,\s*[^.…]+!["'`]\)/i);
    }
    expect(STRONGER_HINT()).toMatch(/parenthes|quotes/i);
  });
});
