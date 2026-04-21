import { describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { requestId } from "./requestId.js";

// Phase 20-P1: X-Request-ID is the correlation thread. A server-minted id
// must always land; an incoming id is honoured only when it's safe-shaped
// (6–32 chars, [A-Za-z0-9_-]). We reject junk so a malicious client can't
// forge a log line that collides with someone else's support ticket.

async function listen(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(requestId);
  app.get("/probe", (req, res) => {
    res.json({ id: req.id });
  });
  return new Promise((resolve) => {
    const srv: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe("requestId middleware", () => {
  it("mints a fresh id when no X-Request-ID is provided", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`);
      const body = (await res.json()) as { id: string };
      const header = res.headers.get("x-request-id");
      expect(body.id).toBeTruthy();
      expect(body.id.length).toBeGreaterThanOrEqual(6);
      expect(header).toBe(body.id);
    } finally {
      await srv.close();
    }
  });

  it("propagates a safe-shaped incoming X-Request-ID", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, {
        headers: { "X-Request-ID": "abc123XYZ_-" },
      });
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe("abc123XYZ_-");
      expect(res.headers.get("x-request-id")).toBe("abc123XYZ_-");
    } finally {
      await srv.close();
    }
  });

  it("rejects junk X-Request-ID and mints a fresh one instead", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, {
        headers: { "X-Request-ID": "has spaces and !!!" },
      });
      const body = (await res.json()) as { id: string };
      expect(body.id).not.toBe("has spaces and !!!");
      expect(body.id).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      await srv.close();
    }
  });

  it("rejects an oversize X-Request-ID", async () => {
    const srv = await listen();
    try {
      const overflow = "a".repeat(33);
      const res = await fetch(`${srv.url}/probe`, {
        headers: { "X-Request-ID": overflow },
      });
      const body = (await res.json()) as { id: string };
      expect(body.id).not.toBe(overflow);
      expect(body.id.length).toBeLessThanOrEqual(32);
    } finally {
      await srv.close();
    }
  });

  it("rejects an undersize X-Request-ID (< 6 chars)", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, {
        headers: { "X-Request-ID": "abc" },
      });
      const body = (await res.json()) as { id: string };
      expect(body.id).not.toBe("abc");
    } finally {
      await srv.close();
    }
  });
});
