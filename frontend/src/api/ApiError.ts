// Phase 20-P0 #5: centralized error type for fetch failures so user-facing
// alerts (SignupPage, LoginPage, SessionErrorBanner, tutor, OAuthButtons,
// …) surface friendly strings instead of leaked internals like
// "/api/user/preferences failed: 500 session not owned by caller".
//
// The parent `Error.message` is set to the friendly string so existing
// `(err as Error).message` catch sites get the nice version for free. The
// raw server text stays on `.body` and is `console.error`'d at the boundary
// so we can still diagnose from browser devtools / session replay.
export class ApiError extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly body: string;
  readonly path: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    body: string,
    path: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(friendlyMessage(status));
    this.status = status;
    this.body = body;
    this.path = path;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function friendlyMessage(status: number): string {
  if (status === 0) return "Network error. Check your connection and try again.";
  if (status === 401) return "Your session has expired — please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find that — it may have been removed.";
  if (status === 408) return "The request timed out. Please try again.";
  if (status === 413) return "That request was too large.";
  if (status === 429) return "Too many requests — please wait a moment and try again.";
  if (status >= 500 && status < 600) return "Something went wrong on our end. Please try again in a moment.";
  if (status >= 400 && status < 500) return "That request was invalid. Please try again.";
  return "Request failed. Please try again.";
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
