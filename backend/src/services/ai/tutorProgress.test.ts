import { describe, expect, it } from "vitest";
import {
  mintTutorProgressToken,
  resolveTutorStage,
  tutorTaskScope,
  type TutorProgressKeyring,
} from "./tutorProgress.js";

const KEY_1 = Buffer.alloc(32, 1).toString("base64");
const KEY_2 = Buffer.alloc(32, 2).toString("base64");
const keyring: TutorProgressKeyring = {
  currentVersion: 2,
  keys: new Map([[1, KEY_1], [2, KEY_2]]),
};
const identity = { actorId: "user:u-1", taskScope: "guided:python/variables/lesson" };
const nowMs = Date.UTC(2026, 6, 31, 12);

describe("tutor progression proof", () => {
  it("defaults missing or malformed proof to the clarifying stage", () => {
    expect(resolveTutorStage(undefined, identity, { keyring, nowMs })).toBe("clarify");
    expect(resolveTutorStage("not-a-token", identity, { keyring, nowMs })).toBe("clarify");
    for (const hostilePayload of [null, [], "approach", 1, { v: 1 }]) {
      const encoded = Buffer.from(JSON.stringify(hostilePayload), "utf8").toString("base64url");
      expect(resolveTutorStage(`${encoded}.unsigned`, identity, { keyring, nowMs })).toBe("clarify");
    }
  });

  it("unlocks the approach stage for the same actor and task", () => {
    const token = mintTutorProgressToken(identity, { keyring, nowMs });
    expect(resolveTutorStage(token, identity, { keyring, nowMs: nowMs + 1 })).toBe("approach");
  });

  it("fails closed for tampering, another actor, another task, or expiry", () => {
    const token = mintTutorProgressToken(identity, { keyring, nowMs });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(resolveTutorStage(tampered, identity, { keyring, nowMs })).toBe("clarify");
    expect(resolveTutorStage(token, { ...identity, actorId: "user:u-2" }, { keyring, nowMs })).toBe("clarify");
    expect(resolveTutorStage(token, { ...identity, taskScope: "guided:python/loops/lesson" }, { keyring, nowMs })).toBe("clarify");
    expect(resolveTutorStage(token, identity, { keyring, nowMs: nowMs + 24 * 60 * 60 * 1_000 })).toBe("clarify");
  });

  it("accepts a still-present rotated key and rejects a retired key", () => {
    const oldKeyring: TutorProgressKeyring = { currentVersion: 1, keys: keyring.keys };
    const token = mintTutorProgressToken(identity, { keyring: oldKeyring, nowMs });
    expect(resolveTutorStage(token, identity, { keyring, nowMs })).toBe("approach");
    expect(resolveTutorStage(token, identity, {
      keyring: { currentVersion: 2, keys: new Map([[2, KEY_2]]) },
      nowMs,
    })).toBe("clarify");
  });
});

describe("tutorTaskScope", () => {
  it("separates lesson and practice tasks using canonical identity", () => {
    const base = {
      activeFile: "main.py",
      files: [{ path: "main.py", content: "print('hi')" }],
      language: "python" as const,
    };
    const lessonContext = {
      courseId: "python",
      lessonId: "variables",
      exerciseId: null,
      lessonTitle: "Variables",
      language: "python" as const,
      lessonObjectives: [],
      teachesConceptTags: [],
      usesConceptTags: [],
      priorConcepts: [],
      completionCriteria: [],
      studentProgressSummary: "none",
    };
    expect(tutorTaskScope({ ...base, lessonContext })).toBe("guided:python/variables/lesson");
    expect(tutorTaskScope({
      ...base,
      lessonContext: { ...lessonContext, exerciseId: "practice-1" },
    })).toBe("guided:python/variables/practice-1");
  });

  it("keeps editor scope stable across code edits and path-order changes", () => {
    const first = tutorTaskScope({
      lessonContext: null,
      language: "javascript",
      activeFile: "index.js",
      files: [{ path: "z.js", content: "old" }, { path: "index.js", content: "old" }],
    });
    const second = tutorTaskScope({
      lessonContext: null,
      language: "javascript",
      activeFile: "index.js",
      files: [{ path: "index.js", content: "new" }, { path: "z.js", content: "new" }],
    });
    expect(second).toBe(first);
  });
});
