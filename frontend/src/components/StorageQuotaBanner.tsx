import { useStorageStore } from "../state/storageStore";

// Renders a dismissible warning at the top of the app when a `localStorage`
// write failed (quota, private browsing lockdown, etc.). Silently losing
// progress was the prior behavior — this makes it visible so the learner can
// free up space or export their progress before refreshing.
export function StorageQuotaBanner() {
  const quotaExceeded = useStorageStore((s) => s.quotaExceeded);
  const dismiss = useStorageStore((s) => s.dismiss);
  if (!quotaExceeded) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="mt-0.5 shrink-0"
        aria-hidden="true"
      >
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7.25 5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0V5zM8 12a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
      <div className="flex-1">
        <span className="font-semibold">Progress could not be saved.</span>{" "}
        Your browser blocked local storage — typically because it's full or
        you're in a private window. New edits may not persist across refreshes.
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss storage warning"
        className="shrink-0 rounded px-1.5 text-[11px] leading-none transition hover:bg-warn/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn"
      >
        ×
      </button>
    </div>
  );
}
