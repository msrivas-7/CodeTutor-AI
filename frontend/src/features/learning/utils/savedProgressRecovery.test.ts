import { describe, expect, it } from "vitest";
import type { LessonMeta } from "../types";
import { savedProgressRecoveryMessage } from "./savedProgressRecovery";

function lesson(
  id: string,
  title: string,
  order: number,
  prerequisiteLessonIds: string[],
): LessonMeta {
  return {
    id,
    courseId: "javascript-fundamentals",
    title,
    description: title,
    order,
    language: "javascript",
    estimatedMinutes: 10,
    objectives: [],
    teachesConceptTags: [],
    usesConceptTags: [],
    completionRules: [],
    prerequisiteLessonIds,
  };
}

describe("savedProgressRecoveryMessage", () => {
  it("names the actual unmet prerequisite instead of an unrelated earlier sibling", () => {
    const functions = lesson("functions-basics", "Functions Basics", 1, []);
    const deepDive = lesson(
      "js-functions-deep-dive",
      "Functions Deep Dive",
      2,
      ["functions-basics"],
    );
    const arrays = lesson("arrays-basics", "Arrays Basics", 3, ["functions-basics"]);
    const objects = lesson("objects-basics", "Objects Basics", 4, ["arrays-basics"]);

    expect(
      savedProgressRecoveryMessage({
        lessons: [functions, deepDive, arrays, objects],
        savedButLockedLessons: [objects],
        completedIds: ["functions-basics", "objects-basics"],
      }),
    ).toBe(
      "Recomplete Arrays Basics to reopen the saved lesson and its practice.",
    );
  });

  it("names every distinct unmet prerequisite when multiple saved lessons are locked", () => {
    const basics = lesson("basics", "Basics", 1, []);
    const arrays = lesson("arrays", "Arrays", 2, ["basics"]);
    const objects = lesson("objects", "Objects", 3, ["arrays"]);
    const classes = lesson("classes", "Classes", 4, ["basics"]);
    const capstone = lesson("capstone", "Capstone", 5, ["classes"]);

    expect(
      savedProgressRecoveryMessage({
        lessons: [basics, arrays, objects, classes, capstone],
        savedButLockedLessons: [objects, capstone],
        completedIds: ["basics", "objects", "capstone"],
      }),
    ).toBe(
      "Recomplete Arrays and Classes to reopen 2 saved lessons and their practice.",
    );
  });
});
