import type { Response } from "express";
import { getSession } from "./sessionManager.js";
import type { SessionRecord } from "./sessionManager.js";

// Both /api/execute and /api/execute/tests gate on the same session lookup:
// 404 when the session id is unknown (expired / cleaned up) and 409 when the
// session exists but has no container (teardown mid-flight). Centralizing it
// means the status/message pair stays consistent across routes and a future
// third route gets the same contract for free.
//
// Returns the session on success, or `null` after writing the response — the
// caller should early-return when it sees null.
// Narrowed view after the guard: callers can read containerId without a null
// check, since requireActiveSession already rejected sessions without one.
export type ActiveSession = Omit<SessionRecord, "containerId"> & {
  containerId: string;
};

export function requireActiveSession(
  res: Response,
  sessionId: string,
): ActiveSession | null {
  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return null;
  }
  if (!session.containerId) {
    res.status(409).json({ error: "session has no active container" });
    return null;
  }
  return session as ActiveSession;
}
