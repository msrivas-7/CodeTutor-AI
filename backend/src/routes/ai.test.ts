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

vi.mock("../db/preferences.js", () => ({
  getOpenAIKey: vi.fn(),
}));

// Phase 20-P4: the route writes a ledger row on finish. In unit tests
// there's no DATABASE_URL; the route's safeWriteUsage catches and logs,
// but we mock it here so the spec output stays clean.
vi.mock("../db/usageLedger.js", () => ({
  writeUsageRow: vi.fn(async () => undefined),
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
  openaiProvider: {
    validateKey: vi.fn(async () => ({ valid: true })),
    listModels: vi.fn(async () => [{ id: "gpt-4.1", label: "gpt-4.1" }]),
    ask: vi.fn(),
    askStream: vi.fn(),
    summarize: vi.fn(async () => "summary"),
  },
}));

const { aiRouter } = await import("./ai.js");
const { getOpenAIKey } = await import("../db/preferences.js");
const { openaiProvider } = await import("../services/ai/openaiProvider.js");
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
    model: "gpt-4.1",
    question: "why is this code wrong?",
    files: [{ path: "main.py", content: "print('hi')" }],
    history: [],
    ...overrides,
  };
}

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

  it("returns 400 when model is missing", async () => {
    vi.mocked(getOpenAIKey).mockResolvedValueOnce("sk-test");
    const res = await req("u-1", "/api/ai/ask", {
      method: "POST",
      body: JSON.stringify(validAskBody({ model: undefined })),
    });
    expect(res.status).toBe(400);
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
      body: JSON.stringify(validAskBody()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sections: { summary: string } };
    expect(body.sections.summary).toBe("ok");
    expect(vi.mocked(openaiProvider.ask)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(openaiProvider.ask).mock.calls[0][0];
    expect(call.key).toBe("sk-test");
    expect(call.signal).toBeDefined();
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
      body: JSON.stringify({ model: "gpt-4.1", history: [] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: string };
    expect(body.summary).toBe("");
    expect(vi.mocked(openaiProvider.summarize)).not.toHaveBeenCalled();
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
