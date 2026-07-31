/** Web Share rejects with AbortError when the learner closes the native
 * share sheet without choosing a destination. Keep that distinct from a
 * platform/permission failure, which is not evidence of learner intent. */
export function isNativeShareCancellation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AbortError"
  );
}
