import { describe, expect, it } from "vitest";
import {
  canonicalTutorRequestModel,
  PLATFORM_DEFAULT_TUTOR_MODEL,
  routeTutorModel,
} from "./modelRouting.js";
import { isContextualTutorModel } from "./modelRegistry.js";

const files = [{ path: "main.py", content: "value = 1\n" }];

describe("routeTutorModel", () => {
  it("canonicalizes stale platform requests while preserving compatible BYOK choices", () => {
    expect(canonicalTutorRequestModel({
      requestedModel: "gpt-4.1-nano",
      fundingSource: "platform",
    })).toBe(PLATFORM_DEFAULT_TUTOR_MODEL);
    expect(canonicalTutorRequestModel({
      requestedModel: "gpt-5.1",
      fundingSource: "byok",
    })).toBe("gpt-5.1");
  });

  it("routes every platform teaching intent to the independently promoted Luna model", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "approach",
    })).toEqual({ intent: "checkin", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("uses Luna for explicit walkthroughs, including the first turn", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Walk me through this code",
      files,
      tutorStage: "clarify",
    })).toEqual({ intent: "walkthrough", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("uses Luna on the first turn even when the wording resembles a check-in", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "clarify",
    })).toEqual({ intent: "socratic", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("uses the evaluated Luna model with a BYOK credential", () => {
    expect(routeTutorModel({
      requestedModel: "gpt-4.1",
      fundingSource: "byok",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "approach",
    })).toEqual({ intent: "checkin", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("keeps the contextual quality floor on GPT-5 Luna for managed and BYOK tutoring", () => {
    expect(isContextualTutorModel("gpt-4.1-nano")).toBe(false);
    expect(isContextualTutorModel("gpt-5.6-luna")).toBe(true);
    expect(isContextualTutorModel("gpt-4.1-mini")).toBe(false);
    expect(isContextualTutorModel("gpt-5.1")).toBe(true);
    expect(isContextualTutorModel("gpt-5-pro")).toBe(false);
  });
});
