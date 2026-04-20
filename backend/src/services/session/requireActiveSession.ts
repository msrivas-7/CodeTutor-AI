import type { Response } from "express";
import { getSession } from "./sessionManager.js";
import type { SessionRecord } from "./sessionManager.js";
import type { SessionHandle } from "../execution/backends/index.js";

// Both /api/execute and /api/execute/tests gate on the same session lookup:
// 404 when the session id is unknown (expired / cleaned up) and 409 when the
// session exists but has no backend handle (teardown mid-flight). Centralizing
// it means the status/message pair stays consistent across routes.
//
// Returns the session on success, or `null` after writing the response — the
// caller should early-return when it sees null.
// Narrowed view: callers can read `handle` without a null check, since
// requireActiveSession already rejected sessions without one.
export type ActiveSession = Omit<SessionRecord, "handle"> & {
  handle: SessionHandle;
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
  if (!session.handle) {
    res.status(409).json({ error: "session has no active runtime" });
    return null;
  }
  return session as ActiveSession;
}
