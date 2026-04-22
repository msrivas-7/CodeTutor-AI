import { Router } from "express";
import { z } from "zod";
import {
  startSession,
  pingSession,
  endSession,
  getSessionStatus,
  rebindSession,
  BACKEND_BOOT_ID,
} from "../services/session/sessionManager.js";

export const sessionRouter = Router();

const idBody = z.object({ sessionId: z.string().min(1) });

// Every handler below assumes `req.userId` is set — authMiddleware is mounted
// before this router in index.ts.
function requireUser(req: import("express").Request): string {
  const u = req.userId;
  if (!u) throw new Error("authMiddleware missing — bootstrap bug");
  return u;
}

sessionRouter.post("/", async (req, res, next) => {
  try {
    const s = await startSession(requireUser(req));
    res.json({
      sessionId: s.id,
      createdAt: s.createdAt,
      backendBootId: BACKEND_BOOT_ID,
    });
  } catch (err) {
    next(err);
  }
});

sessionRouter.post("/ping", (req, res) => {
  const parsed = idBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "sessionId required" });
  // pingSession quietly returns false for both "not found" and "not yours"
  // so that a stale UI re-ping doesn't leak that another user owns the id.
  const ok = pingSession(parsed.data.sessionId, requireUser(req));
  if (!ok) {
    // QA-L5: ship the bootId on the 404 so the frontend can diff it against
    // the one it saw on its last successful startSession/rebind response.
    // A mismatch means the process restarted and the session map was purged
    // wholesale — worth a "replaced" modal rather than a silent rebind.
    return res
      .status(404)
      .json({ error: "session not found", backendBootId: BACKEND_BOOT_ID });
  }
  res.json({ ok: true, backendBootId: BACKEND_BOOT_ID });
});

sessionRouter.post("/rebind", async (req, res, next) => {
  const parsed = idBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "sessionId required" });
  try {
    const { record, reused } = await rebindSession(
      parsed.data.sessionId,
      requireUser(req),
    );
    res.json({
      sessionId: record.id,
      reused,
      backendBootId: BACKEND_BOOT_ID,
    });
  } catch (err) {
    next(err);
  }
});

sessionRouter.post("/end", async (req, res, next) => {
  const parsed = idBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "sessionId required" });
  try {
    const ok = await endSession(parsed.data.sessionId, requireUser(req));
    res.json({ ok });
  } catch (err) {
    next(err);
  }
});

sessionRouter.get("/:id/status", async (req, res, next) => {
  try {
    const status = await getSessionStatus(req.params.id, requireUser(req));
    res.json(status);
  } catch (err) {
    next(err);
  }
});
