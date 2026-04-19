// Monaco editor helpers. The visible editor is a canvas-rendered surface with
// a single hidden `.ime-text-area` textarea that handles IME composition —
// clicking / typing into it does NOT move the cursor or edit the model. The
// only reliable way to drive Monaco in tests is through `window.monaco`,
// which @monaco-editor/react attaches as a side-effect of mounting any editor.
//
// All helpers below assume `window.monaco` is available. `waitForMonacoReady`
// polls until at least one model exists.

import type { Page } from "@playwright/test";

// Polls until @monaco-editor/react has registered at least one model. 15s
// ceiling keeps bad tests from hanging forever; 250ms interval is fast enough
// that a normal cold boot clears in ~2s.
export async function waitForMonacoReady(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        monaco?: { editor: { getModels(): Array<unknown> } };
      };
      return (w.monaco?.editor.getModels?.()?.length ?? 0) > 0;
    },
    undefined,
    { timeout, polling: 250 },
  );
  // One RAF hop for tokenization to settle so `.monaco-editor[data-mode-id]`
  // is accurate in downstream checks. Cheaper than a blanket setTimeout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

// Sets the content of the active editor's primary model. When the page hosts
// multiple editors (e.g. guided mode with a helper file), pass `modelIndex`
// to target a specific one. Defaults to 0 = main/active editor.
export async function setMonacoValue(page: Page, content: string, modelIndex = 0): Promise<void> {
  await waitForMonacoReady(page);
  const ok = await page.evaluate(
    ({ v, idx }) => {
      const w = window as unknown as {
        monaco?: { editor: { getModels(): Array<{ setValue(s: string): void }> } };
      };
      const models = w.monaco?.editor.getModels?.() ?? [];
      if (models.length === 0 || idx >= models.length) return false;
      models[idx].setValue(v);
      return true;
    },
    { v: content, idx: modelIndex },
  );
  if (!ok) throw new Error(`setMonacoValue failed: no model at index ${modelIndex}`);
}

export async function getMonacoValue(page: Page, modelIndex = 0): Promise<string> {
  return page.evaluate((idx) => {
    const w = window as unknown as {
      monaco?: { editor: { getModels(): Array<{ getValue(): string }> } };
    };
    const models = w.monaco?.editor.getModels?.() ?? [];
    return models.length > idx ? models[idx].getValue() : "";
  }, modelIndex);
}

// "Focus" the Monaco editor by clicking the container. Keyboard events go to
// Monaco's internal input handler; the hidden textarea receives them via
// bubbling. Used for keyboard-driven tests (cursor motion, Ctrl+F, etc.).
export async function focusMonaco(page: Page): Promise<void> {
  await waitForMonacoReady(page);
  await page.locator(".monaco-editor").first().click();
}

// Reports how many models the loader has registered. Useful for the rare
// lesson that ships multiple starter files — lets the test assert on count
// before indexing into a specific one.
export async function monacoModelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { monaco?: { editor: { getModels(): Array<unknown> } } };
    return w.monaco?.editor.getModels?.()?.length ?? 0;
  });
}
