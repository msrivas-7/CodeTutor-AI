import { describe, expect, it } from "vitest";
import { parseTutorOutput } from "./tutorOutput.js";
import { TUTOR_RESPONSE_SCHEMA } from "./prompts/schema.js";

const files = [{ path: "main.py", content: "first\nsecond\nthird\n" }];

describe("parseTutorOutput", () => {
  it("accepts the model-authored conversational move metadata", () => {
    const parsed = parseTutorOutput(JSON.stringify({
      intent: "concept",
      conversationMove: "greeting",
      conversationReply: "Hello — glad you’re here. What would you like help with?",
      summary: "Hey there — glad you’re here.",
    }), []);

    expect(parsed.conversationMove).toBe("greeting");
    expect(parsed.conversationReply).toBe("Hello — glad you’re here. What would you like help with?");
  });

  it("accepts the model-authored redirect move", () => {
    const parsed = parseTutorOutput(JSON.stringify({
      intent: "howto",
      conversationMove: "redirect",
      conversationReply:
        "I can’t help with that request here, but I can help with this coding lesson.",
    }), []);

    expect(parsed.conversationMove).toBe("redirect");
  });

  it("publishes the parser's array bounds in the provider schema", () => {
    expect(TUTOR_RESPONSE_SCHEMA.properties.walkthrough.maxItems).toBe(6);
    expect(TUTOR_RESPONSE_SCHEMA.properties.checkQuestions.maxItems).toBe(3);
    expect(TUTOR_RESPONSE_SCHEMA.properties.citations.maxItems).toBe(20);
  });

  it("accepts bounded structured tutor text", () => {
    const result = parseTutorOutput(
      JSON.stringify({
        intent: "debug",
        summary: "The variable is used before it is assigned.",
        citations: [{ path: "main.py", line: 2, reason: "assignment" }],
      }),
      files,
    );
    expect(result.summary).toContain("variable");
    expect(result.citations).toHaveLength(1);
  });

  it("fails closed on malformed JSON and unknown top-level fields", () => {
    expect(() => parseTutorOutput("not json", files)).toThrow(/invalid tutor JSON/);
    expect(() =>
      parseTutorOutput(JSON.stringify({ summary: "ok", html: "<script>x</script>" }), files),
    ).toThrow(/invalid tutor sections/);
  });

  it("drops citations outside the current project or real line bounds", () => {
    const result = parseTutorOutput(
      JSON.stringify({
        summary: "Look here.",
        citations: [
          { path: "main.py", line: 999, reason: "invented line" },
          { path: "secret.py", line: 1, reason: "invented file" },
        ],
      }),
      files,
    );
    expect(result.citations).toEqual([]);
  });

  it("drops citations that point only to a trailing blank line", () => {
    const result = parseTutorOutput(
      JSON.stringify({
        summary: "Look here.",
        citations: [
          { path: "main.py", line: 4, reason: "blank trailing line" },
        ],
      }),
      files,
    );
    expect(result.citations).toEqual([]);
  });

  it("keeps a valid citation but neutralizes a zero-based model column", () => {
    const result = parseTutorOutput(
      JSON.stringify({
        summary: "Look here.",
        citations: [
          { path: "main.py", line: 2, column: 0, reason: "model omitted column" },
        ],
      }),
      files,
    );
    expect(result.citations?.[0]).toMatchObject({
      path: "main.py",
      line: 2,
      column: null,
    });
  });

  it("bounds a long citation label without rejecting the whole answer", () => {
    const result = parseTutorOutput(
      JSON.stringify({
        summary: "Look here.",
        citations: [
          { path: "main.py", line: 2, reason: "x".repeat(121) },
        ],
      }),
      files,
    );
    expect(result.citations?.[0].reason).toHaveLength(120);
  });

  it("neutralizes invalid walkthrough navigation but preserves plain text", () => {
    const result = parseTutorOutput(
      JSON.stringify({
        walkthrough: [{ body: "Inspect this step", path: "other.py", line: 7 }],
      }),
      files,
    );
    expect(result.walkthrough).toEqual([
      { body: "Inspect this step", path: null, line: null },
    ]);
  });

  it("rejects oversized text and arrays", () => {
    expect(() =>
      parseTutorOutput(JSON.stringify({ summary: "x".repeat(4_001) }), files),
    ).toThrow(/invalid tutor sections/);
    expect(() =>
      parseTutorOutput(
        JSON.stringify({ checkQuestions: ["1", "2", "3", "4"] }),
        files,
      ),
    ).toThrow(/invalid tutor sections/);
  });
});
