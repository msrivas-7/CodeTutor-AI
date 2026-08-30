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
        onAskTutor={vi.fn()}
        tutorOfferState="ready"
      />,
    );

    expect(html).toContain("Syntax error on line 3");
    expect(html).toContain(move.question);
    expect(html).toContain("Jump to line 3");
    expect(html).toContain("min-h-11");
    expect(html).toContain("h-11 w-11");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Help me spot it");
    expect(html).toContain("sends your current code and run evidence");
  });

  it("does not promise an AI call while Tutor access is unavailable", () => {
    const html = renderToStaticMarkup(
      <ContextualGuideBridge
        decision={{ kind: "result_bridge", move }}
        evidence={evidence}
        onViewError={vi.fn()}
        onDismiss={vi.fn()}
        onAskTutor={vi.fn()}
        tutorOfferState="unavailable"
      />,
    );
    expect(html).toContain("Open Tutor");
    expect(html).not.toContain(">Help me spot it<");
    expect(html).toContain(
      "Open Tutor moves focus to the Tutor without sending a question.",
    );
    expect(html).not.toContain("sends your current code and run evidence");
  });

  it("does not imply that context is sent while Tutor access is loading", () => {
    const html = renderToStaticMarkup(
      <ContextualGuideBridge
        decision={{ kind: "result_bridge", move }}
        evidence={evidence}
        onViewError={vi.fn()}
        onDismiss={vi.fn()}
        onAskTutor={vi.fn()}
        tutorOfferState="loading"
      />,
    );
    expect(html).toContain("Checking Tutor…");
    expect(html).toContain("Nothing is sent yet.");
    expect(html).not.toContain("sends your current code and run evidence");
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
