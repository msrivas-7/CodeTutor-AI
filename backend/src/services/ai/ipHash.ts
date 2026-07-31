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

// Phase A — A2 (device contract): static label for hashing emails on
// the magic-link handoff path. NEVER share a label with the IP path —
// distinct labels prevent `H(ip) == H(email)` collisions across columns
// even if both are stored in the same DB. Emails are normalized
// (trim + lowercase) before hashing so "Maya@x.com" and " maya@x.com "
// share a row for the per-email-per-24h cap.
const EMAIL_HASH_LABEL = "codetutor-anon-laptop-invite-email-v1";

/**
 * Returns a stable hex digest derived from a learner-supplied email.
 * Suitable for storage in `anon_laptop_invites.email_hash`. The raw
 * email NEVER lands on disk; the hash is the index for the per-email
 * rate cap (1 send / 24h) and is the only enumerable token an attacker
 * who steals a DB dump would have. Trim + lowercase before hashing so
 * casing variants don't bypass the cap.
 */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(`${EMAIL_HASH_LABEL}:${normalized}`).digest("hex");
}

// Release B4: a public share token may be carried through the acquisition
// URL, but persisting it beside a pseudonymous IP hash would create a more
// linkable dataset than channel reporting needs. Store a domain-separated
// digest instead. The token is already server-validated before this function
// is called; this is an identifier transform, not an authenticity check.
const SHARE_REF_HASH_LABEL = "codetutor-distribution-share-ref-v1";

export function hashShareRef(shareRef: string): string {
  return createHash("sha256")
    .update(`${SHARE_REF_HASH_LABEL}:${shareRef}`)
    .digest("hex");
}
