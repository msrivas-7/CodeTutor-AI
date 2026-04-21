import { describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { bodyLimit } from "./bodyLimit.js";

// Phase 20-P1: per-route Content-Length precheck. The spec is simple — honest
// callers that declare a body larger than the cap get 413 before json runs.
// Missing Content-Length (chunked encoding, GET with no body) passes through;
// express.json's own limit is the ceiling of last resort for those.

async function listen(maxBytes: number): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(bodyLimit(maxBytes));
  app.use(express.json({ limit: "2mb" }));
  app.all("/probe", (_req, res) => res.json({ ok: true }));
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

describe("bodyLimit", () => {
  it("accepts a POST whose Content-Length is under the cap", async () => {
    const srv = await listen(1024);
    try {
      const res = await fetch(`${srv.url}/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: "x".repeat(200) }),
      });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it("rejects a POST whose Content-Length exceeds the cap (413)", async () => {
    const srv = await listen(256);
    try {
      const res = await fetch(`${srv.url}/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: "x".repeat(1000) }),
      });
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/payload too large/i);
    } finally {
      await srv.close();
    }
  });

  it("passes through a GET with no Content-Length", async () => {
    const srv = await listen(1);
    try {
      const res = await fetch(`${srv.url}/probe`);
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});
