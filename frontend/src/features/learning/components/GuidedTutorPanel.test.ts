import { describe, expect, it } from "vitest";
import {
  canSubmitGuidedTutorTurn,
  currentContextualOfferForRetry,
  isContextualOfferModelReady,
  resolveTutorSource,
  resolveTutorPersona,
} from "./GuidedTutorPanel";
import type { ContextualTutorOfferRequest } from "../../../types";

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

describe("currentContextualOfferForRetry", () => {
  const offer: ContextualTutorOfferRequest = {
    contextVersion: 0,
    contextEpoch: "lesson:python-fundamentals/hello-world",
    projectRevision: 7,
    evidenceToken: "signed-evidence-token",
    moveId: "python-unclosed-parenthesis",
    evidence: { code: "python-unclosed-parenthesis", path: "main.py", line: 2 },
    scaffoldLevel: 1,
  };

  it("retains the accepted offer only while its source revision is current", () => {
    expect(currentContextualOfferForRetry(offer, 7)).toBe(offer);
    expect(currentContextualOfferForRetry(offer, 8)).toBeNull();
    expect(currentContextualOfferForRetry(null, 7)).toBeNull();
  });
});

describe("isContextualOfferModelReady", () => {
  const model = {
    id: "gpt-5.6-luna",
    label: "Luna",
    qualityStatus: "evaluated" as const,
    contextualTutorEligible: true,
    contextualOfferEligible: true,
    qualityLabel: "Evaluated for CodeTutor",
    evalSetVersion: "test",
    registryVersion: "test",
  };

  it("offers proactive help only for independently evaluated BYOK models", () => {
    expect(isContextualOfferModelReady("byok", model.id, [model])).toBe(true);
    expect(isContextualOfferModelReady("byok", "gpt-5.1", [
      { ...model, id: "gpt-5.1", contextualOfferEligible: false },
    ])).toBe(false);
    expect(isContextualOfferModelReady("platform", null, [])).toBe(true);
  });
});

describe("resolveTutorSource", () => {
  it("keeps the public lesson platform-funded despite persisted BYOK state", () => {
    expect(resolveTutorSource("anon", true, undefined)).toBe("platform");
    expect(resolveTutorSource("anon", false, undefined)).toBe("platform");
  });

  it("preserves authenticated BYOK and platform funding", () => {
    expect(resolveTutorSource("authed", true, "platform")).toBe("byok");
    expect(resolveTutorSource("authed", false, "platform")).toBe("platform");
    expect(resolveTutorSource("authed", false, undefined)).toBe("none");
  });
});
