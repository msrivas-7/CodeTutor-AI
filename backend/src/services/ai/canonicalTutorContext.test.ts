import { describe, expect, it } from "vitest";
import { resolveCanonicalContextualTutorOffer } from "./canonicalTutorContext.js";

const lastRun = {
  stdout: "",
  stderr: '  File "/workspace/main.py", line 1\n    print("Hello"\n         ^\nSyntaxError: \'(\' was never closed\n',
  exitCode: 1,
  errorType: "runtime" as const,
  durationMs: 10,
  stage: "run" as const,
};

const offer = {
  contextVersion: 0 as const,
  contextEpoch: "lesson:python-fundamentals/hello-world",
  projectRevision: 2,
  moveId: "notice-unclosed-parenthesis",
  evidence: {
    code: "python-unclosed-parenthesis" as const,
    path: "main.py",
    line: 1,
  },
  scaffoldLevel: 1 as const,
};

describe("resolveCanonicalContextualTutorOffer", () => {
  it("resolves the authored move while preserving bounded current evidence", async () => {
    const resolved = await resolveCanonicalContextualTutorOffer(
      { courseId: "python-fundamentals", lessonId: "hello-world" },
      offer,
      [{ path: "main.py", content: 'print("Hello"\n' }],
      lastRun,
    );
    expect(resolved).toMatchObject({
      moveId: offer.moveId,
      scaffoldLevel: 1,
      authoredQuestion: "Which opening parenthesis still needs a closing partner?",
      evidence: { path: "main.py", line: 1, label: "Syntax error" },
    });
  });

  it("rejects stale or forged evidence instead of sending it to the model", async () => {
    await expect(resolveCanonicalContextualTutorOffer(
      { courseId: "python-fundamentals", lessonId: "hello-world" },
      { ...offer, evidence: { ...offer.evidence, line: 2 } },
      [{ path: "main.py", content: 'print("Hello"\n' }],
      lastRun,
    )).resolves.toBeNull();
    await expect(resolveCanonicalContextualTutorOffer(
      { courseId: "python-fundamentals", lessonId: "hello-world" },
      { ...offer, moveId: "invented-answer" },
      [{ path: "main.py", content: 'print("Hello"\n' }],
      lastRun,
    )).resolves.toBeNull();
  });
});
