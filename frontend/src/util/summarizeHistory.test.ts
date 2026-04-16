import { describe, it, expect } from "vitest";
import type { AIMessage } from "../types";
import {
  KEEP_RECENT,
  SUMMARIZE_TRIGGER,
  planSend,
} from "./summarizeHistory";

// The summarize-and-continue trigger is the only piece of glue whose
// misbehaviour wouldn't be immediately obvious: if planSend silently sends
// the wrong slice, the tutor just gets quieter context without any visible
// error. These tests pin down the cutoff + slice math.

function mkHistory(n: number): AIMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turn-${i}`,
  }));
}

describe("planSend", () => {
  it("sends the whole history unchanged when under the trigger", () => {
    const h = mkHistory(SUMMARIZE_TRIGGER);
    const out = planSend({ history: h, summary: null, summarizedThrough: 0 });
    expect(out.shouldSummarize).toBe(false);
    expect(out.historyForSend).toEqual(h);
    expect(out.summarizeSlice).toEqual([]);
    expect(out.nextSummarizedThrough).toBe(0);
  });

  it("injects an existing summary as a synthetic head even under the trigger", () => {
    const h = mkHistory(4);
    const out = planSend({
      history: h,
      summary: "student is debugging a recursion issue",
      summarizedThrough: 0,
    });
    expect(out.historyForSend).toHaveLength(h.length + 1);
    expect(out.historyForSend[0]).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("[PRIOR CONTEXT SUMMARY]"),
    });
    expect(out.historyForSend[0].content).toContain(
      "student is debugging a recursion issue",
    );
  });

  it("flags shouldSummarize once we cross the trigger", () => {
    const h = mkHistory(SUMMARIZE_TRIGGER + 1);
    const out = planSend({ history: h, summary: null, summarizedThrough: 0 });
    expect(out.shouldSummarize).toBe(true);
    // Slice ends KEEP_RECENT before the tip.
    expect(out.summarizeSlice).toHaveLength(h.length - KEEP_RECENT);
    expect(out.nextSummarizedThrough).toBe(h.length - KEEP_RECENT);
  });

  it("does not re-summarize when summarizedThrough already covers the cutoff", () => {
    const h = mkHistory(SUMMARIZE_TRIGGER + 2);
    const cutoff = h.length - KEEP_RECENT;
    const out = planSend({
      history: h,
      summary: "previous summary",
      summarizedThrough: cutoff,
    });
    expect(out.shouldSummarize).toBe(false);
    expect(out.summarizeSlice).toEqual([]);
    expect(out.nextSummarizedThrough).toBe(cutoff);
    // The summary is still injected, and only the tail past `summarizedThrough`
    // is resent (the model already saw the head via the summary).
    expect(out.historyForSend[0].content).toContain("previous summary");
    expect(out.historyForSend.slice(1)).toEqual(h.slice(cutoff));
  });

  it("only re-summarizes when the head grows past the last compression point", () => {
    const h = mkHistory(SUMMARIZE_TRIGGER + 5);
    // Last compression covered the first 4 turns; the new cutoff moves forward.
    const out = planSend({
      history: h,
      summary: "old summary",
      summarizedThrough: 4,
    });
    expect(out.shouldSummarize).toBe(true);
    expect(out.summarizeSlice).toEqual(h.slice(0, h.length - KEEP_RECENT));
    expect(out.nextSummarizedThrough).toBe(h.length - KEEP_RECENT);
  });

  it("keeps the recent tail intact when summarizing", () => {
    const h = mkHistory(SUMMARIZE_TRIGGER + 3);
    const out = planSend({
      history: h,
      summary: "old summary",
      summarizedThrough: 0,
    });
    // The tail we send should be exactly the last history.length turns
    // (because summarizedThrough is still 0 for this turn), with the old
    // summary prepended. The NEW cutoff lands on nextSummarizedThrough.
    const tailSent = out.historyForSend.slice(1);
    expect(tailSent).toEqual(h);
    expect(h.slice(out.nextSummarizedThrough)).toHaveLength(KEEP_RECENT);
  });
});
