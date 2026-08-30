import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: { contextualTutorEnabled: true },
}));

vi.mock("../../db/systemConfig.js", () => ({
  getSystemConfig: vi.fn(),
}));

const { getSystemConfig } = await import("../../db/systemConfig.js");
const { isContextualTutorEnabled } = await import("./contextualTutor.js");

describe("isContextualTutorEnabled", () => {
  beforeEach(() => {
    vi.mocked(getSystemConfig).mockReset();
  });

  it("uses the database override when present", async () => {
    vi.mocked(getSystemConfig).mockResolvedValue({
      key: "contextual_tutor_enabled",
      value: false,
      setAt: new Date().toISOString(),
      setBy: null,
      reason: "test override",
    });

    await expect(isContextualTutorEnabled()).resolves.toBe(false);
  });

  it("fails closed when the optional control-plane read fails", async () => {
    vi.mocked(getSystemConfig).mockRejectedValue(new Error("database unavailable"));

    await expect(isContextualTutorEnabled()).resolves.toBe(false);
  });
});
