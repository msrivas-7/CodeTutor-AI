import { describe, expect, it } from "vitest";
import { LESSON_FEEDBACK_MOODS } from "./LessonFeedbackChip";

// Pin the mood → category mapping. The chip lies next to "Lesson Complete!"
// so mis-categorising 😕 as "other" would silently hide every "that was
// confusing" signal inside general feedback traffic. If product changes the
// mapping, update the feedback modal copy in parallel — don't just flip it.

describe("LESSON_FEEDBACK_MOODS", () => {
  it("lists exactly three moods in good → okay → bad order", () => {
    expect(LESSON_FEEDBACK_MOODS.map((m) => m.mood)).toEqual(["good", "okay", "bad"]);
  });

  it("maps 😕 (bad) to category=bug so confusion becomes triageable signal", () => {
    const bad = LESSON_FEEDBACK_MOODS.find((m) => m.mood === "bad")!;
    expect(bad.category).toBe("bug");
  });

  it("maps 😊 and 😐 to category=other — positive / neutral aren't bugs", () => {
    for (const mood of ["good", "okay"] as const) {
      const m = LESSON_FEEDBACK_MOODS.find((x) => x.mood === mood)!;
      expect(m.category).toBe("other");
    }
  });

  it("gives every mood a distinct non-empty accessible label", () => {
    const labels = LESSON_FEEDBACK_MOODS.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
  });
});
