import { describe, it, expect } from "vitest";
import { parsePartialTutor } from "./partialJson";

// This parser runs on every streamed delta, on every tutor turn, and drives
// what the user sees live. Regressions here silently garble the assistant UI —
// that's why these edge cases are worth a failing build.

describe("parsePartialTutor", () => {
  it("returns {} for empty input", () => {
    expect(parsePartialTutor("")).toEqual({});
  });

  it("takes the fast path when the raw buffer is already valid JSON", () => {
    const raw = JSON.stringify({
      intent: "concept",
      summary: "x",
      explain: "y",
      checkQuestions: ["a", "b"],
    });
    expect(parsePartialTutor(raw)).toEqual({
      intent: "concept",
      summary: "x",
      explain: "y",
      checkQuestions: ["a", "b"],
    });
  });

  it("extracts a string field whose closing quote hasn't arrived yet", () => {
    const raw = '{"intent":"debug","summary":"this is half-';
    const out = parsePartialTutor(raw);
    expect(out.intent).toBe("debug");
    expect(out.summary).toBe("this is half-");
  });

  it("decodes \\n, \\t, \\\" and \\\\ inside a streaming field", () => {
    const raw = '{"summary":"line1\\nline2\\twith\\"quote\\"and\\\\slash"';
    const out = parsePartialTutor(raw);
    expect(out.summary).toBe('line1\nline2\twith"quote"and\\slash');
  });

  it("decodes \\uXXXX escapes", () => {
    const raw = '{"summary":"alpha=\\u03B1"';
    expect(parsePartialTutor(raw).summary).toBe("alpha=α");
  });

  it("stops mid-unicode escape instead of emitting a garbage char", () => {
    // Only 2 of 4 hex digits present — the parser must not invent a char.
    const raw = '{"summary":"start \\u03';
    const out = parsePartialTutor(raw);
    // Accept either truncation-before or the prefix text; crucially must
    // not contain the bogus "\u0003" that parseInt of "03" would yield.
    expect(out.summary).not.toContain("\u0003");
  });

  it("validates the `intent` enum and suppresses partial prefixes", () => {
    // Streaming intent mid-value: "de" is a prefix of "debug" but isn't itself
    // a valid enum value — the UI must not flash it.
    const partial = parsePartialTutor('{"intent":"de');
    expect(partial.intent).toBeUndefined();

    // Once the full value arrives the enum check passes.
    const complete = parsePartialTutor('{"intent":"debug"');
    expect(complete.intent).toBe("debug");
  });

  it("accepts every valid intent value", () => {
    for (const v of ["debug", "concept", "howto", "walkthrough", "checkin"]) {
      expect(parsePartialTutor(`{"intent":"${v}"`).intent).toBe(v);
    }
  });

  it("rejects an invalid intent value outright", () => {
    // If the model ever emits junk in the enum slot we drop it rather than
    // rendering a garbage badge.
    expect(parsePartialTutor('{"intent":"explain"').intent).toBeUndefined();
  });

  it("treats null-valued fields as absent", () => {
    // The tutor emits `null` for sections it chose not to fill — we must not
    // surface them as empty strings.
    const raw = '{"summary":"present","diagnose":null,"hint":null';
    const out = parsePartialTutor(raw);
    expect(out.summary).toBe("present");
    expect(out.diagnose).toBeUndefined();
    expect(out.hint).toBeUndefined();
  });

  it("doesn't surface array-valued fields from a partial buffer", () => {
    // walkthrough / checkQuestions / citations arrive as arrays; partial
    // array extraction is fragile so we only show them after full JSON parses.
    const raw = '{"summary":"s","checkQuestions":["first"';
    const out = parsePartialTutor(raw);
    expect(out.summary).toBe("s");
    // checkQuestions not in the string-key list — must not leak as a string.
    expect(out).not.toHaveProperty("checkQuestions");
  });

  it("returns the fully parsed object once closing brace arrives (fast path)", () => {
    const raw = '{"intent":"debug","summary":"done","checkQuestions":["a","b"],"citations":[]}';
    const out = parsePartialTutor(raw);
    expect(out.intent).toBe("debug");
    expect(out.summary).toBe("done");
    expect(out.checkQuestions).toEqual(["a", "b"]);
    expect(out.citations).toEqual([]);
  });
});
