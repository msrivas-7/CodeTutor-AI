import { describe, expect, it } from "vitest";
import { classifyAskError } from "./TutorResponseChrome";

describe("tutor recovery copy", () => {
  it("describes a stopped request without promising a quota refund", () => {
    const result = classifyAskError("TUTOR_CANCELED_BY_USER");
    expect(result.title).toBe("Stopped by you");
    expect(result.hint).toMatch(/may count toward today’s allowance/i);
    expect(result.hint).not.toMatch(/no question was used/i);
  });

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
