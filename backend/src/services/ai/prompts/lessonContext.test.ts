import { describe, it, expect } from "vitest";
import {
  buildContextualOfferBlock,
  buildLessonContextBlock,
} from "./lessonContext.js";
import type { LessonContext } from "./lessonContext.js";

const full: LessonContext = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  exerciseId: null,
  lessonTitle: "Hello, World!",
  language: "python",
  lessonObjectives: ["Write and run a Python program", "Use print()"],
  teachesConceptTags: ["print", "strings"],
  usesConceptTags: ["syntax"],
  priorConcepts: ["identifiers", "whitespace"],
  completionCriteria: ["produce the lesson's required output"],
  studentProgressSummary: "attempt 1, 0 runs",
  lessonOrder: 1,
  totalLessons: 10,
};

describe("buildLessonContextBlock", () => {
  it("includes the lesson title in quotes", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/"Hello, World!"/);
  });

  it("renders each objective as a bullet", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/- Write and run a Python program/);
    expect(block).toMatch(/- Use print\(\)/);
  });

  it("renders teaches, uses, and prior concepts on separate labeled lines", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/TEACHES.*print, strings/);
    expect(block).toMatch(/USES.*syntax/);
    expect(block).toMatch(/EARLIER lessons.*identifiers, whitespace/);
  });

  it("labels empty concept lists as (none declared) instead of dropping the line", () => {
    const ctx: LessonContext = { ...full, usesConceptTags: [], priorConcepts: [] };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/USES.*\(none declared\)/);
    expect(block).toMatch(/EARLIER lessons.*\(none declared\)/);
  });

  it("renders the server-projected completion criteria", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/produce the lesson's required output/);
  });

  it("joins multiple safe criteria without needing raw validator rules", () => {
    const ctx: LessonContext = {
      ...full,
      completionCriteria: [
        "produce the lesson's required output",
        "use the required lesson construct in main.py",
      ],
    };
    const block = buildLessonContextBlock(ctx);
    expect(block).toMatch(/; and /);
  });

  it("includes lesson order when provided", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/GUIDED LESSON \(lesson 1 of 10\)/);
  });

  it("omits lesson order when not provided", () => {
    const { lessonOrder, totalLessons, ...noOrder } = full;
    const block = buildLessonContextBlock(noOrder as LessonContext);
    expect(block).toMatch(/^GUIDED LESSON\n/);
    expect(block).not.toMatch(/lesson \d+ of/);
  });

  it("includes student progress summary", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/Progress: attempt 1, 0 runs/);
  });

  it("includes lesson rules warning about future material", () => {
    const block = buildLessonContextBlock(full);
    expect(block).toMatch(/IMPORTANT LESSON RULES:/);
    expect(block).toMatch(/Stay within the scope/);
    expect(block).toMatch(/future material/);
    expect(block).toMatch(/Guide toward the solution without giving it away/);
  });
});

describe("buildContextualOfferBlock", () => {
  it("carries the current receipt and one bounded no-answer scaffold", () => {
    const block = buildContextualOfferBlock({
      contextVersion: 0,
      contextEpoch: "lesson:python-fundamentals/hello-world",
      projectRevision: 4,
      moveId: "notice-unclosed-parenthesis",
      evidence: {
        code: "python-unclosed-parenthesis",
        path: "main.py",
        line: 3,
        label: "Syntax error",
      },
      scaffoldLevel: 1,
      authoredQuestion: "Which opening parenthesis still needs a closing partner?",
    });
    expect(block).toContain("explicitly clicked");
    expect(block).toContain("main.py on line 3");
    expect(block).toContain("Which opening parenthesis");
    expect(block).toContain("Do not provide a corrected line, complete solution, or full answer");
    expect(block).toContain("untrusted learner-observed evidence");
  });
});
