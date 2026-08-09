import { describe, expect, it, vi } from "vitest";
import {
  isTransientEvalTransportAbort,
  withOneTransientEvalRetry,
} from "./evalTransportRetry.js";

describe("withOneTransientEvalRetry", () => {
  it("retries one provider abort and reports both attempts", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("This operation was aborted"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();

    await expect(withOneTransientEvalRetry(operation, onRetry)).resolves.toEqual({
      value: "ok",
      attempts: 2,
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry content, assertion, or arbitrary provider failures", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("model returned invalid tutor JSON"));

    await expect(withOneTransientEvalRetry(operation)).rejects.toThrow(
      "model returned invalid tutor JSON",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry a second abort", async () => {
    const operation = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(withOneTransientEvalRetry(operation)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("recognizes only abort-shaped transport errors", () => {
    expect(isTransientEvalTransportAbort(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isTransientEvalTransportAbort(new Error("request aborted by upstream"))).toBe(true);
    expect(isTransientEvalTransportAbort(new Error("HTTP 500"))).toBe(false);
  });
});
