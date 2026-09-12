export type AuthProvisioningRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  onRetry?: (event: {
    operation: string;
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    status: number | undefined;
  }) => void;
};

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2_000;

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

type RetryableAuthProvisioningError = {
  name: "AuthRetryableFetchError";
  status?: unknown;
};

export function isRetryableAuthProvisioningError(
  error: unknown,
): error is RetryableAuthProvisioningError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AuthRetryableFetchError"
  );
}

/**
 * Absorb only Supabase Auth failures that the SDK explicitly classifies as
 * retryable. Playwright retries remain a signal for product/test flakes; this
 * narrow boundary prevents a transient provisioning request from rerunning an
 * otherwise-complete browser journey.
 */
export async function withAuthProvisioningRetry<T>(
  operation: string,
  run: () => Promise<T>,
  options: AuthProvisioningRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const wait = options.sleep ?? sleep;
  const random = options.random ?? Math.random;
  const onRetry =
    options.onRetry ??
    ((event) => {
      console.warn(
        `[auth fixture] ${event.operation} received a retryable Auth response` +
          ` (status=${event.status ?? "network"}); retrying ${event.attempt + 1}/${event.maxAttempts}` +
          ` after ${event.delayMs}ms`,
      );
    });

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Auth provisioning maxAttempts must be a positive integer");
  }
  if (baseDelayMs < 0 || maxDelayMs < baseDelayMs) {
    throw new Error("Auth provisioning retry delays are invalid");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableAuthProvisioningError(error) || attempt === maxAttempts) {
        throw error;
      }

      const ceiling = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attempt - 1),
      );
      // Equal jitter prevents all hosted workers from retrying in lockstep
      // while retaining a meaningful lower bound between attempts.
      const delayMs = Math.round(ceiling / 2 + random() * (ceiling / 2));
      const status =
        "status" in error && typeof error.status === "number"
          ? error.status
          : undefined;
      onRetry({ operation, attempt, maxAttempts, delayMs, status });
      await wait(delayMs);
    }
  }

  throw new Error("Auth provisioning retry loop exited unexpectedly");
}
