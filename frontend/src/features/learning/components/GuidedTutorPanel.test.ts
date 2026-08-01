import { describe, expect, it } from "vitest";
import { resolveTutorPersona } from "./GuidedTutorPanel";

describe("resolveTutorPersona", () => {
  it.each(["beginner", "intermediate", "advanced"] as const)(
    "sends the persisted %s persona in authenticated lessons",
    (persona) => {
      expect(resolveTutorPersona("authed", persona)).toBe(persona);
    },
  );

  it("keeps the anonymous first lesson beginner-framed", () => {
    expect(resolveTutorPersona("anon", "advanced")).toBe("beginner");
  });
});
