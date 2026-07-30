import { describe, expect, it } from "vitest";
import { masteryLabel } from "./MasteryRing";

describe("public completion labels", () => {
  it("describes evidence without overclaiming mastery", () => {
    expect(masteryLabel("strong")).toBe("Completed confidently");
    expect(masteryLabel("okay")).toBe("Lesson completed");
    expect(masteryLabel("shaky")).toBe("Kept going and finished");
  });

  it("does not use mastery language for a single lesson artifact", () => {
    for (const tier of ["strong", "okay", "shaky"] as const) {
      expect(masteryLabel(tier)).not.toMatch(/mastery|expert|advanced/i);
    }
  });
});
