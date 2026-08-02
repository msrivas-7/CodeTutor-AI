interface AdminLoadFailureProps {
  title: string;
  error: string;
  onRetry: () => void;
}

/**
 * Terminal first-load state for operator surfaces. Polling may continue in the
 * background, but the screen never leaves an operator staring at a skeleton
 * with no explanation or recovery action.
 */
export function AdminLoadFailure({
  title,
  error,
  onRetry,
}: AdminLoadFailureProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-4 text-sm text-danger"
    >
      <div className="font-semibold">{title}</div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-11 rounded-md border border-danger/40 bg-panel px-4 py-2 text-xs font-semibold text-danger transition hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
      >
        Try again
      </button>
    </div>
  );
}
