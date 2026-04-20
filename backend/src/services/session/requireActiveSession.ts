import { HttpError } from "../../middleware/errorHandler.js";
import { getSession } from "./sessionManager.js";
import type { SessionRecord } from "./sessionManager.js";
import type { SessionHandle } from "../execution/backends/index.js";

// All session-gated routes funnel through this helper. It enforces the
// (existence, ownership, runtime-ready) tuple in one place so a new route
// can't accidentally omit one of the checks.
//
//   404 — session id unknown (expired / cleaned up)
//   403 — session exists but was created by a different user (Phase 18a)
//   409 — session exists and is owned, but has no backend handle (teardown
//         mid-flight)
//
// Throws HttpError on any failure; the global errorHandler serializes it.
// Returning the ActiveSession (non-null) lets callers skip the null-check
// ceremony that the old res-writing variant required.
// Narrowed view: callers can read `handle` without a null check, since
// requireActiveSession already rejected sessions without one.
export type ActiveSession = Omit<SessionRecord, "handle"> & {
  handle: SessionHandle;
};

export function requireActiveSession(
  sessionId: string,
  userId: string,
): ActiveSession {
  const session = getSession(sessionId);
  if (!session) throw new HttpError(404, "session not found");
  if (session.userId !== userId) {
    throw new HttpError(403, "session not owned by caller");
  }
  if (!session.handle) {
    throw new HttpError(409, "session has no active runtime");
  }
  return session as ActiveSession;
}
