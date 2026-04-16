import { describe, it, expect } from "vitest";
import type { AIMessage, ProjectFile, RunResult } from "./provider.js";
import {
  studentSeemsStuck,
  buildSystemPrompt,
  buildUserTurn,
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
  it("uses FIRST-QUESTION guidance when history is empty and student is not stuck", () => {
    const prompt = buildSystemPrompt(noHistory, "what does this function do");
    expect(prompt).toMatch(/FIRST QUESTION/);
    expect(prompt).toMatch(/Leave "hint", "nextStep", and "strongerHint" as null/);
  });

  it("uses FOLLOW-UP guidance when there is a prior tutor turn and student is not stuck", () => {
    const prompt = buildSystemPrompt(oneTutorTurn, "why doesn't this work");
    expect(prompt).toMatch(/FOLLOW-UP/);
    expect(prompt).toMatch(/small nudge/);
    expect(prompt).toMatch(/strongerHint" null unless the student explicitly said they are stuck/);
  });

  it("uses STUCK guidance on the first turn when the student signals being stuck", () => {
    const prompt = buildSystemPrompt(noHistory, "i'm stuck");
    expect(prompt).toMatch(/STUDENT STUCK/);
    expect(prompt).toMatch(/strongerHint/);
  });

  it("uses STUCK guidance on a follow-up turn when the student signals being stuck", () => {
    const prompt = buildSystemPrompt(oneTutorTurn, "just tell me the fix");
    expect(prompt).toMatch(/STUDENT STUCK/);
  });

  it("always includes the base tutor rules", () => {
    const prompt = buildSystemPrompt(noHistory, "anything");
    expect(prompt).toMatch(/coding TUTOR/);
    expect(prompt).toMatch(/Never invent library APIs/);
  });

  it("ignores user-role messages when counting tutor turns", () => {
    // Three user messages but zero assistant messages — still "first question".
    const history: AIMessage[] = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(buildSystemPrompt(history, "another question")).toMatch(/FIRST QUESTION/);
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
    expect(body).toMatch(/LAST RUN:/);
    expect(body).toMatch(/RECENT CONVERSATION:/);
    expect(body).toMatch(/STUDENT QUESTION:\nwhy is this broken/);
  });

  it("falls back to 'unspecified' when no language is given", () => {
    const body = buildUserTurn({ question: "?", files: [], history: [] });
    expect(body).toMatch(/LANGUAGE: unspecified/);
  });
});
