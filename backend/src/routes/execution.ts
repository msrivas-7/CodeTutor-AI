import { Router } from "express";
import { z } from "zod";
import { touchSession } from "../services/session/sessionManager.js";
import { requireActiveSession } from "../services/session/requireActiveSession.js";
import { runProject } from "../services/execution/router.js";
import { languageSchema } from "../services/execution/commands.js";
import type { ExecutionBackend } from "../services/execution/backends/index.js";
import { execDuration } from "../services/metrics.js";
import { mintContextualEvidenceToken } from "../services/ai/contextualEvidence.js";

// `language` is validated against the shared languageSchema so an unknown
// language is rejected at the Zod layer — no downstream `isLanguage` branch.
const body = z.object({
  sessionId: z.string().min(1),
  language: languageSchema,
  stdin: z.string().max(100_000).optional(),
});

const cancelBody = z.object({ sessionId: z.string().min(1) });

export function createExecutionRouter(backend: ExecutionBackend): Router {
  const router = Router();

  router.post("/cancel", async (req, res, next) => {
    const parsed = cancelBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "unauthenticated" });
    try {
      const session = requireActiveSession(parsed.data.sessionId, userId);
      await backend.cancel(session.handle);
      touchSession(parsed.data.sessionId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

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
      // Capture the evidence snapshot before execution starts. A later
      // /project/snapshot request may replace the session field while this
      // run is in flight; its files must never be signed alongside this
      // run's older result.
      const contextualSnapshot = session.contextualSnapshot;
      const started = Date.now();
      const result = await runProject(backend, {
        handle: session.handle,
        language,
        stdin,
      });
      const response = contextualSnapshot
        ? {
            ...result,
            contextualEvidenceToken: mintContextualEvidenceToken(
              `user:${userId}`,
              contextualSnapshot.identity,
              contextualSnapshot.files,
              result,
            ),
          }
        : result;
      // Wall-clock covers compile + run + FS checks — what a caller sees as
      // "how long did my run take". ok label is boolean-ish (Prom labels are
      // strings) so the series splits into passing vs failing runs for
      // quick `rate(.{ok="false"})` queries.
      execDuration.observe(
        { language, ok: result.exitCode === 0 ? "true" : "false" },
        (Date.now() - started) / 1000,
      );
      touchSession(sessionId);
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
