import crypto from "node:crypto";
import { config } from "../../config.js";

// P-12 / M-3: userId is a raw UUID; printing it to stdout makes every log
// line a join key back to the user row. HMAC it with a per-deploy salt
// derived from the BYOK master key so log lines still correlate inside one
// running process (operator can follow a single user's request trail) but
// the value is useless outside our deploy. Salt rotates whenever the BYOK
// master key rotates — matches the existing rotation cadence, no new env
// var. Truncated to 12 hex chars — enough to distinguish ~280M distinct
// users at <1% collision, short enough not to clutter log lines.

let saltBuf: Buffer | null = null;

function getSalt(): Buffer {
  if (saltBuf) return saltBuf;
  const master = config.byokEncryptionKey;
  if (!master) {
    // assertConfigValid() enforces BYOK_ENCRYPTION_KEY at boot in prod, so
    // this branch only runs in unit tests that don't go through that
    // bootstrap. Use a per-process random so test output is still scrubbed.
    saltBuf = crypto.randomBytes(32);
    return saltBuf;
  }
  saltBuf = crypto
    .createHmac("sha256", Buffer.from(master, "base64"))
    .update("codetutor-log-userid-v1")
    .digest();
  return saltBuf;
}

export function hashUserId(userId: string | null | undefined): string {
  if (!userId) return "anon";
  return crypto
    .createHmac("sha256", getSalt())
    .update(userId)
    .digest("hex")
    .slice(0, 12);
}

export function _resetLogHashForTest(): void {
  saltBuf = null;
}
