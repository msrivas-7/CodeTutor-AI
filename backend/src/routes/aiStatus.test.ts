import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../services/ai/credential.js", () => ({
  resolveAICredential: vi.fn(),
}));
vi.mock("../db/preferences.js", () => ({
  getAIStatusPrefs: vi.fn(async () => ({
    openaiKey: null,
    hasShownPaidInterest: false,
  })),
}));
vi.mock("../db/denylist.js", () => ({ isDenylisted: vi.fn() }));
vi.mock("../db/paidAccessInterest.js", () => ({
  deletePaidAccessInterest: vi.fn(),
  upsertPaidAccessInterest: vi.fn(),
}));
vi.mock("../services/metrics.js", () => ({
  aiExhaustionCtaClicks: { inc: vi.fn() },
}));
vi.mock("../services/ai/contextualTutor.js", () => ({
  isContextualTutorEnabled: vi.fn(async () => true),
}));
vi.mock("../services/ai/platformTutorModel.js", () => ({
  getEffectivePlatformTutorModel: vi.fn(),
}));

const { aiStatusRouter } = await import("./aiStatus.js");
const { resolveAICredential } = await import("../services/ai/credential.js");
const { getEffectivePlatformTutorModel } = await import(
  "../services/ai/platformTutorModel.js"
);
const { errorHandler } = await import("../middleware/errorHandler.js");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.userId = "learner-1";
    next();
  });
  app.use("/api/user", aiStatusRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(resolveAICredential).mockResolvedValue({
    source: "platform",
    key: "platform-key",
    remainingToday: 7,
    capToday: 8,
    allowedModels: ["gpt-5.6-luna"],
    resetAtUtc: new Date("2026-08-31T00:00:00.000Z"),
  });
  vi.mocked(getEffectivePlatformTutorModel).mockResolvedValue({
    model: "gpt-5.6-luna",
    source: "fallback",
    setBy: null,
    setAt: null,
    reason: null,
    invalidOverride: null,
  });
});

describe("GET /api/user/ai-status", () => {
  it("advertises contextual help when the effective platform model is evaluated", async () => {
    const response = await fetch(`${base}/api/user/ai-status`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "platform",
      contextualTutorEnabled: true,
      contextualTutorModelEligible: true,
    });
  });

  it("fails the offer closed for an unevaluated admin model override", async () => {
    vi.mocked(getEffectivePlatformTutorModel).mockResolvedValueOnce({
      model: "gpt-5.1",
      source: "override",
      setBy: "admin-1",
      setAt: "2026-08-30T20:00:00.000Z",
      reason: "test",
      invalidOverride: null,
    });

    const response = await fetch(`${base}/api/user/ai-status`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "platform",
      contextualTutorEnabled: true,
      contextualTutorModelEligible: false,
    });
  });
});
