import { beforeEach, describe, expect, it, vi } from "vitest";

// P-H4: client-accumulated lesson-time heartbeat. The module-level state
// makes the buffer a singleton; each spec resets it via the test-only
// hook so specs don't bleed into each other.

const sendLessonHeartbeat = vi.fn().mockResolvedValue({ written: 0 });

vi.mock("../../../api/client", async () => {
  const actual =
    await vi.importActual<typeof import("../../../api/client")>(
      "../../../api/client",
    );
  return {
    ...actual,
    API_BASE: "",
    api: { ...actual.api, sendLessonHeartbeat },
  };
});

vi.mock("../../../auth/authStore", () => ({
  useAuthStore: {
    getState: () => ({ session: { access_token: "t" } }),
  },
}));

const buf = await import("./lessonHeartbeatBuffer");

beforeEach(() => {
  buf.__resetLessonHeartbeatForTests();
  sendLessonHeartbeat.mockClear();
  sendLessonHeartbeat.mockResolvedValue({ written: 0 });
});

describe("lessonHeartbeatBuffer", () => {
  it("flush with an empty buffer is a no-op", async () => {
    await buf.flushLessonHeartbeat();
    expect(sendLessonHeartbeat).not.toHaveBeenCalled();
  });

  it("folds repeat bumps for the same lesson into one additive delta", async () => {
    buf.bufferLessonTime("py", "loops", 5_000);
    buf.bufferLessonTime("py", "loops", 7_000);
    buf.bufferLessonTime("py", "functions", 3_000);
    await buf.flushLessonHeartbeat();
    expect(sendLessonHeartbeat).toHaveBeenCalledTimes(1);
    const [items] = sendLessonHeartbeat.mock.calls[0];
    // Order isn't guaranteed by the Map iteration contract across engines
    // strictly, but it is in V8 (insertion order). Assert the shape by
    // re-keying to avoid coupling to that.
    const byLesson = Object.fromEntries(
      (items as Array<{ lessonId: string; deltaMs: number }>).map((i) => [
        i.lessonId,
        i.deltaMs,
      ]),
    );
    expect(byLesson.loops).toBe(12_000);
    expect(byLesson.functions).toBe(3_000);
  });

  it("ignores non-positive deltas", async () => {
    buf.bufferLessonTime("py", "loops", 0);
    buf.bufferLessonTime("py", "loops", -500);
    await buf.flushLessonHeartbeat();
    expect(sendLessonHeartbeat).not.toHaveBeenCalled();
  });

  it("drains the buffer after a successful flush so a second flush is a no-op", async () => {
    buf.bufferLessonTime("py", "loops", 2_000);
    await buf.flushLessonHeartbeat();
    await buf.flushLessonHeartbeat();
    expect(sendLessonHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("re-queues items when the API call rejects so no tick is lost", async () => {
    sendLessonHeartbeat.mockRejectedValueOnce(new Error("boom"));
    buf.bufferLessonTime("py", "loops", 2_000);
    await buf.flushLessonHeartbeat();
    expect(sendLessonHeartbeat).toHaveBeenCalledTimes(1);

    sendLessonHeartbeat.mockResolvedValueOnce({ written: 1 });
    await buf.flushLessonHeartbeat();
    expect(sendLessonHeartbeat).toHaveBeenCalledTimes(2);
    const [retriedItems] = sendLessonHeartbeat.mock.calls[1];
    expect(retriedItems).toEqual([
      { courseId: "py", lessonId: "loops", deltaMs: 2_000 },
    ]);
  });
});
