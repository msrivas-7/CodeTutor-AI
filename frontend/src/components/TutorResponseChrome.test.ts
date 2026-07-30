import { describe, expect, it } from "vitest";
import { classifyAskError } from "./TutorResponseChrome";

describe("tutor recovery copy", () => {
  it("turns network failures into a specific, code-safe recovery state", () => {
    expect(classifyAskError("TypeError: Failed to fetch")).toEqual({
      kind: "network",
      title: "Connection lost",
      hint: "Your code is safe. Check your connection, then try the question again.",
    });
  });

  it("makes timeouts recoverable without blocking lesson progress", () => {
    const result = classifyAskError("upstream timed out");
    expect(result.title).toBe("Tutor took too long");
    expect(result.hint).toMatch(/code is safe/i);
    expect(result.hint).toMatch(/keep working without the tutor/i);
  });
});
