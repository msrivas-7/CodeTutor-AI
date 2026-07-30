import { describe, expect, it } from "vitest";
import {
  DISMISS_KEY_PREFIX,
  PHONE_MAX_PX,
  TABLET_MAX_PX,
  dismissKey,
  readSize,
  shouldSuppressForPath,
} from "./NarrowViewportGate";

// QA-M5: dismissal used to live in sessionStorage under a single key, so every
// new tab re-showed the banner, and dismissing at tablet width silenced the
// (very different) phone copy. The new keying is per-screen-class + durable.
// The tests below pin the key format and the classification thresholds — if
// either drifts, users will either re-see dismissed banners or have a dismiss
// carry across screen classes it wasn't meant for.

describe("dismissKey", () => {
  it("prefixes every screen-class with the shared namespace", () => {
    expect(dismissKey("phone").startsWith(DISMISS_KEY_PREFIX)).toBe(true);
    expect(dismissKey("tablet").startsWith(DISMISS_KEY_PREFIX)).toBe(true);
    expect(dismissKey("wide").startsWith(DISMISS_KEY_PREFIX)).toBe(true);
  });

  it("yields a distinct key for each screen-class (no cross-talk)", () => {
    const keys = new Set([dismissKey("phone"), dismissKey("tablet"), dismissKey("wide")]);
    expect(keys.size).toBe(3);
  });

  it("is stable across calls — the key IS the persisted value, not a hash", () => {
    expect(dismissKey("phone")).toBe(dismissKey("phone"));
  });
});

describe("readSize thresholds", () => {
  it("classifies ≤ PHONE_MAX_PX as 'phone'", () => {
    expect(readSize(320)).toBe("phone");
    expect(readSize(PHONE_MAX_PX)).toBe("phone");
  });

  it("classifies (PHONE_MAX_PX, TABLET_MAX_PX] as 'tablet'", () => {
    expect(readSize(PHONE_MAX_PX + 1)).toBe("tablet");
    expect(readSize(768)).toBe("tablet");
    expect(readSize(TABLET_MAX_PX)).toBe("tablet");
  });

  it("classifies > TABLET_MAX_PX as 'wide'", () => {
    expect(readSize(TABLET_MAX_PX + 1)).toBe("wide");
    expect(readSize(1440)).toBe("wide");
    expect(readSize(4000)).toBe("wide");
  });

  it("PHONE_MAX_PX and TABLET_MAX_PX align with the documented break points", () => {
    // If product shifts the tablet/phone split, update the copy in
    // NarrowViewportGate.tsx at the same time. The banner's "phone" body
    // explicitly calls out "on a phone" — don't flip the threshold without
    // also editing the string.
    expect(PHONE_MAX_PX).toBe(639);
    expect(TABLET_MAX_PX).toBe(1023);
  });
});

describe("shouldSuppressForPath (Phase A — A2 device contract)", () => {
  // The anon trial surface (/try/*) must never display the
  // "you'll have a better time on a laptop" banner — phone is
  // the discovery surface and the warm graduation handoff is the
  // intended "open this on a laptop" beat.
  it("suppresses on /try/lesson/...", () => {
    expect(shouldSuppressForPath("/try/lesson/python-fundamentals/hello-world")).toBe(true);
  });

  it("suppresses on the bare /try root", () => {
    expect(shouldSuppressForPath("/try")).toBe(true);
    expect(shouldSuppressForPath("/try/")).toBe(true);
  });

  it("does NOT suppress on /learn/* (authed laptop-learning surface)", () => {
    expect(shouldSuppressForPath("/learn")).toBe(false);
    expect(shouldSuppressForPath("/learn/course/python-fundamentals/lesson/hello-world")).toBe(false);
  });

  it("does NOT suppress on the marketing root, signup, or editor page", () => {
    expect(shouldSuppressForPath("/")).toBe(false);
    expect(shouldSuppressForPath("/signup")).toBe(false);
    expect(shouldSuppressForPath("/editor")).toBe(false);
  });

  it("does NOT match a path that merely contains /try/ in the middle (substring guard)", () => {
    // Defensive: a future route that happens to have "/try/" deeper
    // in its path shouldn't accidentally inherit the suppression.
    expect(shouldSuppressForPath("/admin/try/something")).toBe(false);
  });
});
