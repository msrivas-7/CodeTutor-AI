interface EditorReadinessPollOptions {
  expected: string;
  readCurrent: () => string | null;
  onReady: () => void;
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
}

/** Polls until the lazy editor owns the exact store buffer or is cancelled. */
export function pollForEditorReadiness({
  expected,
  readCurrent,
  onReady,
  schedule = (callback) => window.setTimeout(callback, 100),
  cancel = (handle) => window.clearTimeout(handle),
}: EditorReadinessPollOptions): () => void {
  let handle: number | null = null;
  let stopped = false;
  const check = () => {
    handle = null;
    if (stopped) return;
    if (readCurrent() === expected) {
      onReady();
      return;
    }
    handle = schedule(check);
  };
  check();
  return () => {
    stopped = true;
    if (handle !== null) cancel(handle);
  };
}
