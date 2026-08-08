import { afterAll, beforeAll, describe, expect, it } from "vitest";

// QA-L4 + M-12: the window-level keydown handler must *not* fire while the
// user is typing. `isTypingTarget` is the one gate protecting the shortcuts
// from hijacking INPUT/TEXTAREA/SELECT, contenteditable surfaces, and
// Monaco's hidden textarea. The tests below pin that matrix.
//
// The frontend test env is node (no jsdom), so we stub the minimum DOM types
// the predicate touches: `HTMLElement` (for `instanceof`), plus `tagName`,
// `isContentEditable`, and `closest(".monaco-editor")`.

class FakeElement {
  tagName: string;
  isContentEditable: boolean;
  private readonly parentSelectors: string[];

  constructor(opts: { tag: string; contentEditable?: boolean; ancestorClass?: string }) {
    this.tagName = opts.tag.toUpperCase();
    this.isContentEditable = opts.contentEditable === true;
    this.parentSelectors = opts.ancestorClass ? [`.${opts.ancestorClass}`] : [];
  }

  closest(sel: string): FakeElement | null {
    return this.parentSelectors.includes(sel) ? this : null;
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, "HTMLElement", {
    value: FakeElement,
    configurable: true,
  });
});

afterAll(() => {
  // Restore so any later test that relies on the missing global keeps its
  // previous state. `delete` on a defined property is fine when configurable.
  delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
});

// Import *after* the global is stubbed so the module-level reference resolves
// against our fake. Vitest hoists imports, so we use dynamic import.
async function loadPredicate() {
  const mod = await import("./GlobalShortcuts");
  return mod.isTypingTarget;
}

describe("isTypingTarget", () => {
  it("returns false for null target", async () => {
    const isTypingTarget = await loadPredicate();
    expect(isTypingTarget(null)).toBe(false);
  });

  it("returns false for a non-HTMLElement event target (e.g. document)", async () => {
    const isTypingTarget = await loadPredicate();
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });

  it("returns false for a plain DIV (non-editable, no Monaco ancestor)", async () => {
    const isTypingTarget = await loadPredicate();
    expect(isTypingTarget(new FakeElement({ tag: "div" }) as unknown as EventTarget)).toBe(false);
  });

  it("returns true for INPUT so typing '?' in a form doesn't open the cheatsheet", async () => {
    const isTypingTarget = await loadPredicate();
    expect(isTypingTarget(new FakeElement({ tag: "input" }) as unknown as EventTarget)).toBe(true);
  });

  it("returns true for TEXTAREA (composer, notes)", async () => {
    const isTypingTarget = await loadPredicate();
    expect(isTypingTarget(new FakeElement({ tag: "textarea" }) as unknown as EventTarget)).toBe(true);
  });

  it("returns true for SELECT so arrow keys aren't hijacked", async () => {
    const isTypingTarget = await loadPredicate();
    expect(isTypingTarget(new FakeElement({ tag: "select" }) as unknown as EventTarget)).toBe(true);
  });

  it("returns true for a contenteditable element regardless of tag", async () => {
    const isTypingTarget = await loadPredicate();
    const span = new FakeElement({ tag: "span", contentEditable: true });
    const div = new FakeElement({ tag: "div", contentEditable: true });
    expect(isTypingTarget(span as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(div as unknown as EventTarget)).toBe(true);
  });

  it("returns true when the target has a .monaco-editor ancestor", async () => {
    const isTypingTarget = await loadPredicate();
    // Monaco's hidden textarea lives inside `.monaco-editor .inputarea`.
    const el = new FakeElement({ tag: "textarea", ancestorClass: "monaco-editor" });
    expect(isTypingTarget(el as unknown as EventTarget)).toBe(true);
  });
});

describe("openKeyboardShortcuts", () => {
  it("dispatches the shared dialog-open event for visible help controls", async () => {
    const dispatched: string[] = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        CustomEvent: class {
          type: string;
          detail: unknown;

          constructor(type: string, init?: { detail?: unknown }) {
            this.type = type;
            this.detail = init?.detail;
          }
        },
        dispatchEvent(event: Event) {
          dispatched.push(event.type);
          return true;
        },
      },
      configurable: true,
    });
    try {
      const { OPEN_KEYBOARD_SHORTCUTS_EVENT, openKeyboardShortcuts } =
        await import("./GlobalShortcuts");
      openKeyboardShortcuts();
      expect(dispatched).toEqual([OPEN_KEYBOARD_SHORTCUTS_EVENT]);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
