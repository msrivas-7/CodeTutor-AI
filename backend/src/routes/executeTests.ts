import { Router } from "express";
import { z } from "zod";
import { touchSession } from "../services/session/sessionManager.js";
import { requireActiveSession } from "../services/session/requireActiveSession.js";
import { languageSchema } from "../services/execution/commands.js";
import { getHarness } from "../services/execution/harness/registry.js";
import { runTests } from "../services/execution/harness/runHarness.js";
import type { ExecutionBackend } from "../services/execution/backends/index.js";

const functionTestSchema = z.object({
  name: z.string().min(1).max(120),
  call: z.string().min(1).max(4000),
  expected: z.string().min(1).max(4000),
  setup: z.string().max(4000).optional(),
  hidden: z.boolean().optional(),
  category: z.string().max(120).optional(),
});

const body = z.object({
  sessionId: z.string().min(1),
  language: languageSchema,
  tests: z.array(functionTestSchema).min(1).max(50),
});

export function createExecuteTestsRouter(backend: ExecutionBackend): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { sessionId, language, tests } = parsed.data;
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    const harness = getHarness(language);
    if (!harness) {
      // Known language but no harness registered yet. 422 (Unprocessable) lets
      // the UI distinguish this from 400 (bad request) or 500 (crash) and surface
      // a specific "this language doesn't support function tests" message.
      return res.status(422).json({
        error: `function_tests not yet supported for language: ${language}`,
      });
    }

    try {
      const session = requireActiveSession(sessionId, userId);
      const result = await runTests(backend, harness, {
        handle: session.handle,
        tests,
      });
      touchSession(sessionId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
