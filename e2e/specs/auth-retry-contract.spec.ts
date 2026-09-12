import { test, expect } from "@playwright/test";
import {
  isRetryableAuthProvisioningError,
  withAuthProvisioningRetry,
} from "../fixtures/authRetry";

test.describe("E2E auth provisioning retry contract", () => {
  test("retries the SDK's explicit retryable failure with bounded equal jitter", async () => {
    const delays: number[] = [];
    let attempts = 0;

    const value = await withAuthProvisioningRetry(
      "create user",
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw { name: "AuthRetryableFetchError", status: 503 };
        }
        return "ready";
      },
      {
        baseDelayMs: 200,
        random: () => 0,
        sleep: async (delayMs) => void delays.push(delayMs),
        onRetry: () => undefined,
      },
    );

    expect(value).toBe("ready");
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  test("does not retry ordinary auth or assertion failures", async () => {
    const failure = new Error("invalid fixture input");
    let attempts = 0;

    await expect(
      withAuthProvisioningRetry(
        "create user",
        async () => {
          attempts += 1;
          throw failure;
        },
        {
          sleep: async () => undefined,
          onRetry: () => undefined,
        },
      ),
    ).rejects.toBe(failure);

    expect(attempts).toBe(1);
    expect(isRetryableAuthProvisioningError(failure)).toBe(false);
  });

  test("preserves the final retryable failure after the fixed attempt bound", async () => {
    const failure = { name: "AuthRetryableFetchError", status: 0 };
    let attempts = 0;

    await expect(
      withAuthProvisioningRetry(
        "sign in",
        async () => {
          attempts += 1;
          throw failure;
        },
        {
          maxAttempts: 3,
          sleep: async () => undefined,
          onRetry: () => undefined,
        },
      ),
    ).rejects.toBe(failure);

    expect(attempts).toBe(3);
  });
});
