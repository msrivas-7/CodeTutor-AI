import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ExecutionBackend } from "../services/execution/backends/index.js";

process.env.BYOK_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

vi.mock("../services/share/killSwitches.js", () => ({
  isAnonLessonEnabled: vi.fn(async () => true),
  isAiEvalSamplingEnabled: vi.fn(async () => true),
}));

vi.mock("../db/aiEvalSamples.js", () => ({
  insertEvalSample: vi.fn(async () => true),
  deleteEvalSamplesForSubjectToken: vi.fn(async () => 0),
  EvalSampleRevocationQuotaError: class EvalSampleRevocationQuotaError extends Error {},
}));

vi.mock("./anonLaptopInvite.js", async () => {
  const { Router } = await import("express");
  return { anonLaptopInviteRouter: Router() };
});
vi.mock("./anonShare.js", async () => {
  const { Router } = await import("express");
  return { anonShareRouter: Router() };
});
vi.mock("./anonConceptTag.js", async () => {
  const { Router } = await import("express");
  return { anonConceptTagRouter: Router() };
});

vi.mock("../middleware/mutationRateLimit.js", () => ({
  sessionCreateLimit: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

vi.mock("../services/execution/router.js", () => ({ runProject: vi.fn() }));
vi.mock("../db/anonRunCounts.js", () => ({ incrementAnonRunCount: vi.fn() }));
vi.mock("../services/metrics.js", () => ({
  execDuration: { observe: vi.fn() },
  aiPlatformRequests: { inc: vi.fn() },
  aiPlatformAbuseSignals: { inc: vi.fn() },
}));
vi.mock("../services/ai/suspectApi.js", () => ({ flagSuspectApis: vi.fn() }));
vi.mock("../services/shutdown/abortRegistry.js", () => ({
  registerAbortController: vi.fn(() => ({ id: "test" })),
  unregisterAbortController: vi.fn(),
}));
vi.mock("../services/ai/effectiveCaps.js", () => ({
  getEffectiveAnonDailyRunsPerIp: vi.fn(async () => 20),
  getEffectiveAnonDailyUsdCap: vi.fn(async () => 1),
  getEffectiveDailyUsdCap: vi.fn(async () => 15),
}));
vi.mock("../services/ai/credential.js", () => ({
  resolveAnonAICredential: vi.fn(async () => ({
    source: "platform" as const,
    key: "sk-platform-test",
    remainingToday: 8,
    capToday: 8,
    allowedModels: ["gpt-4.1-nano"] as const,
    resetAtUtc: new Date("2026-08-01T00:00:00.000Z"),
  })),
  invalidateAnonUsageCaches: vi.fn(),
  markPlatformAuthFailed: vi.fn(),
}));
vi.mock("../db/aiReservations.js", () => ({
  cancelAIRequest: vi.fn(async () => "reserved"),
  fingerprintAIRequest: vi.fn(() => "fingerprint"),
  reserveAIRequest: vi.fn(async () => ({ ok: true, remainingToday: 7 })),
  finalizeAIRequest: vi.fn(async () => "finalized"),
}));
vi.mock("../services/ai/canonicalTutorContext.js", () => ({
  resolveCanonicalAnonTutorContext: vi.fn(async () => ({
    courseId: "python-fundamentals",
    lessonId: "hello-world",
    exerciseId: null,
    lessonTitle: "Hello World",
    language: "python" as const,
    lessonObjectives: ["Print a message"],
    teachesConceptTags: ["python.print"],
    usesConceptTags: [],
    priorConcepts: [],
    completionCriteria: ["Program prints Hello"],
    studentProgressSummary: "Anonymous first session",
  })),
}));
vi.mock("../services/ai/openaiProvider.js", () => ({
  estimateReservationForAsk: vi.fn(() => ({
    reservedInputTokens: 100,
    reservedOutputTokens: 50,
    promptBytes: 100,
  })),
  openaiProvider: { askStream: vi.fn() },
}));

const { createAnonRouter } = await import("./anon.js");
const { openaiProvider } = await import("../services/ai/openaiProvider.js");
const { cancelAIRequest, reserveAIRequest, finalizeAIRequest } = await import("../db/aiReservations.js");
const { hashClientIp } = await import("../services/ai/ipHash.js");
const { flagSuspectApis } = await import("../services/ai/suspectApi.js");
const {
  insertEvalSample,
  deleteEvalSamplesForSubjectToken,
  EvalSampleRevocationQuotaError,
} = await import("../db/aiEvalSamples.js");
const { isAnonLessonEnabled, isAiEvalSamplingEnabled } = await import("../services/share/killSwitches.js");
const { shouldSampleEvalRequest } = await import("../services/ai/evalSampling.js");

let server: Server;
let baseUrl: string;

const unusedBackend = {} as ExecutionBackend;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "00000000-0000-4000-8000-000000000031",
    model: "gpt-4.1-nano",
    question: "Is this on the right track?",
    files: [{ path: "main.py", content: "print('Hello')\n" }],
    activeFile: "main.py",
    history: [],
    lessonContext: {
      courseId: "python-fundamentals",
      lessonId: "hello-world",
      exerciseId: null,
    },
    ...overrides,
  };
}

async function post(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/anon/ai/ask/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function cancel(requestId: string) {
  return fetch(`${baseUrl}/api/anon/ai/ask/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
}

async function deleteSamples(subjectToken: string) {
  return fetch(`${baseUrl}/api/anon/eval-samples`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subjectToken }),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/anon", createAnonRouter(unusedBackend));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(openaiProvider.askStream).mockReset();
  vi.mocked(cancelAIRequest).mockReset();
  vi.mocked(cancelAIRequest).mockResolvedValue("reserved");
  vi.mocked(reserveAIRequest).mockClear();
  vi.mocked(finalizeAIRequest).mockClear();
  vi.mocked(flagSuspectApis).mockReset();
  vi.mocked(insertEvalSample).mockClear();
  vi.mocked(deleteEvalSamplesForSubjectToken).mockReset();
  vi.mocked(deleteEvalSamplesForSubjectToken).mockResolvedValue(0);
  vi.mocked(isAnonLessonEnabled).mockResolvedValue(true);
  vi.mocked(isAiEvalSamplingEnabled).mockResolvedValue(true);
  vi.mocked(openaiProvider.askStream).mockImplementation(
    async (_params, handlers) => {
      await handlers.onDone(
        "{\"intent\":\"socratic\"}",
        { intent: "socratic", checkQuestions: ["What did you expect?"] },
        { inputTokens: 10, outputTokens: 5 },
      );
    },
  );
});

describe("POST /api/anon/ai/ask/cancel", () => {
  it("refunds only the accepted request owned by the caller IP", async () => {
    const response = await cancel("00000000-0000-4000-8000-000000000031");

    expect(response.status).toBe(204);
    expect(vi.mocked(cancelAIRequest)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000031",
      {
        actorKind: "anonymous",
        ipHash: hashClientIp("127.0.0.1"),
      },
    );
  });

  it("does not disclose a request that is not owned by the caller", async () => {
    vi.mocked(cancelAIRequest).mockResolvedValueOnce(null);

    const response = await cancel("00000000-0000-4000-8000-000000000031");

    expect(response.status).toBe(404);
  });
});

describe("B8 governed anonymous eval sampling", () => {
  const subjectToken = "a".repeat(43);
  const sampledRequestId = Array.from({ length: 1000 }, (_, index) =>
    `00000000-0000-4000-8001-${index.toString().padStart(12, "0")}`,
  ).find(shouldSampleEvalRequest)!;
  const unsampledRequestId = Array.from({ length: 1000 }, (_, index) =>
    `00000000-0000-4000-8002-${index.toString().padStart(12, "0")}`,
  ).find((id) => !shouldSampleEvalRequest(id))!;

  it("stores only a pre-insert-redacted projection for a consented sampled success", async () => {
    const response = await post(validBody({
      requestId: sampledRequestId,
      question: "I am Maya; email maya@example.com. Why does `secret_name` fail?",
      files: [{ path: "private/Maya.py", content: "PRIVATE_SOURCE_SENTINEL" }],
      history: [{ role: "user", content: "PRIVATE_HISTORY_SENTINEL" }],
      evalSamplingConsent: { version: 1, subjectToken },
    }));
    expect(response.status).toBe(200);
    await response.text();
    expect(vi.mocked(insertEvalSample)).toHaveBeenCalledTimes(1);
    const stored = vi.mocked(insertEvalSample).mock.calls[0][0];
    const serialized = JSON.stringify(stored);
    expect(stored.requestId).toBe(sampledRequestId);
    expect(stored.consentVersion).toBe(1);
    expect(serialized).not.toContain(subjectToken);
    expect(serialized).not.toContain("Maya");
    expect(serialized).not.toContain("maya@example.com");
    expect(serialized).not.toContain("secret_name");
    expect(serialized).not.toContain("PRIVATE_SOURCE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_HISTORY_SENTINEL");
  });

  it("does not store unconsented or out-of-bucket turns", async () => {
    const withoutConsent = await post(validBody({ requestId: sampledRequestId }));
    expect(withoutConsent.status).toBe(200);
    await withoutConsent.text();

    const outsideBucket = await post(validBody({
      requestId: unsampledRequestId,
      evalSamplingConsent: { version: 1, subjectToken },
    }));
    expect(outsideBucket.status).toBe(200);
    await outsideBucket.text();
    expect(vi.mocked(insertEvalSample)).not.toHaveBeenCalled();
  });

  it("stops new samples when the independent kill switch is off", async () => {
    vi.mocked(isAiEvalSamplingEnabled).mockResolvedValue(false);
    const response = await post(validBody({
      requestId: sampledRequestId,
      evalSamplingConsent: { version: 1, subjectToken },
    }));
    expect(response.status).toBe(200);
    await response.text();
    expect(vi.mocked(insertEvalSample)).not.toHaveBeenCalled();
  });

  it("never stores a sampled turn when the provider does not complete successfully", async () => {
    vi.mocked(openaiProvider.askStream).mockImplementationOnce(async (_params, handlers) => {
      await handlers.onError("provider unavailable", 503);
    });
    const response = await post(validBody({
      requestId: sampledRequestId,
      evalSamplingConsent: { version: 1, subjectToken },
    }));
    expect(response.status).toBe(200);
    await response.text();
    expect(vi.mocked(insertEvalSample)).not.toHaveBeenCalled();
  });

  it("rejects stale consent versions before provider work", async () => {
    const response = await post(validBody({
      evalSamplingConsent: { version: 2, subjectToken },
    }));
    expect(response.status).toBe(400);
    expect(vi.mocked(openaiProvider.askStream)).not.toHaveBeenCalled();
  });

  it("keeps deletion available while the anonymous lesson is disabled", async () => {
    vi.mocked(isAnonLessonEnabled).mockResolvedValue(false);
    const response = await deleteSamples(subjectToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(vi.mocked(deleteEvalSamplesForSubjectToken)).toHaveBeenCalledWith(subjectToken);
  });

  it("returns an honest retry response when the durable revocation quota is full", async () => {
    vi.mocked(deleteEvalSamplesForSubjectToken).mockRejectedValueOnce(
      new EvalSampleRevocationQuotaError(),
    );
    const response = await deleteSamples(subjectToken);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "EVAL_DELETION_RATE_LIMITED" });
  });
});

describe("POST /api/anon/ai/ask/stream — B3 model routing", () => {
  it("rejects a direct Mini request before admission or provider work", async () => {
    const response = await post(validBody({ model: "gpt-4.1-mini" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "MODEL_NOT_ALLOWED" });
    expect(vi.mocked(reserveAIRequest)).not.toHaveBeenCalled();
    expect(vi.mocked(openaiProvider.askStream)).not.toHaveBeenCalled();
  });

  it("uses Nano on turn one and Mini only for a signed check-in", async () => {
    const first = await post(validBody());
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const firstDone = JSON.parse(
      firstText.split("\n").find((line) => line.startsWith("data: "))!.slice(6),
    ) as { tutorProgressToken: string };
    expect(vi.mocked(openaiProvider.askStream).mock.calls[0][0].model).toBe("gpt-4.1-nano");
    expect(vi.mocked(flagSuspectApis)).toHaveBeenCalledWith({
      responseText: "{\"intent\":\"socratic\"}",
      userFiles: [{ path: "main.py", content: "print('Hello')\n" }],
      userQuestion: "Is this on the right track?",
      language: "python",
      route: "anon_ask_stream",
    });

    const second = await post(validBody({
      requestId: "00000000-0000-4000-8000-000000000032",
      tutorProgressToken: firstDone.tutorProgressToken,
    }));
    expect(second.status).toBe(200);
    await second.text();
    expect(vi.mocked(openaiProvider.askStream).mock.calls[1][0].model).toBe("gpt-4.1-mini");
    expect(vi.mocked(reserveAIRequest).mock.calls[1][0]).toEqual(
      expect.objectContaining({
        model: "gpt-4.1-mini",
        reservedCostUsd: 0.00012,
        priceVersion: 2,
      }),
    );
    expect(vi.mocked(finalizeAIRequest).mock.calls[1][0]).toEqual(
      expect.objectContaining({ costUsd: 0.000012, ledgerStatus: "finish" }),
    );
  });

  it("delivers useful final guidance without inviting an impossible reply", async () => {
    vi.mocked(reserveAIRequest).mockResolvedValueOnce({ ok: true, remainingToday: 0 });
    vi.mocked(openaiProvider.askStream).mockImplementationOnce(async (_params, handlers) => {
      await handlers.onDone(
        "{\"intent\":\"socratic\"}",
        {
          intent: "socratic",
          summary: "The file currently contains only comments.",
          hint: "Use the lesson's output operation as your starting point.",
          checkQuestions: ["What do you want to display?"],
          comprehensionCheck: "Can you explain your choice?",
        },
        { inputTokens: 10, outputTokens: 5 },
      );
    });

    const response = await post(validBody());
    const text = await response.text();
    const done = JSON.parse(
      text.split("\n").find((line) => line.startsWith("data: "))!.slice(6),
    ) as {
      raw: string;
      remainingToday: number;
      sections: {
        intent: string;
        checkQuestions: null;
        comprehensionCheck: null;
        hint: string;
        nextStep: string;
      };
    };

    expect(done.remainingToday).toBe(0);
    expect(done.sections).toMatchObject({
      intent: "howto",
      checkQuestions: null,
      comprehensionCheck: null,
      hint: "Use the lesson's output operation as your starting point.",
      nextStep: expect.stringContaining("run the smallest change"),
    });
    expect(JSON.parse(done.raw)).toMatchObject({
      intent: "howto",
      checkQuestions: null,
      comprehensionCheck: null,
    });
  });
});
