import { Router } from "express";
import { z } from "zod";
import { touchSession } from "../services/session/sessionManager.js";
import { requireActiveSession } from "../services/session/requireActiveSession.js";
import { runProject } from "../services/execution/router.js";
import { languageSchema } from "../services/execution/commands.js";
import type { ExecutionBackend } from "../services/execution/backends/index.js";

// `language` is validated against the shared languageSchema so an unknown
// language is rejected at the Zod layer — no downstream `isLanguage` branch.
const body = z.object({
  sessionId: z.string().min(1),
  language: languageSchema,
  stdin: z.string().max(100_000).optional(),
});

export function createExecutionRouter(backend: ExecutionBackend): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { sessionId, language, stdin } = parsed.data;
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    try {
      const session = requireActiveSession(sessionId, userId);
      const result = await runProject(backend, {
        handle: session.handle,
        language,
        stdin,
      });
      touchSession(sessionId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
