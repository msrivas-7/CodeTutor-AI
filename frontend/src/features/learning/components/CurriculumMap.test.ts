import { describe, expect, it } from "vitest";
import { buildCourseNodes } from "./CurriculumMap";
import type { Course, LessonMeta } from "../types";

// Phase A — A7: the curriculum map's node labelling. The map is the
// learner's picture of the WHOLE road, so a mislabelled "next" node
// points them at the wrong lesson from the dashboard's most glanceable
// surface. These pin the labelling rules without needing a DOM.

function lesson(id: string, order: number): LessonMeta {
  return {
    id,
    title: `Lesson ${order}`,
    order,
    objectives: [],
    estimatedMinutes: 10,
    language: "python",
    teachesConceptTags: [],
    usesConceptTags: [],
    completionRules: [],
    prerequisiteLessonIds: [],
  } as unknown as LessonMeta;
}

const COURSE: Course = {
  id: "c1",
  title: "Course One",
  description: "",
  language: "python",
  lessonOrder: ["a", "b", "c"],
} as unknown as Course;

const LESSONS = [lesson("a", 1), lesson("b", 2), lesson("c", 3)];

describe("buildCourseNodes", () => {
  it("marks the first lesson as 'next' when nothing is completed", () => {
    const { nodes, doneCount } = buildCourseNodes(COURSE, LESSONS, []);
    expect(nodes.map((n) => n.state)).toEqual(["next", "untouched", "untouched"]);
    expect(doneCount).toBe(0);
  });

  it("advances 'next' to the first UNCOMPLETED lesson", () => {
    const { nodes, doneCount } = buildCourseNodes(COURSE, LESSONS, ["a"]);
    expect(nodes.map((n) => n.state)).toEqual(["completed", "next", "untouched"]);
    expect(doneCount).toBe(1);
  });

  it("handles out-of-order completion — 'next' is the first gap, not the last done", () => {
    // Learner completed a and c (e.g. via a direct link). The gap at b
    // is what they should do next; a naive "index after last completed"
    // would wrongly point past the end.
    const { nodes } = buildCourseNodes(COURSE, LESSONS, ["a", "c"]);
    expect(nodes.map((n) => n.state)).toEqual(["completed", "next", "completed"]);
  });

  it("leaves no 'next' node once the course is fully completed", () => {
    const { nodes, doneCount } = buildCourseNodes(COURSE, LESSONS, ["a", "b", "c"]);
    expect(nodes.every((n) => n.state === "completed")).toBe(true);
    expect(nodes.some((n) => n.state === "next")).toBe(false);
    expect(doneCount).toBe(3);
  });

  it("follows lessonOrder, not the order lessons were passed in", () => {
    const shuffled = [lesson("c", 3), lesson("a", 1), lesson("b", 2)];
    const { nodes } = buildCourseNodes(COURSE, shuffled, []);
    expect(nodes.map((n) => n.lesson.id)).toEqual(["a", "b", "c"]);
  });

  it("drops ids with no matching meta instead of rendering a hole", () => {
    // content-lint catches dangling ids; the UI must not crash on one.
    const course = { ...COURSE, lessonOrder: ["a", "ghost", "b"] } as Course;
    const { nodes } = buildCourseNodes(course, LESSONS, []);
    expect(nodes.map((n) => n.lesson.id)).toEqual(["a", "b"]);
  });

  it("sets prevCompleted so the connector only greens after a done lesson", () => {
    const { nodes } = buildCourseNodes(COURSE, LESSONS, ["a"]);
    expect(nodes[0].prevCompleted).toBe(false); // no connector before the first
    expect(nodes[1].prevCompleted).toBe(true); // a is done → green into b
    expect(nodes[2].prevCompleted).toBe(false); // b not done → grey into c
  });

  it("returns an empty row for a course with no lessons", () => {
    const empty = { ...COURSE, lessonOrder: [] } as Course;
    const { nodes, doneCount } = buildCourseNodes(empty, [], []);
    expect(nodes).toEqual([]);
    expect(doneCount).toBe(0);
  });
});
