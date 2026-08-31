import { describe, expect, it } from "vitest";
import {
  contextualOfferInvalidationForError,
  historyForTutor,
  tutorRequestModel,
} from "./useTutorAsk";

describe("contextualOfferInvalidationForError", () => {
  it("classifies both anonymous and signed-in pre-admission quota refusals", () => {
    expect(contextualOfferInvalidationForError(
      '{"error":"ANON_EXHAUSTED"}',
      "anon",
    )).toBe("quota");
    expect(contextualOfferInvalidationForError(
      'Request failed (429): {"error":"FREE_TIER_EXHAUSTED"}',
      "authed",
    )).toBe("quota");
    expect(contextualOfferInvalidationForError(
      'Request failed (503): {"error":"PLATFORM_AI_PAUSED","reason":"global_daily_usd_hit"}',
      "authed",
    )).toBe("quota");
    expect(contextualOfferInvalidationForError(
      'Request failed (503): {"error":"PLATFORM_AI_PAUSED","reason":"anon_daily_usd_hit"}',
      "anon",
    )).toBe("quota");
  });

  it("does not confuse unrelated or cross-mode quota errors with an invalidation", () => {
    expect(contextualOfferInvalidationForError("HTTP 429", "authed")).toBeNull();
    expect(contextualOfferInvalidationForError("ANON_EXHAUSTED", "authed")).toBeNull();
    expect(contextualOfferInvalidationForError("FREE_TIER_EXHAUSTED", "anon")).toBeNull();
  });

  it("preserves authored guidance when lesson authority refuses admission", () => {
    expect(contextualOfferInvalidationForError(
      'Request failed (404): {"error":"LESSON_CONTEXT_NOT_FOUND"}',
      "authed",
    )).toBe("availability");
    expect(contextualOfferInvalidationForError(
      'Request failed (503): {"error":"LESSON_CONTEXT_UNAVAILABLE"}',
      "anon",
    )).toBe("availability");
  });
});

describe("tutorRequestModel", () => {
  it("ignores stale selected models for platform and anonymous funding", () => {
    expect(tutorRequestModel({
      selectedModel: "gpt-4.1-nano",
      onPlatform: true,
      isAnon: false,
    })).toBeNull();
    expect(tutorRequestModel({
      selectedModel: "gpt-4.1-mini",
      onPlatform: false,
      isAnon: true,
    })).toBeNull();
  });

  it("does not invent a BYOK model when the saved choice is incompatible", () => {
    expect(tutorRequestModel({
      selectedModel: "gpt-4.1",
      onPlatform: false,
      isAnon: false,
    })).toBeNull();
    expect(tutorRequestModel({
      selectedModel: "gpt-5-pro",
      onPlatform: false,
      isAnon: false,
    })).toBeNull();
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
