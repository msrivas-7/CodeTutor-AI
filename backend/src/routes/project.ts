import { Router } from "express";
import { z } from "zod";
import { getSession, pingSession } from "../services/session/sessionManager.js";
import type { ExecutionBackend } from "../services/execution/backends/index.js";

const snapshotBody = z.object({
  sessionId: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(256),
        content: z.string().max(1_000_000),
      })
    )
    .max(50),
});

export function createProjectRouter(backend: ExecutionBackend): Router {
  const router = Router();

  router.post("/snapshot", async (req, res, next) => {
    const parsed = snapshotBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const { sessionId, files } = parsed.data;
    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ error: "session not found" });
    if (!session.handle) return res.status(409).json({ error: "session has no active runtime" });
    try {
      await backend.replaceSnapshot(session.handle, files);
      pingSession(sessionId);
      res.json({ ok: true, fileCount: files.length });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
