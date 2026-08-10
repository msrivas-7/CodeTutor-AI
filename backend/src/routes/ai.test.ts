// Phase 20-P2: ai route coverage. The cancel / KEY_MISSING / schema paths had
// no dedicated spec — they were only exercised incidentally through e2e or
// manual curl. We mock openaiProvider + getOpenAIKey so the suite can assert
// route-level concerns without hitting OpenAI or the DB, and mock aiRateLimit
// to a passthrough so a shared bucket isn't polluted across runs.
//
// Uses the same x-test-user fake-auth middleware shape as userData.test.ts
// and feedback.test.ts.

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Route-level progression proof uses the same rotated deployment keyring as
// production (with domain separation). Seed a deterministic 32-byte test key
// before the dynamically imported router captures config.
process.env.BYOK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

vi.mock("../db/preferences.js", () => ({
  getOpenAIKey: vi.fn(),
}));

vi.mock("../db/aiReservations.js", () => ({
  cancelAIRequest: vi.fn(async () => "reserved"),
  fingerprintAIRequest: vi.fn(() => "fingerprint"),
  reserveAIRequest: vi.fn(async () => ({ ok: true, remainingToday: null })),
  finalizeAIRequest: vi.fn(async () => "finalized"),
  releaseAIRequest: vi.fn(async () => "released"),
}));

vi.mock("../services/ai/effectiveCaps.js", () => ({
  getEffectiveDailyQuestionsCap: vi.fn(async () => 30),
  getEffectiveDailyUsdCap: vi.fn(async () => 15),
  getEffectiveDailyUsdCapPerUser: vi.fn(async () => 1),
  getEffectiveLifetimeUsdCapPerUser: vi.fn(async () => 10),
}));

// Credential resolver depends on the ledger + denylist. Mock to a passthrough
// that returns BYOK when getOpenAIKey has a value and `no_key` when null,
// so existing tests keep their KEY_MISSING / success expectations.
vi.mock("../services/ai/credential.js", async () => {
  const { getOpenAIKey } = await import("../db/preferences.js");
  return {
    resolveAICredential: vi.fn(async (userId: string) => {
      const key = await getOpenAIKey(userId);
      if (key) {
        return {
          source: "byok" as const,
          key,
          remainingToday: null,
          capToday: null,
          allowedModels: null,
          resetAtUtc: null,
        };
      }
      return {
        source: "none" as const,
        reason: "no_key" as const,
        remainingToday: null,
        capToday: null,
        allowedModels: null,
        resetAtUtc: null,
      };
    }),
    invalidateUsageCaches: vi.fn(),
    markPlatformAuthFailed: vi.fn(),
  };
});

vi.mock("../middleware/aiRateLimit.js", () => {
  const passthrough = (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next();
  return {
    aiRateLimit: passthrough,
    validateKeyUserRateLimit: passthrough,
    validateKeyGlobalRateLimit: passthrough,
  };
});

// Replace the real JWKS-verifying middleware with one that mirrors the fake
// auth pattern in userData.test.ts / feedback.test.ts — read x-test-user
// directly so 401 paths exercised below are about the ROUTE's auth checks
// (resolveKey), not about JWKS plumbing. The unauth variant drops userId.
vi.mock("../middleware/authMiddleware.js", () => ({
  authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const u = req.header("x-test-user");
    if (!u) return res.status(401).json({ error: "missing bearer token" });
    req.userId = u;
    next();
  },
  __resetJwksCacheForTests: () => {},
}));

vi.mock("../services/ai/openaiProvider.js", () => ({
  estimateReservationForAsk: vi.fn(() => ({
    reservedInputTokens: 100,
    reservedOutputTokens: 50,
    promptBytes: 100,
  })),
  estimateReservationForSummary: vi.fn(() => ({
    reservedInputTokens: 100,
    reservedOutputTokens: 50,
  })),
  openaiProvider: {
    validateKey: vi.fn(async () => ({ valid: true })),
    listModels: vi.fn(async () => [{ id: "gpt-4.1", label: "gpt-4.1" }]),
    ask: vi.fn(),
    askStream: vi.fn(),
    summarize: vi.fn(async () => "summary"),
  },
}));

vi.mock("../services/ai/platformTutorModel.js", () => ({
  getEffectivePlatformTutorModel: vi.fn(async () => ({
    model: "gpt-5.6-luna",
    source: "fallback" as const,
    setBy: null,
    setAt: null,
    reason: null,
    invalidOverride: null,
  })),
}));

vi.mock("../services/ai/canonicalTutorContext.js", () => ({
  resolveCanonicalTutorContext: vi.fn(async () => ({
    courseId: "python-fundamentals",
    lessonId: "hello-world",
    exerciseId: null,
    lessonTitle: "Hello, World!",
    language: "python",
    lessonObjectives: ["Run a program"],
    teachesConceptTags: ["print"],
    usesConceptTags: [],
    priorConcepts: [],
    completionCriteria: ["Program runs"],
    studentProgressSummary: "No attempts yet.",
    lessonOrder: 1,
    totalLessons: 12,
  })),
}));

vi.mock("../services/ai/suspectApi.js", () => ({ flagSuspectApis: vi.fn() }));

const { aiRouter } = await import("./ai.js");
const { getOpenAIKey } = await import("../db/preferences.js");
const { openaiProvider } = await import("../services/ai/openaiProvider.js");
const { cancelAIRequest, reserveAIRequest, finalizeAIRequest } = await import("../db/aiReservations.js");
const { resolveAICredential } = await import("../services/ai/credential.js");
const { flagSuspectApis } = await import("../services/ai/suspectApi.js");
const { getEffectivePlatformTutorModel } = await import("../services/ai/platformTutorModel.js");
const { errorHandler } = await import("../middleware/errorHandler.js");

let srv: Server;
let base: string;

function req(userId: string | null, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (userId) headers.set("x-test-user", userId);
  headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

function validAskBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "00000000-0000-4000-8000-000000000001",
    model: "gpt-4.1",
    question: "why is this code wrong?",
    files: [{ path: "main.py", content: "print('hi')" }],
    history: [],
    ...overrides,
  };
}

const platformCredential = {
  source: "platform" as const,
  key: "sk-platform-test",
  remainingToday: 30,
  capToday: 30,
  allowedModels: ["gpt-5.6-luna"] as const,
  resetAtUtc: new Date("2026-08-01T00:00:00.000Z"),
};

beforeAll(async () => {
  // Mirror the real index.ts mount: authMiddleware is lifted to the router
  // level, not attached per-route. We pass it via the mocked module so
  // x-test-user is the single source of identity.
  const { authMiddleware } = await import("../middleware/authMiddleware.js");
  const app = express();
  app.use(express.json());
  app.use("/api/ai", authMiddleware, aiRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (srv) await new Promise<void>((r) => srv.close(() => r()));
});

beforeEach(() => {
  // The provider mocks are module-level; reset spy state between specs so
  // `toHaveBeenCalledTimes(1)` sees only the calls from the current test.
  vi.mocked(openaiProvider.ask).mockReset();
  vi.mocked(openaiProvider.askStream).mockReset();
  vi.mocked(openaiProvider.summarize).mockReset();
  vi.mocked(openaiProvider.validateKey).mockReset();
  vi.mocked(getOpenAIKey).mockReset();
  vi.mocked(resolveAICredential).mockReset();
  vi.mocked(resolveAICredential).mockImplementation(async (userId: string) => {
    const key = await getOpenAIKey(userId);
    if (key) {
      return {
        source: "byok" as const,
        key,
        remainingToday: null,
        capToday: null,
        allowedModels: null,
        resetAtUtc: null,
      };
    }
    return {
      source: "none" as const,
      reason: "no_key" as const,
      remainingToday: null,
      capToday: null,
      allowedModels: null,
      resetAtUtc: null,
    };
  });
  vi.mocked(reserveAIRequest).mockReset();
  vi.mocked(reserveAIRequest).mockResolvedValue({ ok: true, remainingToday: null });
  vi.mocked(finalizeAIRequest).mockReset();
  vi.mocked(finalizeAIRequest).mockResolvedValue("finalized");
  vi.mocked(cancelAIRequest).mockReset();
  vi.mocked(cancelAIRequest).mockResolvedValue("reserved");
  vi.mocked(flagSuspectApis).mockReset();
  vi.mocked(getEffectivePlatformTutorModel).mockReset();
  vi.mocked(getEffectivePlatformTutorModel).mockResolvedValue({
    model: "gpt-5.6-luna",
    source: "fallback",
    setBy: null,
    setAt: null,
    reason: null,
    invalidOverride: null,
  });
});

describe("POST /api/ai/ask — KEY_MISSING", () => {
  it("returns 400 KEY_MISSING when the user hasn't stored a key", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce(null);
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("KEY_MISSING");
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await req(null, "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ai/ask — schema validation", () => {
  it("returns 400 on a file path with disallowed characters (space)", async () => {
    // safePathSchema allows `.` and `/`, so `../etc/passwd` actually passes
    // the regex — traversal is defended by the prompt wrapper's XML escape,
    // not the schema. The schema blocks chars that WOULD break the wrapper,
    // e.g. whitespace / angle brackets. A space is the simplest case.
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(
        validAskBody({ files: [{ path: "foo bar.py", content: "x" }] }),
      ),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });

  it("returns 400 on a file path containing angle brackets (XML wrapper break)", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(
        validAskBody({ files: [{ path: "<hack>.py", content: "x" }] }),
      ),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });

  it("requires an explicit learner-selected model for BYOK", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: undefined })),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "BYOK_MODEL_REQUIRED" });
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });

  it("returns 400 when the caller omits the accepted-action id", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const { requestId: _omitted, ...body } = validAskBody();
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(reserveAIRequest)).not.toHaveBeenCalled();
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });

  it("returns 400 when question is empty", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ question: "" })),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when files array exceeds the 50-item cap", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      path: `f${i}.py`,
      content: "x",
    }));
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ files: tooMany })),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when selection.path has disallowed characters", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(
        validAskBody({
          selection: { path: "a b.py", startLine: 1, endLine: 2, text: "x" },
        }),
      ),
    });
    expect(res.status).toBe(400);
  });

  it("passes a valid payload through to the provider", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    vi.mocked(openaiProvider.ask).mockResolvedValueOnce({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        question: "Could you orient me?",
        tutorAction: "explain-lesson-task",
      })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sections: { summary: string };
      tutorProgressToken: string;
    };
    expect(body.sections.summary).toBe("ok");
    expect(body.tutorProgressToken).toEqual(expect.any(String));
    expect(vi.mocked(openaiProvider.ask)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(openaiProvider.ask).mock.calls[0][0];
    expect(call.key).toBe("sk-test");
    expect(call.tutorStage).toBe("clarify");
    expect(call.tutorAction).toBe("explain-lesson-task");
    expect(call.signal).toBeDefined();
    expect(vi.mocked(reserveAIRequest)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(finalizeAIRequest)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(finalizeAIRequest)).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 50,
        ledgerStatus: "finish",
        providerOutcomeUncertain: true,
      }),
    );
    expect(vi.mocked(flagSuspectApis)).toHaveBeenCalledWith({
      responseText: "{\"summary\":\"ok\"}",
      userFiles: [{ path: "main.py", content: "print('hi')" }],
      userQuestion: "Could you orient me?",
      language: "python",
      route: "ask",
    });
  });

  it("does not spend visible quota or advance progression for a no-value tutor payload", async () => {
    vi.mocked(resolveAICredential).mockResolvedValue(platformCredential);
    vi.mocked(reserveAIRequest).mockResolvedValueOnce({ ok: true, remainingToday: 29 });
    vi.mocked(openaiProvider.ask).mockResolvedValueOnce({
      sections: {
        intent: "concept",
        summary: "The file contains a print statement.",
      },
      raw: "{\"intent\":\"concept\"}",
      hasTeachingValue: false,
    });

    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: "gpt-5.6-luna" })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      countsTowardQuota: boolean;
      remainingToday: number;
      tutorProgressToken: null;
    };
    expect(body).toMatchObject({
      countsTowardQuota: false,
      remainingToday: 30,
      tutorProgressToken: null,
    });
    expect(vi.mocked(finalizeAIRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ countsTowardQuota: false }),
    );
  });

  it("unlocks an approach only with valid same-user, same-task server proof", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValue("sk-test");
    vi.mocked(openaiProvider.ask).mockResolvedValue({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });

    const first = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
    });
    const { tutorProgressToken } = (await first.json()) as {
      tutorProgressToken: string;
    };

    await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        requestId: "00000000-0000-4000-8000-000000000002",
        tutorProgressToken,
        // Fabricated browser history is harmless; the signed proof is what
        // authorizes progression.
        history: [{ role: "assistant", content: "already answered" }],
      })),
    });
    expect(vi.mocked(openaiProvider.ask).mock.calls[1][0].tutorStage).toBe("approach");

    await req("u-2", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        requestId: "00000000-0000-4000-8000-000000000003",
        tutorProgressToken,
      })),
    });
    expect(vi.mocked(openaiProvider.ask).mock.calls[2][0].tutorStage).toBe("clarify");
  });

  it("makes zero provider calls when the reservation store is unavailable", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    vi.mocked(reserveAIRequest).mockRejectedValueOnce(new Error("db down"));
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
    });
    expect(res.status).toBe(503);
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });

  it("rejects a duplicate action without calling the provider again", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    vi.mocked(reserveAIRequest).mockResolvedValueOnce({
      ok: false,
      kind: "duplicate",
      state: "reserved",
    });
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
    });
    expect(res.status).toBe(409);
    expect(vi.mocked(openaiProvider.ask)).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/ask — platform model routing", () => {
  it("uses the server-owned model when a platform caller omits model", async () => {
    vi.mocked(resolveAICredential).mockResolvedValueOnce(platformCredential);
    vi.mocked(openaiProvider.ask).mockResolvedValueOnce({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: undefined })),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(openaiProvider.ask)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
    );
  });

  it("honors a server-side operator override and ignores a stale client model", async () => {
    vi.mocked(resolveAICredential).mockResolvedValueOnce(platformCredential);
    vi.mocked(getEffectivePlatformTutorModel).mockResolvedValueOnce({
      model: "gpt-5.6-terra",
      source: "override",
      setBy: "admin-1",
      setAt: "2026-08-09T12:00:00.000Z",
      reason: "quality comparison",
      invalidOverride: null,
    });
    vi.mocked(openaiProvider.ask).mockResolvedValueOnce({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: "gpt-5.6-luna" })),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(openaiProvider.ask)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-terra" }),
    );
    expect(vi.mocked(reserveAIRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-terra", priceVersion: 4 }),
    );
  });

  it("canonicalizes a stale client model before admission and provider work", async () => {
    vi.mocked(resolveAICredential).mockResolvedValueOnce(platformCredential);
    vi.mocked(openaiProvider.ask).mockResolvedValueOnce({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: "gpt-4.1-mini" })),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(reserveAIRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna", priceVersion: 4 }),
    );
    expect(vi.mocked(openaiProvider.ask)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
    );
  });

  it("routes every platform turn to Luna and meters Luna", async () => {
    vi.mocked(resolveAICredential)
      .mockResolvedValueOnce(platformCredential)
      .mockResolvedValueOnce(platformCredential);
    vi.mocked(openaiProvider.ask).mockResolvedValue({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });

    const first = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        model: "gpt-5.6-luna",
        question: "Is my loop approach okay?",
      })),
    });
    const { tutorProgressToken } = await first.json() as { tutorProgressToken: string };
    expect(vi.mocked(openaiProvider.ask).mock.calls[0][0].model).toBe("gpt-5.6-luna");

    const second = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        requestId: "00000000-0000-4000-8000-000000000022",
        model: "gpt-5.6-luna",
        question: "Is my loop approach okay?",
        tutorProgressToken,
      })),
    });
    expect(second.status).toBe(200);
    expect(vi.mocked(openaiProvider.ask).mock.calls[1][0].model).toBe("gpt-5.6-luna");
    expect(vi.mocked(reserveAIRequest).mock.calls[1][0]).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        reservedCostUsd: 0.0004,
        priceVersion: 4,
      }),
    );
    expect(vi.mocked(finalizeAIRequest).mock.calls[1][0]).toEqual(
      expect.objectContaining({ costUsd: 0.0004, ledgerStatus: "finish" }),
    );
  });

  it("keeps a progressed walkthrough on Luna", async () => {
    vi.mocked(resolveAICredential)
      .mockResolvedValueOnce(platformCredential)
      .mockResolvedValueOnce(platformCredential);
    vi.mocked(openaiProvider.ask).mockResolvedValue({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });
    const first = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: "gpt-5.6-luna" })),
    });
    const { tutorProgressToken } = await first.json() as { tutorProgressToken: string };
    await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        requestId: "00000000-0000-4000-8000-000000000023",
        model: "gpt-5.6-luna",
        question: "Walk me through this code",
        tutorProgressToken,
      })),
    });
    expect(vi.mocked(openaiProvider.ask).mock.calls[1][0].model).toBe("gpt-5.6-luna");
    expect(vi.mocked(reserveAIRequest).mock.calls[1][0]).toEqual(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
    );
  });
});

describe("POST /api/ai/ask — BYOK contextual compatibility", () => {
  it("preserves the evaluated Luna selection for a guided BYOK lesson request", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-user-luna");
    vi.mocked(openaiProvider.ask).mockResolvedValueOnce({
      sections: { summary: "ok" },
      raw: "{\"summary\":\"ok\"}",
    });

    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        model: "gpt-5.6-luna",
        lessonContext: {
          courseId: "python-fundamentals",
          lessonId: "hello-world",
          exerciseId: null,
        },
      })),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(openaiProvider.ask)).toHaveBeenCalledWith(
      expect.objectContaining({
        fundingSource: "byok",
        model: "gpt-5.6-luna",
        lessonContext: expect.objectContaining({ lessonId: "hello-world" }),
      }),
    );
  });
});

describe("POST /api/ai/ask/stream — tutor progression", () => {
  it("returns signed proof in the terminal frame and accepts it on turn two", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValue("sk-test");
    vi.mocked(openaiProvider.askStream).mockImplementation(
      async (_params, handlers) => {
        await handlers.onDone(
          "{\"intent\":\"socratic\"}",
          { intent: "socratic", checkQuestions: ["What did you expect?"] },
          { inputTokens: 10, outputTokens: 5 },
        );
      },
    );

    const first = await req("u-1", "/api/ai/ask/stream", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
    });
    expect(first.status).toBe(200);
    const firstText = await first.text();
    const firstDone = JSON.parse(
      firstText.split("\n").find((line) => line.startsWith("data: "))!.slice(6),
    ) as { done: boolean; tutorProgressToken: string };
    expect(firstDone.done).toBe(true);
    expect(firstDone.tutorProgressToken).toEqual(expect.any(String));
    expect(vi.mocked(openaiProvider.askStream).mock.calls[0][0].tutorStage).toBe("clarify");
    expect(vi.mocked(flagSuspectApis)).toHaveBeenCalledWith({
      responseText: "{\"intent\":\"socratic\"}",
      userFiles: [{ path: "main.py", content: "print('hi')" }],
      userQuestion: "why is this code wrong?",
      language: "python",
      route: "ask_stream",
    });

    const second = await req("u-1", "/api/ai/ask/stream", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        requestId: "00000000-0000-4000-8000-000000000004",
        tutorProgressToken: firstDone.tutorProgressToken,
      })),
    });
    expect(second.status).toBe(200);
    await second.text();
    expect(vi.mocked(openaiProvider.askStream).mock.calls[1][0].tutorStage).toBe("approach");
    expect(vi.mocked(openaiProvider.askStream).mock.calls[1][0].model).toBe("gpt-5.6-luna");
  });

  it("applies the same server-side override on every platform stream turn", async () => {
    vi.mocked(resolveAICredential)
      .mockResolvedValueOnce(platformCredential)
      .mockResolvedValueOnce(platformCredential);
    vi.mocked(getEffectivePlatformTutorModel).mockResolvedValue({
      model: "gpt-5.6-terra",
      source: "override",
      setBy: "admin-1",
      setAt: "2026-08-09T12:00:00.000Z",
      reason: "quality comparison",
      invalidOverride: null,
    });
    vi.mocked(openaiProvider.askStream).mockImplementation(
      async (_params, handlers) => {
        await handlers.onDone(
          "{\"intent\":\"socratic\"}",
          { intent: "socratic", checkQuestions: ["What did you expect?"] },
          { inputTokens: 10, outputTokens: 5 },
        );
      },
    );

    const first = await req("u-1", "/api/ai/ask/stream", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        model: "gpt-5.6-luna",
        question: "Is this on the right track?",
      })),
    });
    const firstText = await first.text();
    const firstDone = JSON.parse(
      firstText.split("\n").find((line) => line.startsWith("data: "))!.slice(6),
    ) as { tutorProgressToken: string };
    expect(vi.mocked(openaiProvider.askStream).mock.calls[0][0].model).toBe("gpt-5.6-terra");

    const second = await req("u-1", "/api/ai/ask/stream", {
      method: "POST",
      body: JSON.stringify(validAskBody({
        requestId: "00000000-0000-4000-8000-000000000024",
        model: "gpt-5.6-luna",
        question: "Is this on the right track?",
        tutorProgressToken: firstDone.tutorProgressToken,
      })),
    });
    expect(second.status).toBe(200);
    await second.text();
    expect(vi.mocked(openaiProvider.askStream).mock.calls[1][0].model).toBe("gpt-5.6-terra");
    expect(vi.mocked(reserveAIRequest).mock.calls[1][0]).toEqual(
      expect.objectContaining({ model: "gpt-5.6-terra", priceVersion: 4 }),
    );
  });

  it("closes an unanswerable reflection at the final allowance boundary", async () => {
    vi.mocked(resolveAICredential).mockResolvedValueOnce(platformCredential);
    vi.mocked(reserveAIRequest).mockResolvedValueOnce({ ok: true, remainingToday: 0 });
    vi.mocked(openaiProvider.askStream).mockImplementationOnce(
      async (_params, handlers) => {
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
      },
    );

    const res = await req("u-1", "/api/ai/ask/stream", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: "gpt-5.6-luna" })),
    });
    const text = await res.text();
    const done = JSON.parse(
      text.split("\n").find((line) => line.startsWith("data: "))!.slice(6),
    ) as {
      raw: string;
      remainingToday: number;
      sections: { intent: string; checkQuestions: null; comprehensionCheck: null; hint: string };
    };
    expect(done.remainingToday).toBe(0);
    expect(done.sections).toMatchObject({
      intent: "howto",
      checkQuestions: null,
      comprehensionCheck: null,
      hint: "Use the lesson's output operation as your starting point.",
    });
    expect(JSON.parse(done.raw)).toMatchObject({
      intent: "howto",
      checkQuestions: null,
      comprehensionCheck: null,
    });
  });
});

describe("POST /api/ai/ask/cancel", () => {
  it("refunds only the signed-in learner's accepted request", async () => {
    const res = await req("u-1", "/api/ai/ask/cancel", {
      method: "POST",
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(204);
    expect(vi.mocked(cancelAIRequest)).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      { actorKind: "user", userId: "u-1" },
    );
  });

  it("does not disclose another learner's request", async () => {
    vi.mocked(cancelAIRequest).mockResolvedValueOnce(null);
    const res = await req("u-2", "/api/ai/ask/cancel", {
      method: "POST",
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000001" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/ai/ask — client-close cancel", () => {
  it("aborts the provider signal when the client disconnects mid-flight", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    // Capture the signal so we can assert abort after client-close. The
    // handler races: if the provider resolves before the abort propagates
    // we see no throw; the assertion is on signal.aborted, which flips
    // synchronously on the `close` event regardless of provider timing.
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(openaiProvider.ask).mockImplementationOnce(
      async (params) =>
        new Promise((resolve) => {
          capturedSignal = params.signal;
          params.signal?.addEventListener("abort", () => {
            // Simulate the provider bailing out on abort — tutor call
            // returns a (never-used) stub so the route's finally/cleanup
            // path still runs.
            resolve({ sections: {}, raw: "" });
          });
        }),
    );

    const controller = new AbortController();
    const fetchPromise = req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody()),
      signal: controller.signal,
    }).catch(() => null);

    // Wait long enough for the server to call openaiProvider.ask and
    // register the close listener before we abort. 50ms is a generous
    // headroom on localhost; route hits the mock in sub-ms typically.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await fetchPromise;
    // Give the server's close-handler a tick to fire.
    await new Promise((r) => setTimeout(r, 20));

    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("POST /api/ai/summarize — empty history short-circuit", () => {
  it("returns an empty summary without calling the provider when history is []", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    vi.mocked(openaiProvider.summarize).mockClear();
    const res = await req("u-1", "/api/ai/summarize", {
      method: "POST",
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000002",
        model: "gpt-4.1",
        history: [],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: string };
    expect(body.summary).toBe("");
    expect(vi.mocked(openaiProvider.summarize)).not.toHaveBeenCalled();
  });

  it("uses the reservation ceiling when successful usage metadata is missing", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    vi.mocked(openaiProvider.summarize).mockResolvedValueOnce({
      summary: "Earlier context",
    });
    const res = await req("u-1", "/api/ai/summarize", {
      method: "POST",
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000003",
        model: "gpt-4.1",
        history: [{ role: "user", content: "Explain variables." }],
      }),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(finalizeAIRequest)).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 50,
        ledgerStatus: "finish",
        providerOutcomeUncertain: true,
      }),
    );
  });

  it("uses the server-side override for hidden platform summary work", async () => {
    vi.mocked(resolveAICredential).mockResolvedValueOnce(platformCredential);
    vi.mocked(getEffectivePlatformTutorModel).mockResolvedValueOnce({
      model: "gpt-5.6-terra",
      source: "override",
      setBy: "admin-1",
      setAt: "2026-08-09T12:00:00.000Z",
      reason: "quality comparison",
      invalidOverride: null,
    });
    vi.mocked(openaiProvider.summarize).mockResolvedValueOnce({
      summary: "Earlier context",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const res = await req("u-1", "/api/ai/summarize", {
      method: "POST",
      body: JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000004",
        model: "gpt-4.1-nano",
        history: [{ role: "user", content: "Explain variables." }],
      }),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(reserveAIRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-terra" }),
    );
    expect(vi.mocked(openaiProvider.summarize)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-terra" }),
    );
  });
});

describe("POST /api/ai/validate-key — auth-gated", () => {
  it("rejects an unauthenticated caller with 401 and does not hit the provider", async () => {
    const res = await req(null, "/api/ai/validate-key", {
      method: "POST",
      body: JSON.stringify({ key: "sk-abc" }),
    });
    expect(res.status).toBe(401);
    expect(vi.mocked(openaiProvider.validateKey)).not.toHaveBeenCalled();
  });

  it("400s on empty key for an authenticated caller", async () => {
    const res = await req("u1", "/api/ai/validate-key", {
      method: "POST",
      body: JSON.stringify({ key: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("forwards a valid key to the provider for an authenticated caller", async () => {
    vi.mocked(openaiProvider.validateKey).mockResolvedValueOnce({ valid: true });
    const res = await req("u1", "/api/ai/validate-key", {
      method: "POST",
      body: JSON.stringify({ key: "sk-abc" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean };
    expect(body.valid).toBe(true);
  });
});
