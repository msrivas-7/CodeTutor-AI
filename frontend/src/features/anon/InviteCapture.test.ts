// Phase A — A2 (device contract): unit-level checks for the invite
// token validator. The component itself is a side-effecty hook with a
// React-router dependency — too heavy for a unit test without a
// testing library that this codebase doesn't use. The TOKEN_RE shape
// invariant is the load-bearing piece (must match the backend
// validator at `anonLaptopInvite.ts` AND the DB CHECK constraint);
// pinning it here catches drift between client and server.

import { describe, expect, it } from "vitest";
import { TOKEN_RE } from "./InviteCapture";

describe("invite-token shape (mirrors backend anon_laptop_invites_token_shape CHECK)", () => {
  it("accepts a 12-char Crockford-style token", () => {
    expect(TOKEN_RE.test("abcdefghijkm")).toBe(true);
    expect(TOKEN_RE.test("23456789abcd")).toBe(true);
    expect(TOKEN_RE.test("npqrstuvwxyz")).toBe(true);
  });

  it("rejects digits that the regex character class excludes (0 and 1)", () => {
    // The regex is `^[a-z2-9]{12}$` — 0 and 1 are deliberately omitted
    // (look-alike with o and l). a–z is permissive: l and o ARE
    // accepted by the validator even though the generator avoids them
    // (Crockford-style preference, not a regex constraint). So a
    // pasted token containing l or o still matches; only 0/1 fail.
    expect(TOKEN_RE.test("0bcdefghijkm")).toBe(false);
    expect(TOKEN_RE.test("1bcdefghijkm")).toBe(false);
    expect(TOKEN_RE.test("lbcdefghijkm")).toBe(true); // legal under regex
    expect(TOKEN_RE.test("obcdefghijkm")).toBe(true); // legal under regex
  });

  it("rejects uppercase (DB CHECK is case-sensitive — token should always be lowercase)", () => {
    expect(TOKEN_RE.test("Abcdefghijkm")).toBe(false);
    expect(TOKEN_RE.test("ABCDEFGHIJKM")).toBe(false);
  });

  it("rejects wrong-length tokens", () => {
    expect(TOKEN_RE.test("abc")).toBe(false);
    expect(TOKEN_RE.test("abcdefghijk")).toBe(false); // 11
    expect(TOKEN_RE.test("abcdefghijkmn")).toBe(false); // 13
    expect(TOKEN_RE.test("")).toBe(false);
  });

  it("rejects punctuation that could sneak through a URL pasted with stray chars", () => {
    expect(TOKEN_RE.test("abcdefghijk-")).toBe(false);
    expect(TOKEN_RE.test("abcdefghijk.")).toBe(false);
    expect(TOKEN_RE.test("abcdefghij k")).toBe(false);
    expect(TOKEN_RE.test("abcdefghijkm ")).toBe(false);
  });
});
