import { describe, expect, it } from "vitest";
import { nextOutputTab } from "./OutputPanel";

describe("output tabs keyboard model", () => {
  it("wraps arrow navigation and supports Home and End", () => {
    expect(nextOutputTab("combined", "ArrowLeft")).toBe("stdin");
    expect(nextOutputTab("stdin", "ArrowRight")).toBe("combined");
    expect(nextOutputTab("stderr", "Home")).toBe("combined");
    expect(nextOutputTab("stdout", "End")).toBe("stdin");
  });

  it("leaves unrelated keys to the focused tab", () => {
    expect(nextOutputTab("stdout", "Enter")).toBeNull();
  });
});
