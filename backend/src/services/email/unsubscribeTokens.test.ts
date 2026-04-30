import { describe, expect, it, beforeEach, vi } from "vitest";

// Phase 22D: HMAC token contract tests.
//
// We mock the config so each test can swap the secret in/out. The
// timing-safe equality is exercised implicitly by the verify path —
// asserting "tampered token returns null" covers the constant-time
// branch (a vulnerable strcmp would leak via timing, not via the
// pass/fail boolean we're checking).

vi.mock("../../config.js", () => ({
  config: {
    email: {
      unsubscribeSecret: "",
      unsubscribeSecretPrevious: "",
    },
  },
}));

import { config } from "../../config.js";
import {
  UnsubscribeSecretMissingError,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./unsubscribeTokens.js";

beforeEach(() => {
  // @ts-expect-error mutate the mocked config
  config.email.unsubscribeSecret = "";
  // @ts-expect-error mutate the mocked config
  config.email.unsubscribeSecretPrevious = "";
});

const TEST_USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET_A = "test-secret-a-do-not-use-in-prod";
const SECRET_B = "test-secret-b-do-not-use-in-prod";

describe("signUnsubscribeToken", () => {
  it("throws UnsubscribeSecretMissingError when secret is empty", () => {
    expect(() => signUnsubscribeToken(TEST_USER_ID)).toThrowError(
      UnsubscribeSecretMissingError,
    );
  });

  it("throws TypeError on empty userId", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    expect(() => signUnsubscribeToken("")).toThrowError(TypeError);
  });

  it("returns a 2-segment token with `.` separator", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const token = signUnsubscribeToken(TEST_USER_ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.split(".").length).toBe(2);
  });

  it("is deterministic for the same userId + secret", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const a = signUnsubscribeToken(TEST_USER_ID);
    const b = signUnsubscribeToken(TEST_USER_ID);
    expect(a).toBe(b);
  });

  it("changes when the secret changes (rotation invalidates old tokens)", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const a = signUnsubscribeToken(TEST_USER_ID);
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    const b = signUnsubscribeToken(TEST_USER_ID);
    expect(a).not.toBe(b);
  });
});

describe("verifyUnsubscribeToken — happy path", () => {
  it("roundtrips: sign then verify returns the original userId", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const token = signUnsubscribeToken(TEST_USER_ID);
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: TEST_USER_ID });
  });

  it("works for non-uuid userId values (defense-in-depth)", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const id = "user_with_underscores_and-dashes-AND.dots";
    const token = signUnsubscribeToken(id);
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: id });
  });
});

describe("verifyUnsubscribeToken — rejection paths (all return null)", () => {
  beforeEach(() => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
  });

  it("rejects empty / non-string input", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
    // @ts-expect-error wrong type intentionally
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
    // @ts-expect-error wrong type intentionally
    expect(verifyUnsubscribeToken(null)).toBeNull();
  });

  it("rejects malformed envelopes", () => {
    expect(verifyUnsubscribeToken("nodot")).toBeNull();
    expect(verifyUnsubscribeToken("too.many.dots")).toBeNull();
    expect(verifyUnsubscribeToken(".")).toBeNull();
    expect(verifyUnsubscribeToken(".justasig")).toBeNull();
    expect(verifyUnsubscribeToken("justpayload.")).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signUnsubscribeToken(TEST_USER_ID);
    const [, sig] = token.split(".");
    // Re-encode a different userId with the original signature.
    const tamperedPayload = Buffer.from("attacker", "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(verifyUnsubscribeToken(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUnsubscribeToken(TEST_USER_ID);
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("returns null when the secret has been wiped (no plaintext-empty oracle)", () => {
    const token = signUnsubscribeToken(TEST_USER_ID);
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = "";
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("rejects a signature of the wrong length", () => {
    const payloadB64 = Buffer.from(TEST_USER_ID, "utf8")
      .toString("base64")
      .replace(/=+$/, "");
    expect(verifyUnsubscribeToken(`${payloadB64}.AAA`)).toBeNull();
  });
});

// Phase 23 P1 #5: dual-secret rotation. Tokens minted under the old
// secret continue to verify against `unsubscribeSecretPrevious` for the
// rotation window; new tokens use the current secret. No format change
// — pure dual-key verify.
describe("verifyUnsubscribeToken — dual-secret rotation", () => {
  it("verifies a token signed with the previous secret when both are configured", () => {
    // 1. Mint while SECRET_A is current (the old key).
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const oldToken = signUnsubscribeToken(TEST_USER_ID);

    // 2. Operator rotates: SECRET_B is now current, SECRET_A becomes
    //    PREVIOUS for the soak window.
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    // @ts-expect-error mutate
    config.email.unsubscribeSecretPrevious = SECRET_A;

    // 3. The old token (signed with SECRET_A) MUST still verify.
    const verified = verifyUnsubscribeToken(oldToken);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(TEST_USER_ID);
  });

  it("verifies a token signed with the current secret regardless of whether previous is set", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    // @ts-expect-error mutate
    config.email.unsubscribeSecretPrevious = SECRET_A;

    // Tokens minted under the (current) SECRET_B must verify even when
    // PREVIOUS is set — fast path on the first compare.
    const newToken = signUnsubscribeToken(TEST_USER_ID);
    expect(verifyUnsubscribeToken(newToken)?.userId).toBe(TEST_USER_ID);
  });

  it("rejects a token signed with neither current nor previous", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    // @ts-expect-error mutate
    config.email.unsubscribeSecretPrevious = SECRET_A;

    // Mint with a third (rotated-out two cycles ago) secret — must fail.
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = "rotated-out-two-cycles-ago";
    const orphanToken = signUnsubscribeToken(TEST_USER_ID);

    // Restore the rotation window state (orphan-token's secret is now
    // neither current nor previous).
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    expect(verifyUnsubscribeToken(orphanToken)).toBeNull();
  });

  it("falls through to single-secret behavior when previous is empty", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    // unsubscribeSecretPrevious unset (default "")
    const token = signUnsubscribeToken(TEST_USER_ID);
    // Same secret → verifies.
    expect(verifyUnsubscribeToken(token)?.userId).toBe(TEST_USER_ID);

    // Rotate without setting PREVIOUS → old tokens stop working, as
    // they did before this dual-secret change. (Documents the
    // "operator forgot to set PREVIOUS" failure mode.)
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_B;
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("treats a whitespace-only previous secret as unset", () => {
    // @ts-expect-error mutate
    config.email.unsubscribeSecret = SECRET_A;
    const token = signUnsubscribeToken(TEST_USER_ID);

    // @ts-expect-error mutate — operator typo: spaces only
    config.email.unsubscribeSecret = SECRET_B;
    // @ts-expect-error mutate
    config.email.unsubscribeSecretPrevious = "    ";
    // No fallthrough to the whitespace string — treat as empty.
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });
});
