import { describe, expect, it } from "vitest";
import { codeRevealTimeline, MAX_CODE_REVEAL_MS, revealedCodeLength } from "./codeRevealTiming";

describe("shared-code reveal timeline", () => {
  it("retains every existing short-snippet character deadline", () => {
    const length = 95;
    const timeline = codeRevealTimeline(length);
    let elapsed = 0;
    for (let i = 0; i < length; i++) {
      elapsed += i / length < 0.3 ? 8 : i / length < 0.7 ? 14 : 22;
      expect(timeline[i]).toBe(elapsed);
      expect(revealedCodeLength(timeline, elapsed - 0.1)).toBe(i);
      expect(revealedCodeLength(timeline, elapsed)).toBe(i + 1);
    }
  });

  it.each([1, 95, 340, 341, 1189, 4096, 12000])("bounds a %i-character snippet and preserves monotonic pacing", length => {
    const timeline = codeRevealTimeline(length);
    expect(timeline.at(-1)).toBeLessThanOrEqual(MAX_CODE_REVEAL_MS);
    expect(timeline.every((value, i) => i === 0 || value > timeline[i - 1])).toBe(true);
    expect(revealedCodeLength(timeline, -1)).toBe(0);
    expect(revealedCodeLength(timeline, 0)).toBe(0);
    expect(revealedCodeLength(timeline, MAX_CODE_REVEAL_MS)).toBe(length);
    expect(revealedCodeLength(timeline, 60000)).toBe(length);
  });

  it("keeps long snippets decelerating rather than revealing uniformly", () => {
    const timeline = codeRevealTimeline(1000);
    expect(timeline.at(-1)).toBe(5000);
    const first = timeline[1] - timeline[0];
    const middle = timeline[501] - timeline[500];
    const last = timeline[999] - timeline[998];
    expect(middle / first).toBeCloseTo(14 / 8);
    expect(last / first).toBeCloseTo(22 / 8);
  });

  it("catches up after a missed frame without replaying skipped ticks", () => {
    const timeline = codeRevealTimeline(1189);
    expect(revealedCodeLength(timeline, 16)).toBeGreaterThan(0);
    expect(revealedCodeLength(timeline, 4800)).toBeGreaterThan(1000);
    expect(revealedCodeLength(timeline, 9000)).toBe(1189);
  });

  it("settles empty code without a deadline", () => {
    expect(codeRevealTimeline(0)).toEqual([]);
    expect(revealedCodeLength([], 0)).toBe(0);
  });
});
