import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TutorResponseView } from "./TutorResponseViews";

describe("Socratic tutor response", () => {
  it("renders as a non-clickable Try first question with a clear next action", () => {
    const onAsk = vi.fn();
    const html = renderToStaticMarkup(
      <TutorResponseView
        sections={{
          intent: "socratic",
          checkQuestions: ["What did you expect to happen?"],
        }}
        onAsk={onAsk}
      />,
    );
    expect(html).toContain("Try first");
    expect(html).toContain("Your turn");
    expect(html).toContain("What did you expect to happen?");
    expect(html).toContain("Answer in your own words below");
    expect(html).not.toContain("<button");
  });

  it("renders the safe tutor Markdown subset as professional semantic content", () => {
    const html = renderToStaticMarkup(
      <TutorResponseView
        sections={{
          intent: "concept",
          explain:
            "**Objectives:**\n\n- Run a `program`\n- Inspect the output\n\n*Next:*\n\n1. Make one change\n2. Run it\n\n# Untrusted heading\n<img src=x onerror=alert(1)>",
        }}
      />,
    );
    expect(html).toContain("<ul");
    expect(html).toContain('class="ml-5 list-disc space-y-1"');
    expect(html).toContain("<ol");
    expect(html).toContain('class="ml-5 list-decimal space-y-1"');
    expect(html).toContain("<strong");
    expect(html).toContain("<em");
    expect(html).toContain("<code");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("renders a greeting as a clean conversation without unrelated teaching chrome", () => {
    const html = renderToStaticMarkup(
      <TutorResponseView
        sections={{
          intent: "concept",
          conversationMove: "greeting",
          conversationReply: "Hey — good to see you. Would you like a goal recap, a gentle hint, or a walkthrough?",
          summary: "The current code has an error.",
          explain: "Fix the current line.",
        }}
      />,
    );

    expect(html).toContain("Hey — good to see you.");
    expect(html).toContain("Would you like a goal recap");
    expect(html).not.toContain("The current code has an error.");
    expect(html).not.toContain("Fix the current line.");
    expect(html).not.toContain("Try first");
  });
});
