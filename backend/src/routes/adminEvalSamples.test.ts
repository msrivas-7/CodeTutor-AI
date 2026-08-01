import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/aiEvalSamples.js", () => ({
  listAdminEvalSamples: vi.fn(async () => ({ samples: [], nextCursor: null })),
  upsertEvalSampleReview: vi.fn(async () => true),
  listEvalSynthesisQueue: vi.fn(async () => []),
  resolveEvalSynthesisQueue: vi.fn(async () => true),
}));
vi.mock("../db/adminAuditLog.js", () => ({ logAdminAction: vi.fn(async () => undefined) }));

const { adminEvalSamplesRouter } = await import("./adminEvalSamples.js");
const {
  listAdminEvalSamples,
  upsertEvalSampleReview,
  listEvalSynthesisQueue,
  resolveEvalSynthesisQueue,
} = await import("../db/aiEvalSamples.js");
const { logAdminAction } = await import("../db/adminAuditLog.js");

let server: Server;
let baseUrl = "";
const actorId = "00000000-0000-4000-8000-000000000001";
const sampleId = "00000000-0000-4000-8000-000000000002";
const queueId = "00000000-0000-4000-8000-000000000003";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = actorId;
    next();
  });
  app.use("/api/admin", adminEvalSamplesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => vi.clearAllMocks());

describe("B8 admin eval review routes", () => {
  it("audits every redacted sample read", async () => {
    const response = await fetch(`${baseUrl}/api/admin/eval-samples?limit=20&disposition=pending_review`);
    expect(response.status).toBe(200);
    expect(vi.mocked(listAdminEvalSamples)).toHaveBeenCalledWith({
      limit: 20,
      cursor: undefined,
      disposition: "pending_review",
      reviewerId: actorId,
    });
    expect(vi.mocked(logAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        eventType: "eval_sample_viewed",
        targetKey: "sample-list",
      }),
    );
  });

  it("records a bounded independent review and audits the verdict", async () => {
    const response = await fetch(`${baseUrl}/api/admin/eval-samples/${sampleId}/review`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        verdict: "fail",
        issueCodes: ["factual_error"],
        note: "Incorrect explanation",
      }),
    });
    expect(response.status).toBe(200);
    expect(vi.mocked(upsertEvalSampleReview)).toHaveBeenCalledWith({
      sampleId,
      reviewerId: actorId,
      verdict: "fail",
      issueCodes: ["factual_error"],
      note: "Incorrect explanation",
    });
    expect(vi.mocked(logAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "eval_sample_reviewed", targetKey: sampleId }),
    );
  });

  it("rejects unknown issue codes before any review write", async () => {
    const response = await fetch(`${baseUrl}/api/admin/eval-samples/${sampleId}/review`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "fail", issueCodes: ["copy_raw_sample"] }),
    });
    expect(response.status).toBe(400);
    expect(vi.mocked(upsertEvalSampleReview)).not.toHaveBeenCalled();
    expect(vi.mocked(logAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "rejected_attempt" }),
    );
  });

  it("requires structured reasons for every non-passing review", async () => {
    for (const body of [
      { verdict: "fail", issueCodes: [] },
      { verdict: "reject_privacy", issueCodes: ["factual_error"] },
    ]) {
      const response = await fetch(`${baseUrl}/api/admin/eval-samples/${sampleId}/review`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(vi.mocked(upsertEvalSampleReview)).not.toHaveBeenCalled();
  });

  it("requires a synthetic case id before resolving a queue item as authored", async () => {
    const invalid = await fetch(`${baseUrl}/api/admin/eval-synthesis-queue/${queueId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "synthetic_case_authored", reason: "case added" }),
    });
    expect(invalid.status).toBe(400);
    expect(vi.mocked(resolveEvalSynthesisQueue)).not.toHaveBeenCalled();

    const valid = await fetch(`${baseUrl}/api/admin/eval-synthesis-queue/${queueId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: "synthetic_case_authored",
        syntheticCaseId: "b8_debug_pattern_01",
        reason: "synthetic regression committed",
      }),
    });
    expect(valid.status).toBe(200);
    expect(vi.mocked(resolveEvalSynthesisQueue)).toHaveBeenCalledWith({
      queueId,
      state: "synthetic_case_authored",
      syntheticCaseId: "b8_debug_pattern_01",
    });
    expect(vi.mocked(logAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "eval_sample_queue_resolved",
        targetKey: queueId,
      }),
    );
  });

  it("audits synthesis queue reads", async () => {
    const response = await fetch(`${baseUrl}/api/admin/eval-synthesis-queue?limit=10`);
    expect(response.status).toBe(200);
    expect(vi.mocked(listEvalSynthesisQueue)).toHaveBeenCalledWith(10);
    expect(vi.mocked(logAdminAction)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "eval_sample_viewed", targetKey: "synthesis-queue" }),
    );
  });
});
