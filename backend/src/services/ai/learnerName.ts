import type { JWTPayload } from "jose";

const SAFE_FIRST_NAME = /^\p{L}[\p{L}\p{M}'’-]{0,39}$/u;

/**
 * Read a learner-facing first name from Supabase user metadata.
 *
 * user_metadata is user-editable, so this value is presentation data only:
 * it must never affect authorization, quota, ownership, or routing. We accept
 * a single conservative Unicode name token and drop everything else before it
 * can enter the system prompt. Email addresses are intentionally never used as
 * a fallback.
 */
export function learnerFirstNameFromClaims(
  claims: JWTPayload | null | undefined,
): string | null {
  const metadata = claims?.user_metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const values = metadata as Record<string, unknown>;
  const candidate = [
    values.first_name,
    values.given_name,
    values.full_name,
    values.name,
  ].find((value): value is string => typeof value === "string" && !!value.trim());
  if (!candidate) return null;
  const firstToken = candidate.trim().split(/\s+/u)[0] ?? "";
  return SAFE_FIRST_NAME.test(firstToken) ? firstToken : null;
}
