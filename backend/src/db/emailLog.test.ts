import { describe, expect, it } from "vitest";
import { redactEmailCapabilities } from "./emailLog.js";

describe("redactEmailCapabilities", () => {
  it("removes signed unsubscribe capabilities from text and HTML-shaped bodies", () => {
    const body = [
      "Manage: https://codetutor.example/unsubscribe?token=secret-token&user=123",
      '<a href="https://codetutor.example/api/email/unsubscribe/secret-token">Stop</a>',
      "Relative: /api/email/unsubscribe?token=another-secret",
    ].join("\n");

    const redacted = redactEmailCapabilities(body);

    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("another-secret");
    expect(redacted.match(/\[unsubscribe link redacted\]/g)).toHaveLength(3);
    expect(redacted).toContain(">Stop</a>");
  });

  it("leaves ordinary email content unchanged", () => {
    const body = "Your streak is waiting. Open CodeTutor when you are ready.";
    expect(redactEmailCapabilities(body)).toBe(body);
  });
});
