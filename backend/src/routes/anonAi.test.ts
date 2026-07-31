import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ExecutionBackend } from "../services/execution/backends/index.js";

process.env.BYOK_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

vi.mock("../services/share/killSwitches.js", () => ({
  isAnonLessonEnabled: vi.fn(async () => true),
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
const { reserveAIRequest, finalizeAIRequest } = await import("../db/aiReservations.js");

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
  vi.mocked(reserveAIRequest).mockClear();
  vi.mocked(finalizeAIRequest).mockClear();
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
});
