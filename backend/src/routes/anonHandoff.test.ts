import express from "express";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/lessonProgress.js", () => ({
  listLessonProgress: vi.fn(async () => [{ lessonId: "hello-world", status: "completed" }]),
  upsertLessonProgress: vi.fn(),
}));
vi.mock("../db/courseProgress.js", () => ({ upsertCourseProgress: vi.fn() }));
vi.mock("../db/preferences.js", () => ({ upsertPreferences: vi.fn() }));
vi.mock("../db/aiEvalSamples.js", () => ({ linkEvalSamplesToUser: vi.fn(async () => 1) }));

const { createAnonHandoffRouter } = await import("./anonHandoff.js");
const { linkEvalSamplesToUser } = await import("../db/aiEvalSamples.js");
const { upsertLessonProgress } = await import("../db/lessonProgress.js");

let server: Server;
let baseUrl: string;

const validBody = (overrides: Record<string, unknown> = {}) => ({
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  code: 'print("Hello")',
  name: "Maya",
  flags: { welcomeDone: true, workspaceCoachDone: true },
  ...overrides,
});

async function post(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/anon-handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = "11111111-1111-4111-8111-111111111111";
    next();
  });
  app.use("/api/anon-handoff", createAnonHandoffRouter());
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
});

beforeEach(() => {
  vi.mocked(linkEvalSamplesToUser).mockReset();
  vi.mocked(linkEvalSamplesToUser).mockResolvedValue(1);
  vi.mocked(upsertLessonProgress).mockClear();
});

describe("B8 anonymous sample ownership handoff", () => {
  const token = "a".repeat(43);

  it("links retained samples even when lesson handoff is already complete", async () => {
    const response = await post(validBody({ evalSamplingSubjectToken: token }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, applied: false });
    expect(vi.mocked(linkEvalSamplesToUser)).toHaveBeenCalledWith(
      token,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(vi.mocked(upsertLessonProgress)).not.toHaveBeenCalled();
  });

  it("rejects malformed deletion capabilities before database work", async () => {
    const response = await post(validBody({ evalSamplingSubjectToken: "short" }));
    expect(response.status).toBe(400);
    expect(vi.mocked(linkEvalSamplesToUser)).not.toHaveBeenCalled();
  });

  it("returns a controlled 500 so the caller can retry when linking fails", async () => {
    vi.mocked(linkEvalSamplesToUser).mockRejectedValueOnce(new Error("db unavailable"));
    const response = await post(validBody({ evalSamplingSubjectToken: token }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    expect(vi.mocked(upsertLessonProgress)).not.toHaveBeenCalled();
  });
});
