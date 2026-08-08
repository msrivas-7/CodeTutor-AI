import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PracticeExercise, ValidationResult } from "../types";
import { PracticeInstructionsView } from "./PracticeInstructionsView";

const exercises: PracticeExercise[] = [
  {
    id: "first",
    title: "First challenge",
    goal: "Solve the first challenge.",
    prompt: "Print the expected value.",
    completionRules: [{ type: "expected_stdout", expected: "right" }],
  },
  {
    id: "second",
    title: "Second challenge",
    goal: "Solve the next challenge.",
    prompt: "Keep going.",
    completionRules: [{ type: "expected_stdout", expected: "next" }],
  },
];

function render(validation: ValidationResult | null) {
  return renderToStaticMarkup(
    <PracticeInstructionsView
      exercises={exercises}
      currentIndex={0}
      completedIds={["first"]}
      validation={validation}
      onSelectExercise={vi.fn()}
      onExitPractice={vi.fn()}
      onNextExercise={vi.fn()}
      onResetPractice={vi.fn(async () => true)}
    />,
  );
}

describe("PracticeInstructionsView completion state", () => {
  it("does not contradict a failed recheck with a success banner or advance action", () => {
    const html = render({
      passed: false,
      passedExceptRetrieval: false,
      feedback: ['Expected "right", but got "wrong"'],
    });

    expect(html).toContain("Not quite yet.");
    expect(html).not.toContain("You&#x27;ve completed this challenge.");
    expect(html).not.toContain("Next challenge");
  });

  it("shows completion and advance actions after a passing check", () => {
    const html = render({
      passed: true,
      passedExceptRetrieval: true,
      feedback: ["Output matches."],
    });

    expect(html).toContain("You&#x27;ve completed this challenge.");
    expect(html).toContain("Next challenge");
  });

  it("states the required exception outcome instead of rendering a blank value", () => {
    const exceptionExercise: PracticeExercise = {
      id: "raises",
      title: "Raise on invalid input",
      goal: "Raise a clear exception.",
      prompt: "Reject negative values.",
      completionRules: [{
        type: "function_tests",
        tests: [{
          name: "negative value",
          call: "validate(-1)",
          expectedError: { type: "ValueError", message: "must be positive" },
        }],
      }],
    };
    const html = renderToStaticMarkup(
      <PracticeInstructionsView
        exercises={[exceptionExercise]}
        currentIndex={0}
        completedIds={[]}
        validation={null}
        onSelectExercise={vi.fn()}
        onExitPractice={vi.fn()}
        onNextExercise={vi.fn()}
        onResetPractice={vi.fn(async () => true)}
      />,
    );

    expect(html).toContain("throws ValueError(&quot;must be positive&quot;)");
  });

  it("stacks and wraps long practice examples for a narrow resizable pane", () => {
    const longExercise: PracticeExercise = {
      id: "long-example",
      title: "Long example",
      goal: "Keep the full contract readable.",
      prompt: "Return the expected values.",
      completionRules: [{
        type: "function_tests",
        tests: [{
          name: "long call",
          call: "parse_or_default(['alpha', 'not-a-number', 'omega'], default=-100)",
          expected: "[100, -100, 900]",
        }],
      }],
    };
    const html = renderToStaticMarkup(
      <PracticeInstructionsView
        exercises={[longExercise]}
        currentIndex={0}
        completedIds={[]}
        validation={null}
        onSelectExercise={vi.fn()}
        onExitPractice={vi.fn()}
        onNextExercise={vi.fn()}
        onResetPractice={vi.fn(async () => true)}
      />,
    );

    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("Expected");
    expect(html).not.toContain("sm:grid-cols-");
    expect(html).not.toContain("overflow-x-auto");
  });
});
