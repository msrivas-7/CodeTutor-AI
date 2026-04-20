import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request } from "express";

// Phase 17 / M-A2: the bucket key is the whole fix. We stub the session
// lookup so we can assert *all* three branches of bucketKey() —
// untrusted-sid, empty-sid, trusted-sid — without spinning up a full
// execution backend.
vi.mock("../services/session/sessionManager.js", () => ({
  getSession: vi.fn(),
}));

import { bucketKey } from "./aiRateLimit.js";
import { getSession } from "../services/session/sessionManager.js";

// Thin builder so every test starts from a known-good shape without typing
// out the rest of the Express Request interface.
function makeReq(ip: string, body: unknown): Request {
  return { ip, body } as unknown as Request;
}

describe("aiRateLimit bucketKey", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
  });

  it("falls back to an IP-only bucket when no sessionId is sent", () => {
    const key = bucketKey(makeReq("127.0.0.1", {}));
    expect(key).toBe("ip:127.0.0.1");
    expect(vi.mocked(getSession)).not.toHaveBeenCalled();
  });

  it("falls back to an IP-only bucket when sessionId is an empty string", () => {
    const key = bucketKey(makeReq("127.0.0.1", { sessionId: "" }));
    expect(key).toBe("ip:127.0.0.1");
    expect(vi.mocked(getSession)).not.toHaveBeenCalled();
  });

  it("falls back to an IP-only bucket when the sessionId is unknown", () => {
    // M-A2 core assertion: an attacker rotating fake sids per request must
    // still land in the same IP bucket rather than getting a fresh one.
    vi.mocked(getSession).mockReturnValue(undefined);
    const key1 = bucketKey(makeReq("127.0.0.1", { sessionId: "fake-1" }));
    const key2 = bucketKey(makeReq("127.0.0.1", { sessionId: "fake-2" }));
    expect(key1).toBe("ip:127.0.0.1");
    expect(key2).toBe("ip:127.0.0.1");
    expect(key1).toBe(key2);
  });

  it("uses a combined sid|ip bucket when the session exists", () => {
    vi.mocked(getSession).mockReturnValue({
      id: "s-real",
      handle: null,
      lastSeen: 0,
      createdAt: 0,
      selectedModel: null,
    });
    const key = bucketKey(makeReq("127.0.0.1", { sessionId: "s-real" }));
    expect(key).toBe("sid:s-real|ip:127.0.0.1");
  });

  it("does not merge different IPs into the same trusted-sid bucket", () => {
    vi.mocked(getSession).mockReturnValue({
      id: "s-real",
      handle: null,
      lastSeen: 0,
      createdAt: 0,
      selectedModel: null,
    });
    const k1 = bucketKey(makeReq("10.0.0.1", { sessionId: "s-real" }));
    const k2 = bucketKey(makeReq("10.0.0.2", { sessionId: "s-real" }));
    expect(k1).not.toBe(k2);
  });
});
