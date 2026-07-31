import { describe, expect, it } from "vitest";
import {
  PLATFORM_CHECKIN_TUTOR_MODEL,
  PLATFORM_DEFAULT_TUTOR_MODEL,
  routeTutorModel,
} from "./modelRouting.js";

const files = [{ path: "main.py", content: "value = 1\n" }];

describe("routeTutorModel", () => {
  it("routes a progressed platform check-in to the independently promoted model", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "approach",
    })).toEqual({ intent: "checkin", model: PLATFORM_CHECKIN_TUTOR_MODEL });
  });

  it("retains Nano for walkthroughs", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Walk me through this code",
      files,
      tutorStage: "approach",
    })).toEqual({ intent: "walkthrough", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("returns progressed check-ins to Nano when the B3 rollback switch is engaged", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "approach",
      checkinMiniDisabled: true,
    })).toEqual({ intent: "checkin", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("retains Nano on the first turn even when the wording resembles a check-in", () => {
    expect(routeTutorModel({
      requestedModel: PLATFORM_DEFAULT_TUTOR_MODEL,
      fundingSource: "platform",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "clarify",
    })).toEqual({ intent: "socratic", model: PLATFORM_DEFAULT_TUTOR_MODEL });
  });

  it("never overrides a BYOK model", () => {
    expect(routeTutorModel({
      requestedModel: "gpt-4.1",
      fundingSource: "byok",
      question: "Is my loop approach okay?",
      files,
      tutorStage: "approach",
    })).toEqual({ intent: "checkin", model: "gpt-4.1" });
  });
});
