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
});
