import { Router } from "express";
import { z } from "zod";
import { getSession, pingSession } from "../services/session/sessionManager.js";
import type { ExecutionBackend } from "../services/execution/backends/index.js";

// Per-file cap matches the Express body cap divided across the `files` array.
// express.json({ limit: "5mb" }) already bounds the whole request; this
// per-file cap keeps a single file from consuming the entire budget and
// matches the runner-side practical file size (no learner lesson is 200 kB).
// Phase 17 / M-A1: path charset restricted to match the schema in
// routes/ai.ts — any `<`, `>`, `&`, `"` or control chars would let a file
// from the snapshot flow back into the tutor prompt and break out of the
// <user_file path="…"> wrapper.
const snapshotBody = z.object({
  sessionId: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[A-Za-z0-9._/-]+$/, "path contains disallowed characters"),
        content: z.string().max(200_000),
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
