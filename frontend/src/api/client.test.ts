import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

vi.mock("../auth/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      signOut: vi.fn(async () => undefined),
    },
  },
}));

const { api } = await import("./client");

describe("AI action identity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a fresh UUID to each summarize action", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ summary: "Earlier context" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await api.summarizeHistory({ model: "gpt-4.1-nano", history: [] });
    await api.summarizeHistory({ model: "gpt-4.1-nano", history: [] });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(bodies[1]?.requestId).not.toBe(bodies[0]?.requestId);
  });
});

describe("Phase B1 memory API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes canonical lesson identity in the warm-up read", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ warmup: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getMemoryWarmup("python fundamentals", "input/output");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "courseId=python+fundamentals&lessonId=input%2Foutput",
    );
  });

  it("posts only request identity and the selected choice when answering", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          episodeId: "episode-id",
          isCorrect: true,
          attemptNumber: 1,
          completed: true,
          firstAttemptCorrect: true,
          explanation: "Canonical explanation",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.answerMemoryWarmup("episode/id", {
      requestId: "00000000-0000-4000-8000-000000000001",
      choiceIndex: 2,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/user/memory/warmup/episode%2Fid/answer",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      requestId: "00000000-0000-4000-8000-000000000001",
      choiceIndex: 2,
    });
  });
});
