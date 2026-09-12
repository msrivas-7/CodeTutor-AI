import { describe, expect, it, vi } from "vitest";
import { installPreloadErrorRecovery } from "./preloadRecovery";

function setup(
  storage: Pick<Storage, "getItem" | "setItem"> = new MemoryStorage(),
  now: () => number = () => 1_000,
) {
  const target = new EventTarget();
  const reload = vi.fn();
  const host = Object.assign(target, {
    location: { href: "https://codetutor.example/try/lesson/python/intro", reload },
    sessionStorage: storage,
  }) as unknown as Window;
  const dispose = installPreloadErrorRecovery(host, now);
  return { target, reload, dispose };
}

function preloadError(message: string) {
  return Object.assign(new Event("vite:preloadError", { cancelable: true }), {
    payload: new TypeError(message),
  });
}

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("preload recovery", () => {
  it("reloads once when an obsolete lazy chunk cannot be fetched", () => {
    const { target, reload } = setup();
    const event = preloadError(
      "Failed to fetch dynamically imported module: /assets/lesson-old.js",
    );

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not loop when the same failed asset survives the reload", () => {
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.target.dispatchEvent(preloadError("missing:/assets/lesson-old.js"));
    first.dispose();

    const second = setup(storage);
    const repeated = preloadError("missing:/assets/lesson-old.js");
    second.target.dispatchEvent(repeated);

    expect(repeated.defaultPrevented).toBe(false);
    expect(second.reload).not.toHaveBeenCalled();
  });

  it("recovers a different missing chunk from a later deployment", () => {
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.target.dispatchEvent(preloadError("missing:/assets/lesson-old.js"));
    first.dispose();

    const second = setup(storage);
    second.target.dispatchEvent(preloadError("missing:/assets/share-new.js"));

    expect(second.reload).toHaveBeenCalledOnce();
  });

  it("allows the same recovery again after the loop guard expires", () => {
    const storage = new MemoryStorage();
    const first = setup(storage, () => 0);
    first.target.dispatchEvent(preloadError("missing:/assets/lesson-old.js"));
    first.dispose();

    const later = setup(storage, () => 5 * 60 * 1000);
    later.target.dispatchEvent(preloadError("missing:/assets/lesson-old.js"));

    expect(later.reload).toHaveBeenCalledOnce();
  });

  it("keeps Vite's normal error path when session storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(),
    };
    const { target, reload } = setup(storage);
    const event = preloadError("missing:/assets/lesson-old.js");

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
