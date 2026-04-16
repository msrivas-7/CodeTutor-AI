import { describe, it, expect } from "vitest";
import type { AIMessage, ProjectFile, RunResult } from "./provider.js";
import {
  studentSeemsStuck,
  buildSystemPrompt,
  buildUserTurn,
  TUTOR_RESPONSE_SCHEMA,
} from "./promptBuilder.js";

describe("studentSeemsStuck", () => {
  it.each([
    "I'm stuck",
    "i give up",
    "just tell me the answer",
    "can you just give me the fix",
    "i have no idea what's happening",
    "what line is the bug on",
    "which line is wrong",
    "show me the fix please",
    "I don't understand this error",
    "I'm confused",
    "this doesn't make sense to me",
    "I've tried everything",
    "I'm frustrated",
    "it's still broken",
  ])("detects stuck signal in %j", (q) => {
    expect(studentSeemsStuck(q)).toBe(true);
  });

  it.each([
    "what does this function do",
    "why is the output empty",
    "can you explain recursion",
    "is there a better approach here",
  ])("returns false for neutral questions like %j", (q) => {
    expect(studentSeemsStuck(q)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(studentSeemsStuck("I GIVE UP")).toBe(true);
    expect(studentSeemsStuck("Stuck Here")).toBe(true);
  });
});

const noHistory: AIMessage[] = [];
const oneTutorTurn: AIMessage[] = [
  { role: "user", content: "first" },
  { role: "assistant", content: "reply" },
];

describe("buildSystemPrompt", () => {
  it("always includes the core tutor rules", () => {
    const prompt = buildSystemPrompt(noHistory, "anything");
    expect(prompt).toMatch(/coding TUTOR/);
    expect(prompt).toMatch(/Never invent library APIs/);
    expect(prompt).toMatch(/GUIDE, don't solve/);
  });

  it("describes the five intents the model must classify into", () => {
    const prompt = buildSystemPrompt(noHistory, "anything");
    expect(prompt).toMatch(/\bdebug\b/);
    expect(prompt).toMatch(/\bconcept\b/);
    expect(prompt).toMatch(/\bhowto\b/);
    expect(prompt).toMatch(/\bwalkthrough\b/);
    expect(prompt).toMatch(/\bcheckin\b/);
  });

  it("includes SITUATION block with counts and stuck flag", () => {
    const prompt = buildSystemPrompt(oneTutorTurn, "why doesn't this work");
    expect(prompt).toMatch(/SITUATION:/);
    expect(prompt).toMatch(/Prior tutor turns in this conversation: 1/);
    expect(prompt).toMatch(/Student signalled being stuck: false/);
  });

  it("reports run/edit counts from options, defaulting to 0", () => {
    const prompt = buildSystemPrompt(noHistory, "anything", {
      runsSinceLastTurn: 3,
      editsSinceLastTurn: 7,
    });
    expect(prompt).toMatch(/Runs since last tutor turn: 3/);
    expect(prompt).toMatch(/Edits since last tutor turn: 7/);

    const defaulted = buildSystemPrompt(noHistory, "anything");
    expect(defaulted).toMatch(/Runs since last tutor turn: 0/);
    expect(defaulted).toMatch(/Edits since last tutor turn: 0/);
  });

  it("reports stuck=true when the question signals it", () => {
    const prompt = buildSystemPrompt(noHistory, "i'm stuck");
    expect(prompt).toMatch(/Student signalled being stuck: true/);
  });

  it("reports 0 prior tutor turns when history is empty", () => {
    const prompt = buildSystemPrompt(noHistory, "anything");
    expect(prompt).toMatch(/Prior tutor turns in this conversation: 0/);
  });

  it("ignores user-role messages when counting tutor turns", () => {
    // Three user messages but zero assistant messages — still 0 prior tutor turns.
    const history: AIMessage[] = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(buildSystemPrompt(history, "another question")).toMatch(
      /Prior tutor turns in this conversation: 0/,
    );
  });

  it("keeps debug-intent escalation rules tied to the SITUATION flags", () => {
    const prompt = buildSystemPrompt(noHistory, "anything");
    expect(prompt).toMatch(/intent="debug"/);
    expect(prompt).toMatch(/0 prior turns AND not stuck/);
    expect(prompt).toMatch(/Stuck = true/);
  });
});

describe("TUTOR_RESPONSE_SCHEMA", () => {
  it("requires every top-level field (strict-mode requirement)", () => {
    // OpenAI strict json_schema requires every property in `required`.
    const props = Object.keys(TUTOR_RESPONSE_SCHEMA.properties);
    const required = [...TUTOR_RESPONSE_SCHEMA.required];
    expect(required.sort()).toEqual(props.sort());
  });

  it("exposes the five intent values as an enum on `intent`", () => {
    const intent = TUTOR_RESPONSE_SCHEMA.properties.intent;
    expect(intent.type).toBe("string");
    expect([...intent.enum].sort()).toEqual(
      ["checkin", "concept", "debug", "howto", "walkthrough"].sort(),
    );
  });

  it("includes citations as an array of {path, line, column, reason}", () => {
    const cit = TUTOR_RESPONSE_SCHEMA.properties.citations;
    expect(cit.type).toContain("array");
    expect([...cit.items.required].sort()).toEqual(
      ["column", "line", "path", "reason"].sort(),
    );
  });

  it("includes walkthrough as an array of {body, path, line}", () => {
    const walk = TUTOR_RESPONSE_SCHEMA.properties.walkthrough;
    expect(walk.type).toContain("array");
    expect([...walk.items.required].sort()).toEqual(
      ["body", "line", "path"].sort(),
    );
  });
});

const sampleRun: RunResult = {
  stdout: "hello",
  stderr: "",
  exitCode: 0,
  errorType: "none",
  durationMs: 42,
  stage: "run",
};

describe("buildUserTurn", () => {
  it("places the active file first, then sorts the rest alphabetically", () => {
    const files: ProjectFile[] = [
      { path: "z.py", content: "z" },
      { path: "a.py", content: "a" },
      { path: "main.py", content: "main" },
    ];
    const body = buildUserTurn({
      question: "?",
      files,
      activeFile: "main.py",
      history: [],
    });
    const mainIdx = body.indexOf("--- main.py (ACTIVE) ---");
    const aIdx = body.indexOf("--- a.py ---");
    const zIdx = body.indexOf("--- z.py ---");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(mainIdx);
    expect(zIdx).toBeGreaterThan(aIdx);
  });

  it("marks only the active file with (ACTIVE)", () => {
    const files: ProjectFile[] = [
      { path: "a.py", content: "a" },
      { path: "b.py", content: "b" },
    ];
    const body = buildUserTurn({ question: "?", files, activeFile: "a.py", history: [] });
    expect(body).toMatch(/--- a\.py \(ACTIVE\) ---/);
    expect(body).not.toMatch(/--- b\.py \(ACTIVE\) ---/);
  });

  it("truncates long file contents with a marker", () => {
    const longContent = "x".repeat(5000); // > MAX_FILE_CHARS (4000)
    const body = buildUserTurn({
      question: "?",
      files: [{ path: "big.py", content: longContent }],
      history: [],
    });
    expect(body).toMatch(/\[truncated, 1000 more chars\]/);
  });

  it("renders 'No run yet.' when lastRun is null", () => {
    const body = buildUserTurn({
      question: "?",
      files: [],
      history: [],
      lastRun: null,
    });
    expect(body).toMatch(/LAST RUN:\nNo run yet\./);
  });

  it("renders run stdout/stderr/exitCode when lastRun is present", () => {
    const body = buildUserTurn({
      question: "?",
      files: [],
      history: [],
      lastRun: { ...sampleRun, stdout: "hello out", stderr: "err text" },
    });
    expect(body).toMatch(/stdout:\nhello out/);
    expect(body).toMatch(/stderr:\nerr text/);
    expect(body).toMatch(/exitCode: 0/);
    expect(body).toMatch(/errorType: none/);
  });

  it("renders (no prior turns) when history is empty", () => {
    const body = buildUserTurn({ question: "?", files: [], history: [] });
    expect(body).toMatch(/RECENT CONVERSATION:\n\(no prior turns\)/);
  });

  it("keeps only the last 6 history messages", () => {
    const history: AIMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as AIMessage["role"],
      content: `msg${i}`,
    }));
    const body = buildUserTurn({ question: "?", files: [], history });
    expect(body).not.toMatch(/msg0\b/);
    expect(body).not.toMatch(/msg3\b/);
    expect(body).toMatch(/msg4\b/);
    expect(body).toMatch(/msg9\b/);
  });

  it("includes language, question, and section headers", () => {
    const body = buildUserTurn({
      question: "why is this broken",
      files: [],
      language: "python",
      history: [],
    });
    expect(body).toMatch(/LANGUAGE: python/);
    expect(body).toMatch(/PROJECT FILES:/);
    expect(body).toMatch(/STDIN:/);
    expect(body).toMatch(/LAST RUN:/);
    expect(body).toMatch(/CHANGES SINCE LAST TUTOR TURN:/);
    expect(body).toMatch(/RECENT CONVERSATION:/);
    expect(body).toMatch(/STUDENT QUESTION:\nwhy is this broken/);
  });

  it("renders '(no stdin provided)' when stdin is missing or blank", () => {
    const blank = buildUserTurn({ question: "?", files: [], history: [], stdin: "" });
    const whitespace = buildUserTurn({ question: "?", files: [], history: [], stdin: "   \n  " });
    const missing = buildUserTurn({ question: "?", files: [], history: [] });
    expect(blank).toMatch(/STDIN:\n\(no stdin provided\)/);
    expect(whitespace).toMatch(/STDIN:\n\(no stdin provided\)/);
    expect(missing).toMatch(/STDIN:\n\(no stdin provided\)/);
  });

  it("renders stdin contents when provided", () => {
    const body = buildUserTurn({
      question: "?",
      files: [],
      history: [],
      stdin: "1 2 3\n4 5 6\n",
    });
    expect(body).toMatch(/STDIN:\n1 2 3\n4 5 6/);
  });

  it("renders '(first tutor turn — no prior snapshot)' when no diff is given", () => {
    const body = buildUserTurn({ question: "?", files: [], history: [] });
    expect(body).toMatch(/CHANGES SINCE LAST TUTOR TURN:\n\(first tutor turn/);
  });

  it("renders diff contents when provided", () => {
    const diff = "--- main.py (MODIFIED) ---\n  1: x = 1\n- 2: y = 2\n+ 2: y = 3";
    const body = buildUserTurn({ question: "?", files: [], history: [], diffSinceLastTurn: diff });
    expect(body).toContain("--- main.py (MODIFIED) ---");
    expect(body).toContain("+ 2: y = 3");
  });

  it("falls back to 'unspecified' when no language is given", () => {
    const body = buildUserTurn({ question: "?", files: [], history: [] });
    expect(body).toMatch(/LANGUAGE: unspecified/);
  });

  it("omits the SELECTION block when no selection is given", () => {
    const body = buildUserTurn({ question: "?", files: [], history: [] });
    expect(body).not.toMatch(/STUDENT SELECTION/);
  });

  it("omits the SELECTION block when selection text is blank", () => {
    const body = buildUserTurn({
      question: "?",
      files: [],
      history: [],
      selection: { path: "main.py", startLine: 1, endLine: 1, text: "   \n" },
    });
    expect(body).not.toMatch(/STUDENT SELECTION/);
  });

  it("renders a single-line selection with 'line N'", () => {
    const body = buildUserTurn({
      question: "?",
      files: [],
      history: [],
      selection: {
        path: "main.py",
        startLine: 7,
        endLine: 7,
        text: "return mean(xs)",
      },
    });
    expect(body).toMatch(/STUDENT SELECTION \(focus answer here when relevant\):/);
    expect(body).toMatch(/--- main\.py \(line 7\) ---\nreturn mean\(xs\)/);
  });

  it("renders a multi-line selection with 'lines A-B' and places it before the question", () => {
    const body = buildUserTurn({
      question: "explain this",
      files: [],
      history: [],
      selection: {
        path: "stats.py",
        startLine: 4,
        endLine: 8,
        text: "def median(xs):\n    s = sorted(xs)\n    n = len(s)\n    mid = n // 2\n    return s[mid]",
      },
    });
    const selIdx = body.indexOf("STUDENT SELECTION");
    const qIdx = body.indexOf("STUDENT QUESTION:");
    expect(selIdx).toBeGreaterThan(-1);
    expect(qIdx).toBeGreaterThan(selIdx);
    expect(body).toMatch(/--- stats\.py \(lines 4-8\) ---/);
    expect(body).toMatch(/def median\(xs\):/);
  });

  it("truncates a very large selection with a marker", () => {
    const body = buildUserTurn({
      question: "?",
      files: [],
      history: [],
      selection: {
        path: "big.py",
        startLine: 1,
        endLine: 500,
        text: "x".repeat(3000), // > MAX_SELECTION_CHARS (2000)
      },
    });
    expect(body).toMatch(/\[truncated, 1000 more chars\]/);
  });
});
