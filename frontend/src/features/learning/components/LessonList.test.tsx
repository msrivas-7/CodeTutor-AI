import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LessonMeta } from "../types";
import { LessonList, resolveLessonAccessState } from "./LessonList";

const variables = {
  id: "variables",
  courseId: "python-fundamentals",
  title: "Variables and Strings",
  description: "Store values in variables and combine them with text.",
  order: 2,
  language: "python",
  estimatedMinutes: 12,
  objectives: [],
  teachesConceptTags: [],
  usesConceptTags: [],
  completionRules: [],
  prerequisiteLessonIds: ["hello-world"],
  practiceExercises: [
    {
      id: "practice-1",
      title: "Practice variables",
      goal: "Use a variable.",
      prompt: "Store and print a value.",
      completionRules: [],
    },
  ],
} satisfies LessonMeta;

describe("LessonList prerequisite reset state", () => {
  it("keeps saved downstream progress visible but non-actionable until prerequisites return", () => {
    const access = resolveLessonAccessState({
      lesson: variables,
      status: "completed",
      completedIds: ["variables"],
      practice: { done: 1, total: 1 },
    });

    expect(access).toMatchObject({
      locked: true,
      savedProgressLocked: true,
      practiceUnlocked: false,
      description: "Recomplete prerequisites to reopen — your progress is saved",
      practiceTooltip: "Recomplete prerequisites to reopen practice",
    });

    const html = renderToStaticMarkup(
      <LessonList
        lessons={[variables]}
        progressMap={{ variables: "completed" }}
        completedIds={["variables"]}
        practiceProgressMap={{ variables: { done: 1, total: 1 } }}
        onSelect={vi.fn()}
        onSelectPractice={vi.fn()}
      />,
    );

    expect(html).toContain("Variables and Strings (locked — recomplete prerequisites to reopen; progress saved)");
    expect(html).toContain("Recomplete prerequisites to reopen — your progress is saved");
    expect(html).toContain("Recomplete prerequisites to reopen practice");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("restores both lesson and practice access when the prerequisite is completed", () => {
    const access = resolveLessonAccessState({
      lesson: variables,
      status: "completed",
      completedIds: ["hello-world", "variables"],
      practice: { done: 1, total: 1 },
    });

    expect(access).toMatchObject({
      locked: false,
      savedProgressLocked: false,
      practiceUnlocked: true,
      practiceTooltip: "Replay practice",
    });
  });
});
