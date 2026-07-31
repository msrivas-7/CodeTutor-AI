import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetLessonCatalogCache,
  getTutorLessonSnapshot,
} from "./lessonCatalog.js";

describe("getTutorLessonSnapshot", () => {
  beforeEach(() => _resetLessonCatalogCache());

  it("loads canonical lesson context from the authored catalog", async () => {
    const lesson = await getTutorLessonSnapshot(
      "python-fundamentals",
      "hello-world",
    );
    expect(lesson).not.toBeNull();
    expect(lesson?.lessonTitle).toBe("Hello, World!");
    expect(lesson?.language).toBe("python");
    expect(lesson?.totalLessons).toBeGreaterThan(1);
  });

  it("projects validator rules without exposing expected values or answers", async () => {
    const lesson = await getTutorLessonSnapshot(
      "python-fundamentals",
      "hello-world",
    );
    const projection = lesson?.completionCriteria.join(" ") ?? "";
    expect(projection).toContain("required output");
    expect(projection).not.toContain("Hello, World!");
    expect(projection).not.toContain("correctIndex");
    expect(projection).not.toContain("Shows text");
  });

  it("fails closed for an unknown practice identity", async () => {
    expect(
      await getTutorLessonSnapshot(
        "python-fundamentals",
        "hello-world",
        "does-not-exist",
      ),
    ).toBeNull();
  });

  it("rejects traversal and unknown lesson identities", async () => {
    expect(await getTutorLessonSnapshot("../python", "hello-world")).toBeNull();
    expect(
      await getTutorLessonSnapshot("python-fundamentals", "not-a-lesson"),
    ).toBeNull();
  });
});
