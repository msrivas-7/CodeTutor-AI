import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";

// Phase 22D: HMAC-signed one-click unsubscribe tokens.
//
// Format: `<base64url(userId)>.<base64url(hmac-sha256(userId, secret))>`
//
// Properties:
//   - non-expiring on purpose. Mailchimp / Substack / SendGrid all do this:
//     a user clicking unsubscribe on a 6-month-old email expects it to
//     work.
//   - opaque to the recipient: the token doesn't expose the user UUID
//     in plain form (base64url-encoded) but is also NOT a security
//     boundary — the HMAC is what proves authenticity. URL-safe so it
//     never breaks in inbox-side link rewriters (Outlook Safe Links etc).
//   - idempotent action: GET /api/email/unsubscribe?token=… sets
//     email_opt_in = false. A fuzzed/replayed valid token does the same
//     thing as the original click; no harm.
//
// Why JWT was rejected: full JWT would carry exp + iat + iss claims, plus
// header negotiation, plus alg="none" downgrade risk. We only need
// authenticated identity → a 2-segment HMAC envelope is the minimum.
//
// Phase 23 P1 #5: graceful secret rotation. Verify tries the CURRENT
// secret first, then the PREVIOUS secret if configured. Mint always uses
// CURRENT. The operator's rotation runbook is documented inline in
// config.ts on `unsubscribeSecretPrevious`. Without rotation in flight,
// PREVIOUS is empty and behavior is identical to single-secret.

const SEPARATOR = ".";

export class UnsubscribeSecretMissingError extends Error {
  readonly name = "UnsubscribeSecretMissingError";
  constructor() {
    super(
      "EMAIL_UNSUBSCRIBE_SECRET is not configured; unsubscribe tokens cannot " +
        "be minted or verified",
    );
  }
}

function getSecret(): string {
  const s = config.email.unsubscribeSecret;
  if (!s || s.trim() === "") {
    throw new UnsubscribeSecretMissingError();
  }
  return s;
}

// Returns the previous-rotation secret if one is configured; null when
// no rotation is in flight (the common case). Verify-only — never used
// for minting.
function getPreviousSecret(): string | null {
  const s = config.email.unsubscribeSecretPrevious;
  if (!s || s.trim() === "") return null;
  return s;
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  // Reverse the URL-safe substitutions and re-pad before decoding.
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

function hmac(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

/**
 * Mint a one-click unsubscribe token for the user. Throws if the HMAC
 * secret is not configured (caller should swallow + log + fall back to
 * sending email without the unsubscribe link, OR refuse to send — depends
 * on caller's CAN-SPAM stance; the digest sweeper refuses).
 */
export function signUnsubscribeToken(userId: string): string {
  if (!userId || typeof userId !== "string") {
    throw new TypeError("signUnsubscribeToken: userId must be a non-empty string");
  }
  const secret = getSecret();
  const payload = b64url(userId);
  const signature = b64url(hmac(payload, secret));
  return `${payload}${SEPARATOR}${signature}`;
}

export interface VerifiedToken {
  userId: string;
}

/**
 * Verify a token and return the user id it was minted for. Returns null on
 * any verification failure — malformed, tampered, or signed by a secret
 * that's neither the current nor the previous rotation key. Caller should
 * treat null as "401" without leaking which check failed (timing-safe
 * equality is the only check that matters).
 *
 * Phase 23 P1 #5: tries CURRENT first, falls through to PREVIOUS if
 * configured. Order matters — the common case is CURRENT-signed tokens
 * (just-minted by the most recent sweep), so we hit the fast path on
 * the first compare.
 */
export function verifyUnsubscribeToken(token: string): VerifiedToken | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [payloadRaw, signatureRaw] = parts;
  if (!payloadRaw || !signatureRaw) return null;

  let currentSecret: string;
  try {
    currentSecret = getSecret();
  } catch {
    // Boot misconfig: never validate any token rather than 200-ing on
    // the basis of an empty-string secret comparison.
    return null;
  }

  let provided: Buffer;
  try {
    provided = b64urlDecode(signatureRaw);
  } catch {
    return null;
  }

  // Tries one secret; returns true on a constant-time match. Same-length
  // check is required before timingSafeEqual (which throws otherwise).
  const matches = (secret: string): boolean => {
    const expected = hmac(payloadRaw, secret);
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  };

  let signedBy: "current" | "previous" | null = null;
  if (matches(currentSecret)) {
    signedBy = "current";
  } else {
    const prev = getPreviousSecret();
    // CRITICAL: when PREVIOUS is set we MUST also evaluate the current
    // path even on miss — both compares must run unconditionally so an
    // attacker can't time-distinguish "current matched" vs "fell through
    // to previous". Both `matches()` calls above + below run for the
    // full HMAC + timingSafeEqual so total time is ~constant per token.
    if (prev !== null && matches(prev)) {
      signedBy = "previous";
    }
  }
  if (signedBy === null) return null;

  let userId: string;
  try {
    userId = b64urlDecode(payloadRaw).toString("utf8");
  } catch {
    return null;
  }
  if (!userId) return null;

  return { userId };
}
