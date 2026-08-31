import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AskErrorView, classifyAskError } from "./TutorResponseChrome";

describe("tutor recovery copy", () => {
  it("confirms that a stopped request is released from the allowance", () => {
    const result = classifyAskError("TUTOR_CANCELED_BY_USER");
    expect(result.title).toBe("Stopped by you");
    expect(result.hint).toMatch(/released from your daily allowance/i);
  });

  it("turns network failures into a specific, code-safe recovery state", () => {
    expect(classifyAskError("TypeError: Failed to fetch")).toEqual({
      kind: "network",
      title: "Connection lost",
      hint: "Your code is safe. Check your connection, then try the question again.",
    });
  });

  it("makes timeouts recoverable without blocking lesson progress", () => {
    const result = classifyAskError("upstream timed out");
    expect(result.title).toBe("Tutor took too long");
    expect(result.hint).toMatch(/code is safe/i);
    expect(result.hint).toMatch(/keep working without the tutor/i);
  });

  it("turns a platform spend pause into private, non-retryable recovery", () => {
    const raw = JSON.stringify({
      error: "PLATFORM_AI_PAUSED",
      reason: "daily_usd_per_user_hit",
    });

    expect(classifyAskError(raw)).toMatchObject({
      kind: "platformPaused",
      title: "Free tutor paused for today",
      retryable: false,
      showDetails: false,
    });

    const markup = renderToStaticMarkup(createElement(AskErrorView, {
      message: raw,
      onRetry: vi.fn(),
    }));
    expect(markup).not.toContain("PLATFORM_AI_PAUSED");
    expect(markup).not.toContain("daily_usd_per_user_hit");
    expect(markup).not.toContain("Try again");
    expect(markup).toMatch(/daily reset/i);
  });

  it("keeps stale contextual responses outside the transcript with exact recovery copy", () => {
    expect(classifyAskError("TUTOR_CONTEXT_CHANGED")).toEqual({
      kind: "contextChanged",
      title: "Code changed",
      hint: "Your code changed while I was thinking—ask again when ready.",
    });
  });

  it("explains a responsive Tutor remount as a retryable released turn", () => {
    expect(classifyAskError("TUTOR_PANEL_REMOUNTED")).toEqual({
      kind: "contextChanged",
      title: "Tutor view changed",
      hint: "The Tutor moved while I was thinking, so that turn was released from your daily allowance. Your error guide is still here; retry when you’re ready.",
    });
  });

  it("retires expired signed evidence and directs the learner to run again", () => {
    expect(classifyAskError("CONTEXTUAL_EVIDENCE_STALE")).toEqual({
      kind: "contextualEvidenceStale",
      title: "Run evidence expired",
      hint:
        "Make a change and run your code. If the same issue remains, adjust it and run once more for a fresh help offer.",
      retryable: false,
      showDetails: false,
    });
  });

  it("turns a signed-in allowance race into clear non-retryable recovery", () => {
    expect(classifyAskError('{"error":"FREE_TIER_EXHAUSTED"}')).toEqual({
      kind: "freeTierExhausted",
      title: "Free tutor questions used for today",
      hint: "Your code and current error guide are still here. Keep working now, or return after the daily reset.",
      retryable: false,
      showDetails: false,
    });
  });

  it("turns the contextual kill switch into a deterministic non-retryable recovery", () => {
    const result = classifyAskError('{"error":"CONTEXTUAL_TUTOR_DISABLED"}');
    expect(result).toMatchObject({
      kind: "contextualPaused",
      title: "Contextual help is paused",
      retryable: false,
      showDetails: false,
    });
    expect(result.hint).toMatch(/latest error is still in Output/i);
  });

  it("keeps admission storage failures private and non-retryable", () => {
    const raw = JSON.stringify({ error: "AI_ADMISSION_UNAVAILABLE" });
    expect(classifyAskError(raw)).toEqual({
      kind: "admissionUnavailable",
      title: "Tutor admission temporarily unavailable",
      hint: "Your current error guide is still here. Keep working and ask the Tutor again after the service recovers.",
      retryable: false,
      showDetails: false,
    });
    const markup = renderToStaticMarkup(createElement(AskErrorView, {
      message: raw,
      onRetry: vi.fn(),
    }));
    expect(markup).not.toContain("AI_ADMISSION_UNAVAILABLE");
    expect(markup).not.toContain("Try again");
  });

  it("turns runtime model ineligibility into a non-retryable guide recovery", () => {
    expect(classifyAskError("MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_OFFER")).toMatchObject({
      kind: "contextualModel",
      title: "This model is not ready for contextual help",
      retryable: false,
      showDetails: false,
    });
  });

  it("keeps lesson-authority refusals private and non-retryable", () => {
    for (const error of [
      "LESSON_CONTEXT_NOT_FOUND",
      "LESSON_CONTEXT_UNAVAILABLE",
    ]) {
      const raw = JSON.stringify({ error });
      expect(classifyAskError(raw)).toMatchObject({
        kind: "lessonContextUnavailable",
        retryable: false,
        showDetails: false,
      });
      const markup = renderToStaticMarkup(createElement(AskErrorView, {
        message: raw,
        onRetry: vi.fn(),
      }));
      expect(markup).not.toContain(error);
      expect(markup).not.toContain("Try again");
      expect(markup).toMatch(/current error guide is still here/i);
    }
  });
});
