import { describe, expect, it } from "vitest";
import {
  mintContextualEvidenceToken,
  verifyContextualEvidenceToken,
} from "./contextualEvidence.js";

const keyring = {
  currentVersion: 1,
  keys: new Map([[1, Buffer.alloc(32, 9).toString("base64")]]),
};
const actor = "user:learner-1";
const identity = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  contextEpoch: "lesson:python-fundamentals/hello-world",
  projectRevision: 7,
};
const files = [{ path: "main.py", content: 'print("Hello"\n' }];
const result = {
  stdout: "",
  stderr: 'File "/workspace/main.py", line 1\nSyntaxError: \'(\' was never closed',
  exitCode: 1,
  errorType: "runtime" as const,
  durationMs: 10,
  stage: "run" as const,
};

describe("contextual evidence tokens", () => {
  it("binds the actor, lesson epoch, revision, exact files, and exact run", () => {
    const token = mintContextualEvidenceToken(actor, identity, files, result, {
      keyring,
      nowMs: 1_000,
    });
    expect(verifyContextualEvidenceToken(token, actor, identity, files, result, {
      keyring,
      nowMs: 2_000,
    })).toBe(true);
    expect(verifyContextualEvidenceToken(token, "user:other", identity, files, result, {
      keyring,
      nowMs: 2_000,
    })).toBe(false);
    expect(verifyContextualEvidenceToken(token, actor, { ...identity, projectRevision: 8 }, files, result, {
      keyring,
      nowMs: 2_000,
    })).toBe(false);
    expect(verifyContextualEvidenceToken(token, actor, identity, [{ ...files[0], content: "print(1)" }], result, {
      keyring,
      nowMs: 2_000,
    })).toBe(false);
    expect(verifyContextualEvidenceToken(token, actor, identity, files, { ...result, stderr: "different" }, {
      keyring,
      nowMs: 2_000,
    })).toBe(false);
  });

  it("rejects expired and tampered tokens", () => {
    const token = mintContextualEvidenceToken(actor, identity, files, result, {
      keyring,
      nowMs: 1_000,
    });
    expect(verifyContextualEvidenceToken(token, actor, identity, files, result, {
      keyring,
      nowMs: 1_000 + 15 * 60 * 1_000,
    })).toBe(false);
    expect(verifyContextualEvidenceToken(`${token}x`, actor, identity, files, result, {
      keyring,
      nowMs: 2_000,
    })).toBe(false);
  });
});
