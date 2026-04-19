import { Router } from "express";
import { z } from "zod";
import { pingSession } from "../services/session/sessionManager.js";
import { requireActiveSession } from "../services/session/requireActiveSession.js";
import { runProject } from "../services/execution/router.js";
import { isLanguage, LANGUAGES } from "../services/execution/commands.js";

export const executionRouter = Router();

const body = z.object({
  sessionId: z.string().min(1),
  language: z.string(),
  stdin: z.string().max(100_000).optional(),
});

executionRouter.post("/", async (req, res, next) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { sessionId, language, stdin } = parsed.data;

  if (!isLanguage(language)) {
    return res.status(400).json({
      error: `unsupported language "${language}"; expected one of ${LANGUAGES.join(", ")}`,
    });
  }

  const session = requireActiveSession(res, sessionId);
  if (!session) return;

  try {
    const result = await runProject({
      containerId: session.containerId,
      workspacePath: session.workspacePath,
      language,
      stdin,
    });
    pingSession(sessionId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
