import { describe, expect, it } from "vitest";
import { resolveCanonicalContextualTutorOffer } from "./canonicalTutorContext.js";
import { mintContextualEvidenceToken } from "./contextualEvidence.js";

const lastRun = {
  stdout: "",
  stderr: '  File "/workspace/main.py", line 1\n    print("Hello"\n         ^\nSyntaxError: \'(\' was never closed\n',
  exitCode: 1,
  errorType: "compile" as const,
  durationMs: 10,
  stage: "compile" as const,
};

const files = [{ path: "main.py", content: 'print("Hello"\n' }];
const firstFiles = [{ path: "main.py", content: 'print("Hi"\n' }];
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
  evidenceTokens: [
    mintContextualEvidenceToken(
      actorId,
      {
        ...identity,
        contextEpoch: "lesson:python-fundamentals/hello-world",
        projectRevision: 1,
      },
      firstFiles,
      {
        ...lastRun,
        stderr: '  File "/workspace/main.py", line 1\n    print("Hi"\n         ^\nSyntaxError: \'(\' was never closed\n',
      },
      { keyring },
    ),
  ],
  moveId: "notice-unclosed-parenthesis",
  evidence: {
    code: "python-unclosed-parenthesis" as const,
    path: "main.py",
    line: 1,
  },
  scaffoldLevel: 1 as const,
};
offer.evidenceTokens.push(offer.evidenceToken);

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

  it("rejects learner-controlled runtime stderr that impersonates Python", async () => {
    const forgedRun = {
      ...lastRun,
      errorType: "runtime" as const,
      stage: "run" as const,
    };
    const forgedToken = mintContextualEvidenceToken(
      actorId,
      {
        ...identity,
        contextEpoch: offer.contextEpoch,
        projectRevision: offer.projectRevision,
      },
      files,
      forgedRun,
      { keyring },
    );
    const firstForgedToken = mintContextualEvidenceToken(
      actorId,
      {
        ...identity,
        contextEpoch: offer.contextEpoch,
        projectRevision: offer.projectRevision - 1,
      },
      firstFiles,
      forgedRun,
      { keyring },
    );

    await expect(resolveCanonicalContextualTutorOffer(
      actorId,
      identity,
      {
        ...offer,
        evidenceToken: forgedToken,
        evidenceTokens: [firstForgedToken, forgedToken],
      },
      files,
      forgedRun,
      { keyring },
    )).resolves.toBeNull();
  });

  it("requires the server-signed repeated-error threshold", async () => {
    await expect(resolveCanonicalContextualTutorOffer(
      actorId,
      identity,
      { ...offer, evidenceTokens: [offer.evidenceToken] },
      files,
      lastRun,
      { keyring },
    )).resolves.toBeNull();
    await expect(resolveCanonicalContextualTutorOffer(
      actorId,
      identity,
      { ...offer, evidenceTokens: [offer.evidenceToken, offer.evidenceToken] },
      files,
      lastRun,
      { keyring },
    )).resolves.toBeNull();
  });

  it("binds overlapping basenames to the most specific executed project path", async () => {
    const ambiguousFiles = [
      { path: "main.py", content: 'print("root"\n' },
      { path: "examples/main.py", content: 'print("example"\n' },
    ];
    const nestedRun = {
      ...lastRun,
      stderr: '  File "/workspace/examples/main.py", line 1\n    print("example"\n         ^\nSyntaxError: \'(\' was never closed\n',
    };
    const firstNestedFiles = [
      ambiguousFiles[0],
      { path: "examples/main.py", content: 'print("first"\n' },
    ];
    const firstNestedRun = {
      ...nestedRun,
      stderr: '  File "/workspace/examples/main.py", line 1\n    print("first"\n         ^\nSyntaxError: \'(\' was never closed\n',
    };
    const evidenceToken = mintContextualEvidenceToken(
      actorId,
      {
        ...identity,
        contextEpoch: offer.contextEpoch,
        projectRevision: offer.projectRevision,
      },
      ambiguousFiles,
      nestedRun,
      { keyring },
    );
    const firstNestedEvidenceToken = mintContextualEvidenceToken(
      actorId,
      {
        ...identity,
        contextEpoch: offer.contextEpoch,
        projectRevision: offer.projectRevision - 1,
      },
      firstNestedFiles,
      firstNestedRun,
      { keyring },
    );

    await expect(resolveCanonicalContextualTutorOffer(
      actorId,
      identity,
      { ...offer, evidenceToken },
      ambiguousFiles,
      nestedRun,
      { keyring },
    )).resolves.toBeNull();

    await expect(resolveCanonicalContextualTutorOffer(
      actorId,
      identity,
      {
        ...offer,
        evidenceToken,
        evidenceTokens: [firstNestedEvidenceToken, evidenceToken],
        evidence: { ...offer.evidence, path: "examples/main.py" },
      },
      ambiguousFiles,
      nestedRun,
      { keyring },
    )).resolves.toMatchObject({
      evidence: { path: "examples/main.py", line: 1 },
    });
  });
});
