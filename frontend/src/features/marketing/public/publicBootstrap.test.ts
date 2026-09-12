import { describe, expect, it } from "vitest";
import {
  shouldDeferAuthHydration,
  shouldUsePublicApp,
} from "./publicBootstrap";

describe("public route bootstrap", () => {
  it.each([
    "/",
    "/why-not-chatgpt",
    "/privacy",
    "/terms",
    "/support",
    "/login",
    "/signup",
    "/reset-password",
    "/auth/callback",
    "/s/qd99cvtcbwdn",
    "/try/lesson/python-fundamentals/hello-world",
  ])("uses the lightweight public route tree for direct entry %s", (path) => {
    expect(shouldUsePublicApp(path)).toBe(true);
  });

  it.each([
    "/editor",
    "/start",
    "/learn/course/python-fundamentals",
    "/admin/project",
    "/this-route-does-not-exist",
  ])("keeps the full route tree for %s", (path) => {
    expect(shouldUsePublicApp(path)).toBe(false);
  });

  it("defers auth only on acquisition and trust entries", () => {
    for (const path of [
      "/",
      "/why-not-chatgpt",
      "/privacy",
      "/terms",
      "/support",
    ]) {
      expect(shouldDeferAuthHydration(path), path).toBe(true);
    }

    for (const path of [
      "/login",
      "/signup",
      "/reset-password",
      "/auth/callback",
      "/s/qd99cvtcbwdn",
      "/try/lesson/python-fundamentals/hello-world",
    ]) {
      expect(shouldDeferAuthHydration(path), path).toBe(false);
    }
  });
});
