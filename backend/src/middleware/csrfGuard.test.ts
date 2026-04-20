import { describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { csrfGuard } from "./csrfGuard.js";

// Phase 17 / H-A3: every mutating route must reject requests that did not
// set `X-Requested-With: codetutor`, plus anything with a foreign `Origin`.
// GETs are allowed through untouched.

async function listen(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json());
  app.use(csrfGuard);
  app.all("/probe", (_req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const srv: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((r) => {
            srv.close(() => r());
          }),
      });
    });
  });
}

describe("csrfGuard", () => {
  it("lets GET requests through with no header", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`);
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it("rejects POST requests missing the X-Requested-With header", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, { method: "POST" });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/csrf/i);
    } finally {
      await srv.close();
    }
  });

  it("rejects POST requests with the wrong X-Requested-With value", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, {
        method: "POST",
        headers: { "X-Requested-With": "not-codetutor" },
      });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  });

  it("accepts POST requests with the correct CSRF header and no Origin", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, {
        method: "POST",
        headers: { "X-Requested-With": "codetutor" },
      });
      expect(res.status).toBe(200);
    } finally {
      await srv.close();
    }
  });

  it("rejects POST requests with a foreign Origin header", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, {
        method: "POST",
        headers: {
          "X-Requested-With": "codetutor",
          Origin: "http://attacker.example.com",
        },
      });
      expect(res.status).toBe(403);
    } finally {
      await srv.close();
    }
  });

  it("lets OPTIONS through without the CSRF header (preflight bypass)", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/probe`, { method: "OPTIONS" });
      // Express default OPTIONS handler responds 200 if there's a matching
      // route — we only care that the guard didn't 403 us.
      expect(res.status).not.toBe(403);
    } finally {
      await srv.close();
    }
  });
});
