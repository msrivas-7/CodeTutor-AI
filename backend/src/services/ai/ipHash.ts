import { createHash } from "node:crypto";

// Phase 27 §3d: hash a client IP for storage in the anonymous AI usage
// ledger. The threat model is "DB dump leaks raw IP addresses" — not
// "an attacker reverses the hash via rainbow table." A static label
// is sufficient for that scope: it prevents the trivial "dump = list
// of IPs" outcome, and IP hashes remain stable across the cap window
// (a daily-rotating salt would defeat the per-IP daily cap by making
// every request look like a new IP after midnight UTC).
//
// Length: SHA-256 = 64 hex chars. The migration's CHECK
// (length BETWEEN 16 AND 128) accommodates this and leaves room for
// alternative algorithms without a schema migration.
//
// IPv6 normalization: caller is expected to pass req.ip as Express /
// trust-proxy gives it. We don't lowercase or canonicalize beyond the
// hash input — Express's req.ip is already normalized for the family.

const HASH_LABEL = "codetutor-anon-ai-v1";

/**
 * Returns a stable hex digest derived from the client IP. Suitable for
 * storage in `ai_anon_usage_ledger.ip_hash`. NEVER pass user-controlled
 * input (request body, headers other than the trusted IP) — this
 * function is an identifier transform for cap accounting, not a
 * security primitive against forged inputs.
 */
export function hashClientIp(ip: string): string {
  return createHash("sha256").update(`${HASH_LABEL}:${ip}`).digest("hex");
}
