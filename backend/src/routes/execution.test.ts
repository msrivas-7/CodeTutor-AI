import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ExecutionBackend } from "../services/execution/backends/index.js";
import type { RunResult } from "../services/execution/router.js";

process.env.BYOK_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");

vi.mock("../services/session/requireActiveSession.js", () => ({
  requireActiveSession: vi.fn(),
}));
vi.mock("../services/session/sessionManager.js", () => ({
  touchSession: vi.fn(),
}));
vi.mock("../services/execution/router.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../services/execution/router.js")
  >();
  return { ...actual, runProject: vi.fn() };
});
vi.mock("../services/metrics.js", () => ({
  execDuration: { observe: vi.fn() },
}));

const { createExecutionRouter } = await import("./execution.js");
const { requireActiveSession } = await import(
  "../services/session/requireActiveSession.js"
);
const { runProject } = await import("../services/execution/router.js");
const { verifyContextualEvidenceToken } = await import(
  "../services/ai/contextualEvidence.js"
);
const { errorHandler } = await import("../middleware/errorHandler.js");

const oldFiles = [{ path: "main.py", content: "print('old')\n" }];
const oldIdentity = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
  contextEpoch: "epoch-old",
  projectRevision: 2,
};
const newFiles = [{ path: "main.py", content: "print('new')\n" }];
const newIdentity = {
  ...oldIdentity,
  contextEpoch: "epoch-new",
  projectRevision: 3,
};
const result: RunResult = {
  stdout: "old\n",
  stderr: "",
  exitCode: 0,
  errorType: "none",
  durationMs: 5,
  stage: "run",
};

let server: Server;
let base: string;
let session: {
  handle: { sessionId: string; __kind: string };
  contextualSnapshot?: { files: typeof oldFiles; identity: typeof oldIdentity };
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = req.header("x-test-user") ?? undefined;
    next();
  });
  app.use("/api/execution", createExecutionRouter({} as ExecutionBackend));
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  session = {
    handle: { sessionId: "session-1", __kind: "fake" },
    contextualSnapshot: { files: oldFiles, identity: oldIdentity },
  };
  vi.mocked(requireActiveSession).mockReturnValue(session as never);
  vi.mocked(runProject).mockReset();
});

describe("POST /api/execution", () => {
  it("binds evidence to the snapshot captured when the run started", async () => {
    vi.mocked(runProject).mockImplementation(async () => {
      session.contextualSnapshot = { files: newFiles, identity: newIdentity };
      return result;
    });

    const response = await fetch(`${base}/api/execution`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "u-1" },
      body: JSON.stringify({
        sessionId: "session-1",
        language: "python",
      }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as RunResult & {
      contextualEvidenceToken: string;
    };

    expect(
      verifyContextualEvidenceToken(
        payload.contextualEvidenceToken,
        "user:u-1",
        oldIdentity,
        oldFiles,
        result,
      ),
    ).toBe(true);
    expect(
      verifyContextualEvidenceToken(
        payload.contextualEvidenceToken,
        "user:u-1",
        newIdentity,
        newFiles,
        result,
      ),
    ).toBe(false);
  });
});
