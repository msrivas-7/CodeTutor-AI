import { describe, expect, it, vi } from "vitest";
import { createSequentialPollScheduler } from "./useLivePolling";

describe("createSequentialPollScheduler", () => {
  it("schedules one future poll when repeated visibility events collide with an in-flight request", async () => {
    let finishFirst: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const callbacks = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimer = vi.fn((callback: () => void) => {
      const timer = nextTimer++;
      callbacks.set(timer, callback);
      return timer;
    });
    const clearTimer = vi.fn((timer: number) => callbacks.delete(timer));
    const scheduler = createSequentialPollScheduler(run, 5_000, {
      isHidden: () => false,
      setTimer,
      clearTimer,
    });

    scheduler.start();
    scheduler.visibilityChanged();
    scheduler.visibilityChanged();
    scheduler.visibilityChanged();
    expect(run).toHaveBeenCalledTimes(1);
    expect(setTimer).not.toHaveBeenCalled();

    finishFirst?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);

    scheduler.stop();
    expect(clearTimer).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });
});
