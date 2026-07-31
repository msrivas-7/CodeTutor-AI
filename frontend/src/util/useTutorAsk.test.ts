import { describe, expect, it } from "vitest";
import { historyForTutor } from "./useTutorAsk";

describe("historyForTutor", () => {
  it("removes scripted narration and strips browser-only metadata", () => {
    expect(historyForTutor([
      {
        id: "scripted",
        role: "assistant",
        content: "Welcome narration",
        meta: { scripted: true },
        sections: { summary: "Welcome narration" },
      },
      { id: "user", role: "user", content: "I expected hello" },
      {
        id: "assistant",
        role: "assistant",
        content: "What happened instead?",
        sections: { intent: "socratic" },
      },
    ])).toEqual([
      { role: "user", content: "I expected hello" },
      { role: "assistant", content: "What happened instead?" },
    ]);
  });
});
