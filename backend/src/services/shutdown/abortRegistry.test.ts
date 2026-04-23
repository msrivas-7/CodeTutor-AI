import { afterEach, describe, expect, it } from "vitest";
import {
  _resetAbortRegistryForTest,
  abortAllInFlight,
  inFlightCount,
  registerAbortController,
  unregisterAbortController,
} from "./abortRegistry.js";

afterEach(() => {
  _resetAbortRegistryForTest();
});

describe("abortRegistry", () => {
  it("registers and counts controllers", () => {
    expect(inFlightCount()).toBe(0);
    const a = new AbortController();
    const b = new AbortController();
    registerAbortController(a);
    registerAbortController(b);
    expect(inFlightCount()).toBe(2);
  });

  it("unregister removes exactly the entry", () => {
    const a = new AbortController();
    const b = new AbortController();
    registerAbortController(a);
    registerAbortController(b);
    unregisterAbortController(a);
    expect(inFlightCount()).toBe(1);
  });

  it("abortAllInFlight fires abort on every registered controller", () => {
    const a = new AbortController();
    const b = new AbortController();
    registerAbortController(a);
    registerAbortController(b);
    const n = abortAllInFlight("test-shutdown");
    expect(n).toBe(2);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });

  it("abort reason propagates so handlers can distinguish shutdown from client-close", () => {
    const c = new AbortController();
    registerAbortController(c);
    abortAllInFlight("shutdown:SIGTERM");
    const reason = c.signal.reason;
    expect(reason).toBeInstanceOf(Error);
    expect((reason as Error).message).toBe("shutdown:SIGTERM");
  });

  it("skips controllers that are already aborted so an SSE handler that aborted itself doesn't get a new reason", () => {
    const c = new AbortController();
    c.abort(new Error("client-close"));
    registerAbortController(c);
    abortAllInFlight("shutdown:SIGTERM");
    expect((c.signal.reason as Error).message).toBe("client-close");
  });

  it("is safe to call when nothing is registered", () => {
    expect(abortAllInFlight("noop")).toBe(0);
  });

  it("a throwing abort() on one controller doesn't stop fanout to the rest", () => {
    const throwing = new AbortController();
    // Force abort() to throw — production code shouldn't hit this, but the
    // registry guards against it so one bad entry can't block shutdown.
    throwing.abort = () => {
      throw new Error("boom");
    };
    const clean = new AbortController();
    registerAbortController(throwing);
    registerAbortController(clean);
    abortAllInFlight("shutdown:test");
    expect(clean.signal.aborted).toBe(true);
  });
});
