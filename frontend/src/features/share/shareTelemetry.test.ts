import { describe, expect, it } from "vitest";
import { isNativeShareCancellation } from "./shareTelemetry";

describe("share outcome classification", () => {
  it("classifies only AbortError as a learner-cancelled native share", () => {
    expect(
      isNativeShareCancellation(new DOMException("cancelled", "AbortError")),
    ).toBe(true);
    expect(
      isNativeShareCancellation(
        new DOMException("blocked", "NotAllowedError"),
      ),
    ).toBe(false);
    expect(isNativeShareCancellation(new Error("network"))).toBe(false);
    expect(isNativeShareCancellation("AbortError")).toBe(false);
  });
});
