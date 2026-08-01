import { describe, expect, it } from "vitest";
import { resolveCheckinMiniDisabled } from "./config.js";

describe("resolveCheckinMiniDisabled", () => {
  it("fails safe to Nano when production has no explicit activation", () => {
    expect(resolveCheckinMiniDisabled({ NODE_ENV: "production" })).toBe(true);
    expect(resolveCheckinMiniDisabled({
      NODE_ENV: "production",
      PLATFORM_CHECKIN_MINI_DISABLED: "",
    })).toBe(true);
  });

  it("activates the evaluated Mini candidate only for an explicit zero", () => {
    expect(resolveCheckinMiniDisabled({
      NODE_ENV: "production",
      PLATFORM_CHECKIN_MINI_DISABLED: "0",
    })).toBe(false);
  });

  it("keeps the independent production rollback engaged for one or invalid values", () => {
    expect(resolveCheckinMiniDisabled({
      NODE_ENV: "production",
      PLATFORM_CHECKIN_MINI_DISABLED: "1",
    })).toBe(true);
    expect(resolveCheckinMiniDisabled({
      NODE_ENV: "production",
      PLATFORM_CHECKIN_MINI_DISABLED: "true",
    })).toBe(true);
  });

  it("keeps the candidate available by default outside production", () => {
    expect(resolveCheckinMiniDisabled({ NODE_ENV: "test" })).toBe(false);
  });
});
