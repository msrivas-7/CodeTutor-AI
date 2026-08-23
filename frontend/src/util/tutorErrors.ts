export interface ParsedTutorError {
  code: string | null;
  reason: string | null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Decode a machine-readable Tutor failure without exposing its transport body. */
export function parseTutorError(raw: string): ParsedTutorError {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const nested = record.error && typeof record.error === "object"
        ? record.error as Record<string, unknown>
        : null;
      return {
        code: stringField(record.error) ?? stringField(nested?.code),
        reason: stringField(record.reason) ?? stringField(nested?.reason),
      };
    }
  } catch {
    // Plain-text provider and network errors remain valid input below.
  }

  return {
    code: trimmed.match(/\bPLATFORM_AI_PAUSED\b/i)?.[0] ?? null,
    reason: trimmed.match(
      /\b(?:daily_usd_per_user_hit|lifetime_usd_per_user_hit|usd_cap_hit|free_disabled|provider_auth_failed)\b/i,
    )?.[0] ?? null,
  };
}

export function isPlatformTutorPaused(raw: string): boolean {
  return parseTutorError(raw).code?.toUpperCase() === "PLATFORM_AI_PAUSED";
}
