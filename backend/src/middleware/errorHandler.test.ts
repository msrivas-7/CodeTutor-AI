// Defense-in-depth on the 500 path: unknown errors flow through scrubSecrets
// before landing in stdout. If we ever regress the regexes (e.g. tightening
// a boundary that stops matching real-world keys), these tests make the
// regression loud.

import express from "express";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { errorHandler, HttpError } from "./errorHandler.js";
import { requestId } from "./requestId.js";

let srv: Server;
let base: string;
const thrown: unknown[] = [];

beforeAll(async () => {
  const app = express();
  app.use(requestId);
  app.get("/throw", (_req, _res, next) => {
    next(thrown.shift());
  });
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    srv = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = srv.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  vi.restoreAllMocks();
  thrown.length = 0;
});

function captureConsoleError(): () => string[] {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    lines.push(line);
  });
  return () => lines;
}

describe("errorHandler secret scrubbing", () => {
  it("redacts OpenAI sk- keys in the stack log", async () => {
    thrown.push(new Error("upstream 401: sk-abcd1234EFGH56789xyzpossiblymore"));
    const read = captureConsoleError();
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(500);
    const logs = read();
    const joined = logs.join("\n");
    expect(joined).toContain("sk-<redacted>");
    expect(joined).not.toContain("sk-abcd1234EFGH56789xyz");
  });

  it("redacts Supabase / Anthropic-style JWTs", async () => {
    // Synthetic JWT shape: three base64url segments separated by dots.
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEyMyIsImV4cCI6OTk5OTk5OTk5OX0.abcdefghij";
    thrown.push(new Error(`failed to verify: ${jwt}`));
    const read = captureConsoleError();
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(500);
    const joined = read().join("\n");
    expect(joined).toContain("<jwt-redacted>");
    expect(joined).not.toContain(jwt);
  });

  it("redacts postgres:// connection URLs", async () => {
    thrown.push(
      new Error(
        "connect error to postgresql://user:verysecretpass@db.example.com:6543/postgres?sslmode=require",
      ),
    );
    const read = captureConsoleError();
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(500);
    const joined = read().join("\n");
    expect(joined).toContain("postgres://<redacted>");
    expect(joined).not.toContain("verysecretpass");
  });

  it("does not touch innocuous payloads", async () => {
    thrown.push(new Error("harmless failure — not a secret"));
    const read = captureConsoleError();
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(500);
    const joined = read().join("\n");
    expect(joined).toContain("harmless failure");
  });
});

describe("HttpError optional headers", () => {
  it("applies headers (e.g. Retry-After) to the outgoing response", async () => {
    // P-M3 (bucket 4a): session cap rejection throws HttpError(429, ..., {
    // 'Retry-After': '2' }). The frontend uses that header to schedule the
    // next retry without hammering the cap-check path.
    thrown.push(new HttpError(429, "slow down", { "Retry-After": "2" }));
    captureConsoleError();
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toEqual({ error: "slow down" });
  });

  it("omits headers for HttpErrors constructed without them (unchanged legacy behavior)", async () => {
    thrown.push(new HttpError(404, "not found"));
    captureConsoleError();
    const res = await fetch(`${base}/throw`);
    expect(res.status).toBe(404);
    expect(res.headers.get("retry-after")).toBeNull();
  });
});
