import { describe, expect, it } from "vitest";
import {
  canSubmitGuidedTutorTurn,
  resolveTutorPersona,
} from "./GuidedTutorPanel";

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

describe("canSubmitGuidedTutorTurn", () => {
  it("keeps quick actions and queued asks locked until the workspace is ready", () => {
    expect(canSubmitGuidedTutorTurn({
      configured: true,
      asking: false,
      inputLocked: true,
      exhausted: false,
    })).toBe(false);
    expect(canSubmitGuidedTutorTurn({
      configured: true,
      asking: false,
      inputLocked: false,
      exhausted: false,
    })).toBe(true);
  });

  it("also rejects unconfigured, active, and exhausted states", () => {
    const ready = { configured: true, asking: false, inputLocked: false, exhausted: false };
    expect(canSubmitGuidedTutorTurn({ ...ready, configured: false })).toBe(false);
    expect(canSubmitGuidedTutorTurn({ ...ready, asking: true })).toBe(false);
    expect(canSubmitGuidedTutorTurn({ ...ready, exhausted: true })).toBe(false);
  });
});
