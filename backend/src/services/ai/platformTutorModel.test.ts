import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/systemConfig.js", () => ({
  getSystemConfig: vi.fn(),
}));

const { getSystemConfig } = await import("../../db/systemConfig.js");
const {
  getEffectivePlatformTutorModel,
  isSelectablePlatformTutorModel,
} = await import("./platformTutorModel.js");

const row = (value: string) => ({
  key: "platform_tutor_model" as const,
  value,
  setBy: "admin-1",
  setAt: "2026-08-09T12:00:00.000Z",
  reason: "quality comparison",
});

beforeEach(() => {
  vi.mocked(getSystemConfig).mockReset();
});

describe("getEffectivePlatformTutorModel", () => {
  it("uses Luna when no operator override exists", async () => {
    vi.mocked(getSystemConfig).mockResolvedValueOnce(null);

    await expect(getEffectivePlatformTutorModel()).resolves.toEqual({
      model: "gpt-5.6-luna",
      source: "fallback",
      setBy: null,
      setAt: null,
      reason: null,
      invalidOverride: null,
    });
  });

  it("uses a compatible and priced GPT-5+ override", async () => {
    vi.mocked(getSystemConfig).mockResolvedValueOnce(row("gpt-5.6-terra"));

    await expect(getEffectivePlatformTutorModel()).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      source: "override",
      setBy: "admin-1",
      reason: "quality comparison",
      invalidOverride: null,
    });
  });

  it.each([
    "gpt-4.1-nano",
    "gpt-5-pro",
    "gpt-5-audio",
    "gpt-5.99",
  ])("fails safe to Luna for invalid override %s", async (model) => {
    vi.mocked(getSystemConfig).mockResolvedValueOnce(row(model));

    await expect(getEffectivePlatformTutorModel()).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      source: "fallback",
      invalidOverride: model,
    });
  });

  it("fails safe to Luna when configuration storage is unavailable", async () => {
    vi.mocked(getSystemConfig).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getEffectivePlatformTutorModel()).resolves.toMatchObject({
      model: "gpt-5.6-luna",
      source: "fallback",
    });
  });

  it("lets the admin read path surface configuration storage failures", async () => {
    vi.mocked(getSystemConfig).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getEffectivePlatformTutorModel({
      bypassCache: true,
      throwOnDatabaseError: true,
    })).rejects.toThrow("database unavailable");
    expect(getSystemConfig).toHaveBeenCalledWith("platform_tutor_model", {
      bypassCache: true,
    });
  });
});

describe("isSelectablePlatformTutorModel", () => {
  it("requires request compatibility and registered platform pricing", () => {
    expect(isSelectablePlatformTutorModel("gpt-5.6-luna")).toBe(true);
    expect(isSelectablePlatformTutorModel("gpt-5.6-sol")).toBe(true);
    expect(isSelectablePlatformTutorModel("gpt-5-pro")).toBe(false);
    expect(isSelectablePlatformTutorModel("gpt-5.99")).toBe(false);
  });
});
