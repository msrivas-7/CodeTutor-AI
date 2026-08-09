export function isTransientEvalTransportAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /operation was aborted|request aborted/i.test(error.message);
}

export async function withOneTransientEvalRetry<T>(
  operation: () => Promise<T>,
  onRetry: (error: Error) => void = () => undefined,
): Promise<{ value: T; attempts: number }> {
  try {
    return { value: await operation(), attempts: 1 };
  } catch (error) {
    if (!isTransientEvalTransportAbort(error)) throw error;
    onRetry(error);
    return { value: await operation(), attempts: 2 };
  }
}
