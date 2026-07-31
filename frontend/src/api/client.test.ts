import { beforeEach, describe, expect, it, vi } from "vitest";

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
