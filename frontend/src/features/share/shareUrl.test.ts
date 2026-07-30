import { describe, expect, it } from "vitest";
import { publicSharePath, publicShareUrl } from "./shareUrl";

describe("publicShareUrl", () => {
  it("uses the direct SPA route in Vite development", () => {
    expect(publicSharePath("abc-123")).toBe("/s/abc-123");
    expect(publicShareUrl("abc-123", "http://localhost:5173/path")).toBe(
      "http://localhost:5173/s/abc-123",
    );
  });

  it("encodes an unexpected token defensively", () => {
    expect(publicSharePath("abc/123")).toBe("/s/abc%2F123");
  });
});
