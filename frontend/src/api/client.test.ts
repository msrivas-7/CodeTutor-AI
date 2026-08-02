import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

const { getSession, refreshSession, signOut } = vi.hoisted(() => ({
  getSession: vi.fn<
    () => Promise<{ data: { session: { access_token: string } | null } }>
  >(async () => ({ data: { session: null } })),
  refreshSession: vi.fn<
    () => Promise<{
      data: { session: { access_token: string } | null };
      error: Error | null;
    }>
  >(async () => ({ data: { session: null }, error: null })),
  signOut: vi.fn(async () => undefined),
}));

vi.mock("../auth/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession,
      refreshSession,
      signOut,
    },
  },
}));

const { ADMIN_REQUEST_TIMEOUT_MS, api } = await import("./client");

describe("expired session recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getSession.mockReset();
    refreshSession.mockReset();
    signOut.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "expired-token" } },
    });
  });

  it("refreshes once and replays the original request without signing out", async () => {
    refreshSession.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ welcomeDone: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getPreferences()).resolves.toEqual({ welcomeDone: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer expired-token",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-token",
    });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("keeps the learner signed in when refresh cannot recover the request", async () => {
    refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error("offline"),
    });
    const fetchMock = vi.fn(async () => new Response("expired", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getPreferences()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("admin request recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: "admin-token" } },
    });
  });

  it("turns a hung admin read into a bounded, actionable error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
      ),
    );

    const request = expect(api.adminGetDashboard()).rejects.toThrow(
      "The admin request took too long. Check the connection and try again.",
    );
    await vi.advanceTimersByTimeAsync(ADMIN_REQUEST_TIMEOUT_MS);
    await request;
    vi.useRealTimers();
  });
});

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

describe("AI tutor progression stream", () => {
  it("forwards the server-signed progression proof from the terminal frame", async () => {
    const terminal = {
      done: true,
      raw: "{\"intent\":\"socratic\"}",
      sections: {
        intent: "socratic",
        checkQuestions: ["What did you expect?"],
      },
      tutorProgressToken: "signed-proof",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        `data: ${JSON.stringify(terminal)}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )),
    );
    const onDone = vi.fn();
    await api.askAIStream(
      {
        requestId: "00000000-0000-4000-8000-000000000001",
        model: "gpt-4.1-nano",
        question: "help",
        files: [],
        history: [],
      },
      { onDelta: vi.fn(), onDone, onError: vi.fn() },
    );
    expect(onDone).toHaveBeenCalledWith(
      terminal.raw,
      terminal.sections,
      undefined,
      "signed-proof",
    );
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
