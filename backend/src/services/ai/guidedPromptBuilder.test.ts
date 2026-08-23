import { describe, it, expect } from "vitest";
import type { AIMessage } from "./provider.js";
import {
  buildGuidedSystemPrompt,
  buildGuidedUserTurn,
} from "./guidedPromptBuilder.js";
import type { LessonContext } from "./prompts/lessonContext.js";

const lessonCtx: LessonContext = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  exerciseId: null,
  lessonTitle: "Hello, World!",
  language: "python",
  lessonObjectives: ["Write and run a Python program", "Use print()"],
  teachesConceptTags: ["print", "strings"],
  usesConceptTags: ["syntax"],
  priorConcepts: [],
  completionCriteria: ["produce the lesson's required output"],
  studentProgressSummary: "attempt 2, 1 run, 0 hints",
  lessonOrder: 1,
  totalLessons: 10,
};

const noHistory: AIMessage[] = [];
const oneTurn: AIMessage[] = [
  { role: "user", content: "help" },
  { role: "assistant", content: "sure" },
];

describe("buildGuidedSystemPrompt", () => {
  it("includes the core tutor rules", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/coding TUTOR/);
  });

  it("includes the GUIDED_ADDENDUM rules", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/GUIDED LESSON mode/);
    expect(prompt).toMatch(/Never solve the lesson task outright/);
  });

  it("includes the lesson context block with title and objectives", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/GUIDED LESSON/);
    expect(prompt).toMatch(/"Hello, World!"/);
    expect(prompt).toMatch(/Write and run a Python program/);
    expect(prompt).toMatch(/Use print\(\)/);
  });

  it("includes concept tags split into teaches and uses", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/TEACHES.*print, strings/);
    expect(prompt).toMatch(/USES.*syntax/);
  });

  it("includes lesson order info", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/lesson 1 of 10/);
  });

  it("includes SITUATION block", () => {
    const prompt = buildGuidedSystemPrompt(oneTurn, "stuck", lessonCtx, { tutorStage: "approach" });
    expect(prompt).toMatch(/SITUATION:/);
    expect(prompt).toMatch(/Server-verified prior tutor turn for this task: true/);
  });

  it("includes persona block when specified", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx, {
      persona: "beginner",
    });
    expect(prompt).toMatch(/beginner/i);
  });

  it("provides a sanitized preferred first name for natural greetings", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx, {
      learnerName: "Maya",
    });
    expect(prompt).toMatch(/Preferred first name: Maya/);
    expect(prompt).toMatch(/MUST contain the exact preferred first name\s+Maya once/);
  });

  it("explicitly tells the tutor not to invent a missing learner name", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/No safe preferred first name is available/);
    expect(prompt).toMatch(/without inventing a name/);
  });

  it("requires mixed unsafe requests to receive one complete conversational boundary", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/cover every distinct boundary in one concise conversationReply/);
    expect(prompt).toMatch(/Refusing only one clause and silently dropping the other is not enough/);
  });

  it("forbids internal authoring labels in learner-facing copy", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/Write only learner-facing copy/);
    expect(prompt).toMatch(/Never expose authoring or evaluation labels/);
    expect(prompt).toContain('"placeholder greeting"');
  });

  it("classifies harmless unrelated requests before the teaching intent", () => {
    const prompt = buildGuidedSystemPrompt(
      noHistory,
      "Can you write a short poem about pizza?",
      lessonCtx,
    );

    expect(prompt).toMatch(/classify these before applying the server-selected teaching intent/i);
    expect(prompt).toMatch(/conversationMove="redirect"/);
    expect(prompt).toMatch(/Never jump to an arbitrary identifier, code line, error, or run result/i);
  });

  it("keeps learner guesses and answer checks inside the teaching intent", () => {
    const prompt = buildGuidedSystemPrompt(
      noHistory,
      "The correct quiz choice is B, right?",
      lessonCtx,
    );

    expect(prompt).toMatch(/guess, proposed answer, quiz choice, prediction/i);
    expect(prompt).toMatch(/request for confirmation is not hostility, small talk, or a boundary violation/i);
    expect(prompt).toMatch(/without confirming or revealing the protected answer/i);
  });

  it("requires check-ins about a better approach to discuss the actual tradeoff", () => {
    const prompt = buildGuidedSystemPrompt(
      noHistory,
      "Is there a better way to do this?",
      lessonCtx,
    );

    expect(prompt).toMatch(/better, clearer, safer, or more idiomatic approach/i);
    expect(prompt).toMatch(/saying only that the current code works and should be run is not a useful answer/i);
  });

  it("omits persona block when not specified", () => {
    const withPersona = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx, {
      persona: "advanced",
    });
    const without = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(withPersona.length).toBeGreaterThan(without.length);
  });

  it("passes run/edit counts to the situation block", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx, {
      runsSinceLastTurn: 5,
      editsSinceLastTurn: 3,
    });
    expect(prompt).toMatch(/Runs since last tutor turn: 5/);
    expect(prompt).toMatch(/Edits since last tutor turn: 3/);
  });

  it("includes completion criteria description", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/produce the lesson's required output/);
  });

  it("includes student progress summary", () => {
    const prompt = buildGuidedSystemPrompt(noHistory, "hi", lessonCtx);
    expect(prompt).toMatch(/attempt 2, 1 run, 0 hints/);
  });
});

describe("buildGuidedUserTurn", () => {
  it("renders the lesson's language in the LANGUAGE header", () => {
    const body = buildGuidedUserTurn({ question: "?", files: [], history: [], language: "python" });
    expect(body).toMatch(/LANGUAGE: python/);
  });

  it("renders non-Python languages", () => {
    const body = buildGuidedUserTurn({ question: "?", files: [], history: [], language: "javascript" });
    expect(body).toMatch(/LANGUAGE: javascript/);
  });

  it("includes all standard sections", () => {
    const body = buildGuidedUserTurn({ question: "help me", files: [], history: [], language: "python" });
    expect(body).toMatch(/PROJECT FILES:/);
    expect(body).toMatch(/STDIN:/);
    expect(body).toMatch(/LAST RUN:/);
    expect(body).toMatch(/CHANGES SINCE LAST TUTOR TURN:/);
    expect(body).toMatch(/RECENT CONVERSATION:/);
    expect(body).toMatch(/STUDENT QUESTION:\nhelp me/);
  });

  it("renders files", () => {
    const body = buildGuidedUserTurn({
      question: "?",
      files: [{ path: "main.py", content: "print('hi')" }],
      activeFile: "main.py",
      history: [],
      language: "python",
    });
    expect(body).toContain('<user_file path="main.py" active="true">');
    expect(body).toContain("1 | print('hi')");
  });

  it("includes selection block when provided", () => {
    const body = buildGuidedUserTurn({
      question: "what does this do",
      files: [],
      history: [],
      language: "python",
      selection: { path: "main.py", startLine: 3, endLine: 5, text: "for i in range(10):" },
    });
    expect(body).toMatch(/STUDENT SELECTION/);
    expect(body).toContain('<user_selection path="main.py" span="lines 3-5">');
    expect(body).toMatch(/for i in range\(10\):/);
  });

  it("omits selection block when not provided", () => {
    const body = buildGuidedUserTurn({ question: "?", files: [], history: [], language: "python" });
    expect(body).not.toMatch(/STUDENT SELECTION/);
  });

  it("renders run result when provided", () => {
    const body = buildGuidedUserTurn({
      question: "?",
      files: [],
      history: [],
      language: "python",
      lastRun: {
        stdout: "Hello!",
        stderr: "",
        exitCode: 0,
        errorType: "none",
        durationMs: 50,
        stage: "run",
      },
    });
    expect(body).toMatch(/stdout:\nHello!/);
    expect(body).toMatch(/exitCode: 0/);
  });
});
