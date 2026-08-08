import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseResult } from "../types";
import { FailedTestCallout } from "./FailedTestCallout";

function render(failure: TestCaseResult, consecutiveFails = 1) {
  return renderToStaticMarkup(
    <FailedTestCallout
      failure={failure}
      consecutiveFails={consecutiveFails}
      onAskTutor={vi.fn()}
    />,
  );
}

function failed(overrides: Partial<TestCaseResult>): TestCaseResult {
  return {
    name: "failed case",
    hidden: false,
    category: null,
    passed: false,
    actualRepr: null,
    expectedRepr: null,
    stdoutDuring: "",
    error: null,
    ...overrides,
  };
}

describe("FailedTestCallout mastery feedback", () => {
  it("leads a source-check rejection with the missing technique, not success copy", () => {
    const html = render(failed({
      name: "Delegate with super()",
      evidence: "source",
      feedback: "Use super() in both methods instead of duplicating Account logic.",
    }));

    expect(html).toContain("One required technique is still missing");
    expect(html).toContain("Use super() in both methods");
    expect(html).not.toMatch(/nice work|correct!|all tests pass/i);
  });

  it("shows expected and actual evidence for a visible failed example", () => {
    const html = render(failed({
      name: "all negative",
      evidence: "behavior",
      expectedRepr: "-2",
      actualRepr: "0",
    }));

    expect(html).toContain("Expected:");
    expect(html).toContain("Got:");
    expect(html).toContain("-2");
    expect(html).toContain("0");
  });

  it("keeps hidden inputs private while giving a bounded recovery path", () => {
    const first = render(failed({
      name: "immutable graph",
      hidden: true,
      evidence: "behavior",
      category: "immutability",
      expectedRepr: "secret expected value",
      actualRepr: "secret actual value",
    }));
    const second = render(failed({
      name: "immutable graph",
      hidden: true,
      evidence: "behavior",
      category: "immutability",
      expectedRepr: "secret expected value",
      actualRepr: "secret actual value",
    }), 2);

    expect(first).toContain("One tricky case didn&#x27;t work yet");
    expect(first).toContain("2–3 more inputs");
    expect(first).not.toContain("secret expected value");
    expect(first).not.toContain("secret actual value");
    expect(first).not.toContain("immutability");
    expect(second).toContain("immutability");
    expect(second).toContain("Ask tutor why");
  });
});
