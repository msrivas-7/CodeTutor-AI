import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { requestId } from "./requestId.js";
import { requestLogger } from "./requestLogger.js";

// Phase 20-P1: ensure every request gets a single JSON-lines log entry on
// finish, with the correlation id + userId + status + ms, and that the hot
// poll paths (`/api/session/ping`, `/api/health`, `/api/health/deep`) are
// silent so they don't drown the log.

type LogEntry = {
  level: "info" | "warn" | "error";
  t: string;
  id?: string;
  userId?: string;
  method: string;
  path: string;
  status: number;
  ms: number;
};

async function listen(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(requestId);
  // Fake authMiddleware — attach a userId to exercise the log field.
  app.use((req, _res, next) => {
    req.userId = "u-test";
    next();
  });
  app.use(requestLogger);
  app.get("/api/session/ping", (_req, res) => res.json({ ok: true }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/health/deep", (_req, res) => res.json({ ok: true }));
  app.get("/api/thing", (_req, res) => res.json({ ok: true }));
  app.get("/api/bad", (_req, res) => res.status(500).json({ error: "x" }));
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

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      const str =
        typeof chunk === "string"
          ? chunk
          : (chunk as Buffer).toString("utf8");
      lines.push(str);
      return true;
    });
  return { lines, restore: () => spy.mockRestore() };
}

function parseEntries(lines: string[]): LogEntry[] {
  return lines
    .flatMap((l) => l.split("\n"))
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogEntry);
}

describe("requestLogger middleware", () => {
  let cap: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    cap = captureStdout();
  });
  afterEach(() => {
    cap.restore();
  });

  it("logs a JSON line with id/userId/method/path/status/ms on finish", async () => {
    const srv = await listen();
    try {
      const res = await fetch(`${srv.url}/api/thing`);
      expect(res.status).toBe(200);
      // Give the finish hook a tick to run and flush.
      await new Promise((r) => setTimeout(r, 20));
      const entries = parseEntries(cap.lines);
      const mine = entries.find((e) => e.path === "/api/thing");
      expect(mine).toBeDefined();
      expect(mine!.level).toBe("info");
      expect(mine!.method).toBe("GET");
      expect(mine!.status).toBe(200);
      // P-12: userId is HMAC-hashed before log write. The raw value MUST
      // NOT appear in the log line; a 12-char hex digest takes its place.
      expect(mine!.userId).not.toBe("u-test");
      expect(mine!.userId).toMatch(/^[0-9a-f]{12}$/);
      expect(mine!.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(mine!.ms).toBeGreaterThanOrEqual(0);
    } finally {
      await srv.close();
    }
  });

  it("tags the line level=error when status >= 500", async () => {
    const srv = await listen();
    try {
      await fetch(`${srv.url}/api/bad`);
      await new Promise((r) => setTimeout(r, 20));
      const entries = parseEntries(cap.lines);
      const mine = entries.find((e) => e.path === "/api/bad");
      expect(mine?.level).toBe("error");
    } finally {
      await srv.close();
    }
  });

  it("stays silent on /api/session/ping", async () => {
    const srv = await listen();
    try {
      await fetch(`${srv.url}/api/session/ping`);
      await new Promise((r) => setTimeout(r, 20));
      const entries = parseEntries(cap.lines);
      expect(entries.find((e) => e.path === "/api/session/ping")).toBeUndefined();
    } finally {
      await srv.close();
    }
  });

  it("stays silent on /api/health and /api/health/deep", async () => {
    const srv = await listen();
    try {
      await fetch(`${srv.url}/api/health`);
      await fetch(`${srv.url}/api/health/deep`);
      await new Promise((r) => setTimeout(r, 20));
      const entries = parseEntries(cap.lines);
      expect(entries.find((e) => e.path === "/api/health")).toBeUndefined();
      expect(entries.find((e) => e.path === "/api/health/deep")).toBeUndefined();
    } finally {
      await srv.close();
    }
  });
});
