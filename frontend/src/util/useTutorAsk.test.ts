import { describe, expect, it } from "vitest";
import {
  historyForTutor,
  PLATFORM_TUTOR_MODEL,
  tutorRequestModel,
} from "./useTutorAsk";

describe("tutorRequestModel", () => {
  it("ignores stale selected models for platform and anonymous funding", () => {
    expect(tutorRequestModel({
      selectedModel: "gpt-4.1-nano",
      onPlatform: true,
      isAnon: false,
    })).toBe(PLATFORM_TUTOR_MODEL);
    expect(tutorRequestModel({
      selectedModel: "gpt-4.1-mini",
      onPlatform: false,
      isAnon: true,
    })).toBe(PLATFORM_TUTOR_MODEL);
  });

  it("canonicalizes a stale BYOK preference to the GPT-5 Tutor floor", () => {
    expect(tutorRequestModel({
      selectedModel: "gpt-4.1",
      onPlatform: false,
      isAnon: false,
    })).toBe(PLATFORM_TUTOR_MODEL);
  });

  it("preserves a GPT-5-or-later BYOK model selected from the supported list", () => {
    expect(tutorRequestModel({
      selectedModel: "gpt-5.6-luna",
      onPlatform: false,
      isAnon: false,
    })).toBe("gpt-5.6-luna");
  });
});

describe("historyForTutor", () => {
  it("removes scripted narration and strips browser-only metadata", () => {
    expect(historyForTutor([
      {
        id: "scripted",
        role: "assistant",
        content: "Welcome narration",
        meta: { scripted: true },
        sections: { summary: "Welcome narration" },
      },
      { id: "user", role: "user", content: "I expected hello" },
      {
        id: "assistant",
        role: "assistant",
        content: "What happened instead?",
        sections: { intent: "socratic" },
      },
    ])).toEqual([
      { role: "user", content: "I expected hello" },
      { role: "assistant", content: "What happened instead?" },
    ]);
  });
});
