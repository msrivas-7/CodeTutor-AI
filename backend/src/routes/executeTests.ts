import { Router } from "express";
import { z } from "zod";
import { getSession, pingSession } from "../services/session/sessionManager.js";
import { runTests } from "../services/execution/testHarness.js";

export const executeTestsRouter = Router();

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
  language: z.literal("python"),
  tests: z.array(functionTestSchema).min(1).max(50),
});

executeTestsRouter.post("/", async (req, res, next) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { sessionId, tests } = parsed.data;

  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: "session not found" });
  if (!session.containerId) {
    return res.status(409).json({ error: "session has no active container" });
  }

  try {
    const result = await runTests({
      containerId: session.containerId,
      workspacePath: session.workspacePath,
      tests,
    });
    pingSession(sessionId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
