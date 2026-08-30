import { describe, expect, it } from "vitest";
import { resolveCanonicalContextualTutorOffer } from "./canonicalTutorContext.js";
import { mintContextualEvidenceToken } from "./contextualEvidence.js";

const lastRun = {
  stdout: "",
  stderr: '  File "/workspace/main.py", line 1\n    print("Hello"\n         ^\nSyntaxError: \'(\' was never closed\n',
  exitCode: 1,
  errorType: "runtime" as const,
  durationMs: 10,
  stage: "run" as const,
};

const files = [{ path: "main.py", content: 'print("Hello"\n' }];
const identity = { courseId: "python-fundamentals", lessonId: "hello-world" };
const actorId = "user:test-user";
const keyring = {
  currentVersion: 1,
  keys: new Map([[1, Buffer.alloc(32, 7).toString("base64")]]),
};
const offer = {
  contextVersion: 0 as const,
  contextEpoch: "lesson:python-fundamentals/hello-world",
  projectRevision: 2,
  evidenceToken: mintContextualEvidenceToken(
    actorId,
    {
      ...identity,
      contextEpoch: "lesson:python-fundamentals/hello-world",
      projectRevision: 2,
    },
    files,
    lastRun,
    { keyring },
  ),
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
      actorId,
      identity,
      offer,
      files,
      lastRun,
      { keyring },
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
      actorId,
      identity,
      { ...offer, evidence: { ...offer.evidence, line: 2 } },
      files,
      lastRun,
      { keyring },
    )).resolves.toBeNull();
    await expect(resolveCanonicalContextualTutorOffer(
      actorId,
      identity,
      { ...offer, moveId: "invented-answer" },
      files,
      lastRun,
      { keyring },
    )).resolves.toBeNull();
    await expect(resolveCanonicalContextualTutorOffer(
      "user:someone-else",
      identity,
      offer,
      files,
      lastRun,
      { keyring },
    )).resolves.toBeNull();
  });
});
