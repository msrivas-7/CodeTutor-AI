import { describe, expect, it } from "vitest";
import { resolvePostCredits } from "./LessonCompletePanel";

// Phase A — A7: the post-credits ("next episode") beat. This line is the
// last thing a learner reads before deciding whether to continue, so the
// fallback chain and the anti-streak posture both matter.

describe("resolvePostCredits", () => {
  it("prefers the lesson's authored hint over the generated tease", () => {
    expect(
      resolvePostCredits(
        "In the next lesson, you'll greet different people by name.",
        "Variables and Types",
      ),
    ).toBe("In the next lesson, you'll greet different people by name.");
  });

  it("falls back to a tease built from the next lesson's title", () => {
    expect(resolvePostCredits(undefined, "Variables and Types")).toBe(
      "In the next lesson: Variables and Types.",
    );
  });

  it("returns null on the final lesson so nothing renders", () => {
    // CourseCompleteFlourish owns the end-of-course beat; a dangling
    // "In the next lesson:" with no lesson would undercut it.
    expect(resolvePostCredits(undefined, null)).toBeNull();
    expect(resolvePostCredits(undefined, undefined)).toBeNull();
  });

  it("treats a whitespace-only authored hint as absent", () => {
    expect(resolvePostCredits("   ", "Variables and Types")).toBe(
      "In the next lesson: Variables and Types.",
    );
  });

  it("treats a whitespace-only title as absent rather than teasing an empty lesson", () => {
    expect(resolvePostCredits(undefined, "   ")).toBeNull();
  });

  it("never emits streak/deadline framing in the generated tease", () => {
    // Anti-streak posture is a pre-committed refusal (roadmap-v2). The
    // authored-hint path is content-reviewed; the GENERATED path is code,
    // so pin it here.
    const line = resolvePostCredits(undefined, "Loops")!;
    expect(line).not.toMatch(/tomorrow|streak|don't lose|come back|daily/i);
  });
});
