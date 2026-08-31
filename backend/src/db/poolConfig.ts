const DEFAULT_DATABASE_POOL_MAX = 25;

/**
 * Resolve the per-process postgres.js connection ceiling.
 *
 * Production keeps the calibrated 25-connection default. Parallel E2E jobs
 * deliberately lower it so many isolated backend stacks cannot collectively
 * exceed the shared Supabase transaction-pooler client limit.
 */
export function resolveDatabasePoolMax(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DATABASE_POOL_MAX;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > DEFAULT_DATABASE_POOL_MAX) {
    throw new Error(
      `DATABASE_POOL_MAX must be an integer from 1 to ${DEFAULT_DATABASE_POOL_MAX}`,
    );
  }
  return value;
}

