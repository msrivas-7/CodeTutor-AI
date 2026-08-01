import { describe, expect, it } from "vitest";
import {
  AI_EVAL_CONSENT_VERSION,
  hashEvalSubjectToken,
  isValidEvalSubjectToken,
  projectEvalSample,
  redactEvalText,
  shouldSampleEvalRequest,
} from "./evalSampling.js";

const token = "a".repeat(43);

describe("B8 eval sampling privacy boundary", () => {
  it("accepts only 256-bit base64url subject tokens and hashes by domain", () => {
    expect(isValidEvalSubjectToken(token)).toBe(true);
    expect(isValidEvalSubjectToken("short")).toBe(false);
    expect(hashEvalSubjectToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEvalSubjectToken(token)).not.toContain(token);
  });

  it("uses a stable five-percent request bucket", () => {
    const decisions = Array.from({ length: 10_000 }, (_, index) =>
      shouldSampleEvalRequest(`00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`),
    );
    const sampled = decisions.filter(Boolean).length;
    expect(sampled).toBeGreaterThanOrEqual(450);
    expect(sampled).toBeLessThanOrEqual(550);
    expect(shouldSampleEvalRequest("00000000-0000-4000-8000-000000000123")).toBe(
      shouldSampleEvalRequest("00000000-0000-4000-8000-000000000123"),
    );
  });

  it("redacts the hostile privacy fixture before projection", () => {
    const projected = projectEvalSample({
      requestId: "00000000-0000-4000-8000-000000000123",
      consent: { version: AI_EVAL_CONSENT_VERSION, subjectToken: token },
      model: "gpt-4.1-nano",
      language: "python",
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      intent: "debug",
      tutorStage: "approach",
      question:
        'I am Maya. Email maya@example.com. api_key=fixture-secret-value-123456789. Why does `/Users/maya/private/main.py` fail?\n```python\nprint("Maya")\n```',
      files: [{ path: "/Users/maya/private/main.py", content: 'print("Maya")\n' }],
      history: [{ role: "assistant", content: "Call Maya at +1 (415) 555-1212" }],
      lastRun: { errorType: "runtime" },
      sections: {
        intent: "debug",
        diagnose: "Maya, the value in `secret_name` is wrong.",
        nextStep: "Open /Users/maya/private/main.py and email maya@example.com.",
        citations: [{ path: "/Users/maya/private/main.py", line: 1, reason: "Maya's line" }],
      },
    });

    const serialized = JSON.stringify(projected);
    for (const forbidden of [
      "Maya",
      "maya@example.com",
      "fixture-secret-value-123456789",
      "/Users/maya/private/main.py",
      "secret_name",
      'print(\\"Maya\\")',
      "+1 (415) 555-1212",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(projected.questionRedacted).toContain("[email]");
    expect(projected.questionRedacted).toContain("[secret]");
    expect(projected.responseRedacted).toContain("[path]");
    expect(projected.questionRedacted).toContain("[code]");
    expect(projected.responseRedacted).toContain("[identifier]");
    expect(projected.sectionKeys).toEqual(["diagnose", "nextStep"]);
    expect(projected.fileCount).toBe(1);
    expect(projected.sourceBytesBucket).toBe("1-1024");
    expect(projected.historyTurnCount).toBe(1);
    expect(projected.hadRunResult).toBe(true);
    expect(projected.runErrorType).toBe("runtime");
  });

  it("never includes source, output, history text, paths, or citations", () => {
    const projected = projectEvalSample({
      requestId: "00000000-0000-4000-8000-000000000456",
      consent: { version: AI_EVAL_CONSENT_VERSION, subjectToken: token },
      model: "gpt-4.1-nano",
      language: "python",
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      intent: "socratic",
      tutorStage: "clarify",
      question: "Why does this not work?",
      files: [{ path: "super-secret.py", content: "PRIVATE_SOURCE_SENTINEL" }],
      history: [{ role: "user", content: "PRIVATE_HISTORY_SENTINEL" }],
      lastRun: { errorType: "compile" },
      sections: {
        summary: "What result did you expect?",
        citations: [{ path: "super-secret.py", line: 1, reason: "PRIVATE_CITATION_SENTINEL" }],
      },
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_HISTORY_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_CITATION_SENTINEL");
    expect(serialized).not.toContain("super-secret.py");
  });

  it("bounds redacted output", () => {
    const redacted = redactEvalText("unknownIdentifier ".repeat(10_000), 2000);
    expect(redacted.text.length).toBeLessThanOrEqual(2000);
    expect(redacted.stats.identifiers).toBe(10_000);
  });
});
