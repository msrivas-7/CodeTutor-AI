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
});
