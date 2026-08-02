import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AssistanceMove } from "../types";
import { ContextualGuideBridge } from "./ContextualGuideBridge";

const evidence = {
  code: "python-unclosed-parenthesis" as const,
  key: "python-unclosed-parenthesis:main.py:3",
  path: "main.py",
  line: 3,
  label: "Syntax error" as const,
};
const move: AssistanceMove = {
  id: "notice-unclosed-parenthesis",
  trigger: {
    type: "repeated_error",
    errorCode: "python-unclosed-parenthesis",
    minAttempts: 2,
  },
  learningMove: "observe",
  conceptTags: ["syntax"],
  question: "Which opening parenthesis still needs a closing partner?",
  maxScaffoldLevel: 1,
  productiveResponse: "Close it.",
  endsWhen: "evidence_changes",
};

describe("ContextualGuideBridge", () => {
  it("renders current evidence, authored question, and 44px controls", () => {
    const html = renderToStaticMarkup(
      <ContextualGuideBridge
        decision={{ kind: "result_bridge", move }}
        evidence={evidence}
        onViewError={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain("Syntax error on line 3");
    expect(html).toContain(move.question);
    expect(html).toContain("Jump to line 3");
    expect(html).toContain("min-h-11");
    expect(html).toContain("h-11 w-11");
    expect(html).toContain('aria-live="polite"');
  });

  it("renders nothing when policy is hidden", () => {
    expect(
      renderToStaticMarkup(
        <ContextualGuideBridge
          decision={{ kind: "hidden" }}
          evidence={evidence}
          onViewError={vi.fn()}
          onDismiss={vi.fn()}
        />,
      ),
    ).toBe("");
  });
});
