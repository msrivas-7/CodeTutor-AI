import { describe, expect, it } from "vitest";
import { resolveEditorReadinessKey } from "./workspaceReadiness";

const ready = {
  chatContextKey: "lesson:python-fundamentals/variables",
  courseId: "python-fundamentals",
  lessonId: "variables",
  loading: false,
  loadedLessonId: "variables",
  initializedFor: "python-fundamentals/variables",
  projectContext: "lesson:python-fundamentals/variables",
};

describe("resolveEditorReadinessKey", () => {
  it("refuses to acknowledge a new lesson while the project still owns the previous one", () => {
    expect(resolveEditorReadinessKey({
      ...ready,
      projectContext: "lesson:python-fundamentals/hello-world",
    })).toBeNull();
  });

  it("requires loader initialization and project ownership before acknowledging", () => {
    expect(resolveEditorReadinessKey({ ...ready, loading: true })).toBeNull();
    expect(resolveEditorReadinessKey({
      ...ready,
      initializedFor: "python-fundamentals/hello-world",
    })).toBeNull();
    expect(resolveEditorReadinessKey(ready)).toBe(ready.chatContextKey);
  });
});
