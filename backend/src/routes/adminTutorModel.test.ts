import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.PLATFORM_OPENAI_API_KEY = "sk-platform-admin-test";

vi.mock("../db/systemConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/systemConfig.js")>();
  return {
    ...actual,
    getSystemConfig: vi.fn(),
    setSystemConfig: vi.fn(),
    clearSystemConfig: vi.fn(),
  };
});

vi.mock("../db/adminAuditLog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/adminAuditLog.js")>();
  return { ...actual, logAdminAction: vi.fn() };
});

vi.mock("../services/ai/openaiProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai/openaiProvider.js")>();
  return {
    ...actual,
    listPlatformTutorModelCandidates: vi.fn(async () => [
      {
        id: "gpt-5.6-luna",
        label: "gpt-5.6-luna (recommended)",
        qualityStatus: "evaluated" as const,
        contextualTutorEligible: true,
        qualityLabel: "Evaluated for CodeTutor",
        evalSetVersion: "2.8.0+evaluator.2.14.0",
        registryVersion: "test",
      },
      {
        id: "gpt-5.6-terra",
        label: "gpt-5.6-terra",
        qualityStatus: "unevaluated" as const,
        contextualTutorEligible: true,
        qualityLabel: "Not evaluated for teaching quality",
        evalSetVersion: null,
        registryVersion: "test",
      },
    ]),
  };
});

vi.mock("../services/ai/platformTutorModel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai/platformTutorModel.js")>();
  return {
    ...actual,
    getEffectivePlatformTutorModel: vi.fn(),
  };
});

const { adminRouter } = await import("./admin.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const {
  getSystemConfig,
  setSystemConfig,
  clearSystemConfig,
} = await import("../db/systemConfig.js");
const { logAdminAction } = await import("../db/adminAuditLog.js");
const { getEffectivePlatformTutorModel } = await import(
  "../services/ai/platformTutorModel.js"
);
const { listPlatformTutorModelCandidates } = await import(
  "../services/ai/openaiProvider.js"
);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = "00000000-0000-4000-8000-000000000111";
    next();
  });
  app.use("/api/admin", adminRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(getSystemConfig).mockReset();
  vi.mocked(getSystemConfig).mockResolvedValue(null);
  vi.mocked(setSystemConfig).mockReset();
  vi.mocked(clearSystemConfig).mockReset();
  vi.mocked(logAdminAction).mockReset();
  vi.mocked(getEffectivePlatformTutorModel).mockReset();
  vi.mocked(getEffectivePlatformTutorModel).mockResolvedValue({
    model: "gpt-5.6-terra",
    source: "override",
    setBy: "00000000-0000-4000-8000-000000000111",
    setAt: "2026-08-10T02:00:00.000Z",
    reason: "quality comparison",
    invalidOverride: null,
  });
});

async function put(confirmCostImpact?: true) {
  return fetch(`${baseUrl}/api/admin/tutor-model`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      reason: "quality comparison",
      expectedSetAt: null,
      ...(confirmCostImpact ? { confirmCostImpact } : {}),
    }),
  });
}

describe("platform Tutor model admin contract", () => {
  it("returns one safe current candidate when live discovery is unavailable", async () => {
    vi.mocked(listPlatformTutorModelCandidates).mockRejectedValueOnce(
      new Error("upstream discovery unavailable"),
    );
    vi.mocked(getEffectivePlatformTutorModel).mockResolvedValueOnce({
      model: "gpt-5.6-luna",
      source: "fallback",
      setBy: null,
      setAt: null,
      reason: null,
      invalidOverride: null,
    });

    const response = await fetch(`${baseUrl}/api/admin/tutor-model`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      discoveryError: string | null;
      candidates: Array<{
        id: string;
        selectable: boolean;
        priceUsdPerMillion: { input: number; output: number } | null;
        unavailableReason: string | null;
      }>;
    };

    expect(body.discoveryError).toBe(
      "Live OpenAI model discovery is temporarily unavailable.",
    );
    expect(body.candidates).toEqual([
      expect.objectContaining({
        id: "gpt-5.6-luna",
        selectable: false,
        priceUsdPerMillion: { input: 1, output: 6 },
        unavailableReason: "Availability could not be confirmed while discovery is offline.",
      }),
    ]);
  });

  it("rejects a more expensive model without explicit cost acknowledgement", async () => {
    const response = await put();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "TUTOR_MODEL_COST_CONFIRMATION_REQUIRED",
      costMultiplierVsRecommended: 2.5,
    });
    expect(setSystemConfig).not.toHaveBeenCalled();
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "rejected_attempt",
        targetKey: "platform_tutor_model",
      }),
    );
  });

  it("accepts, audits, and returns an acknowledged model override", async () => {
    const response = await put(true);

    expect(response.status).toBe(200);
    expect(setSystemConfig).toHaveBeenCalledWith({
      key: "platform_tutor_model",
      value: "gpt-5.6-terra",
      setBy: "00000000-0000-4000-8000-000000000111",
      reason: "quality comparison",
    });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "system_config_set",
        targetKey: "platform_tutor_model",
      }),
    );
    expect(await response.json()).toMatchObject({
      current: { model: "gpt-5.6-terra", source: "override" },
    });
  });

  it("rejects stale writes without changing configuration", async () => {
    vi.mocked(getSystemConfig).mockResolvedValueOnce({
      key: "platform_tutor_model",
      value: "gpt-5.6-luna",
      setBy: "admin-2",
      setAt: "2026-08-10T01:00:00.000Z",
      reason: "another admin",
    });

    const response = await put(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "TUTOR_MODEL_CONFIG_STALE" });
    expect(setSystemConfig).not.toHaveBeenCalled();
  });

  it("clears and audits the override as the rollback path", async () => {
    vi.mocked(getSystemConfig).mockResolvedValueOnce({
      key: "platform_tutor_model",
      value: "gpt-5.6-terra",
      setBy: "admin-1",
      setAt: "2026-08-10T02:00:00.000Z",
      reason: "quality comparison",
    });
    vi.mocked(getEffectivePlatformTutorModel).mockResolvedValueOnce({
      model: "gpt-5.6-luna",
      source: "fallback",
      setBy: null,
      setAt: null,
      reason: null,
      invalidOverride: null,
    });

    const response = await fetch(`${baseUrl}/api/admin/tutor-model`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "return to recommended",
        expectedSetAt: "2026-08-10T02:00:00.000Z",
      }),
    });

    expect(response.status).toBe(200);
    expect(clearSystemConfig).toHaveBeenCalledWith("platform_tutor_model");
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "system_config_cleared",
        targetKey: "platform_tutor_model",
      }),
    );
  });
});
