import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { shouldExplainSessionEnd } from "./authStore";

describe("session end classification", () => {
  const establishedUser = { id: "learner-1" } as User;

  it("explains an unexpected end only for an established signed-in learner", () => {
    expect(shouldExplainSessionEnd(establishedUser, false)).toBe(true);
    expect(shouldExplainSessionEnd(establishedUser, true)).toBe(false);
    expect(shouldExplainSessionEnd(null, false)).toBe(false);
  });
});
