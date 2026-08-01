import { beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  _resetLessonCatalogCache,
  getCourseConceptTags,
  getCourseStructure,
  getLessonAccessRequirements,
  getLessonMemorySnapshot,
  getPracticeEvidenceSnapshot,
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

describe("Phase B1 memory catalog authority", () => {
  beforeEach(() => _resetLessonCatalogCache());

  it("keeps answer banks out of the browser-served public course tree", () => {
    expect(
      existsSync(
        path.resolve(
          process.cwd(),
          "../frontend/public/courses/python-fundamentals/memory-warmups.json",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        path.resolve(
          process.cwd(),
          "../content/memory-warmups/python-fundamentals.json",
        ),
      ),
    ).toBe(true);
  });

  it("loads a canonical warm-up only from a lesson's declared prior concepts", async () => {
    const snapshot = await getLessonMemorySnapshot(
      "python-fundamentals",
      "input-output",
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.priorConcepts).toContain("string-concat");
    expect(snapshot?.warmups).toHaveLength(1);
    expect(snapshot?.warmups[0]).toMatchObject({
      id: "join-text-and-a-number",
      correctIndex: 1,
      conceptTags: ["int", "str", "string-concat"],
    });
    expect(
      snapshot?.warmups[0]?.choices[snapshot.warmups[0].correctIndex],
    ).toBe('"Age: " + str(age)');
    for (const concept of snapshot?.warmups[0]?.conceptTags ?? []) {
      expect(snapshot?.priorConcepts).toContain(concept);
    }
  });

  it("returns the sorted server-owned concept universe for public courses", async () => {
    const concepts = await getCourseConceptTags("python-fundamentals");

    expect(concepts).not.toBeNull();
    expect(concepts).toContain("variables");
    expect(concepts).toContain("return");
    expect(concepts).toEqual([...(concepts ?? [])].sort());
    expect(await getCourseConceptTags("internal-python-smoke")).toBeNull();
  });

  it("derives practice evidence from canonical exercise identity, never client tags", async () => {
    await expect(
      getPracticeEvidenceSnapshot(
        "python-fundamentals",
        "functions",
        "square-function",
      ),
    ).resolves.toEqual({
      courseId: "python-fundamentals",
      lessonId: "functions",
      exerciseId: "square-function",
      conceptTags: ["def", "parameters", "return", "scope", "default-arguments"],
    });
    await expect(
      getPracticeEvidenceSnapshot(
        "python-fundamentals",
        "functions",
        "made-up-exercise",
      ),
    ).resolves.toBeNull();
  });

  it("rejects unknown and traversal identities at the catalog boundary", async () => {
    await expect(
      getLessonMemorySnapshot("../python-fundamentals", "input-output"),
    ).resolves.toBeNull();
    await expect(
      getLessonMemorySnapshot("python-fundamentals", "not-a-lesson"),
    ).resolves.toBeNull();
    await expect(getCourseConceptTags("../python-fundamentals")).resolves.toBeNull();
  });
});

describe("progress catalog authority", () => {
  beforeEach(() => _resetLessonCatalogCache());

  it("keeps a hidden internal smoke course writable without exposing it to memory", async () => {
    await expect(getCourseStructure("internal-python-smoke")).resolves.toEqual({
      lessonOrder: ["multi-file-test"],
      prerequisiteCourseIds: [],
    });
    await expect(
      getLessonAccessRequirements("internal-python-smoke", "multi-file-test"),
    ).resolves.toEqual({
      prerequisiteLessonIds: [],
      prerequisiteCourseIds: [],
    });
    await expect(getCourseConceptTags("internal-python-smoke")).resolves.toBeNull();
  });
});
