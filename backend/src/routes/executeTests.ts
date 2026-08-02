import { Router } from "express";
import { z } from "zod";
import { touchSession } from "../services/session/sessionManager.js";
import { requireActiveSession } from "../services/session/requireActiveSession.js";
import { languageSchema } from "../services/execution/commands.js";
import { getHarness } from "../services/execution/harness/registry.js";
import { runTests } from "../services/execution/harness/runHarness.js";
import type { ExecutionBackend } from "../services/execution/backends/index.js";
import {
  functionTestSchema as canonicalFunctionTestSchema,
  sourceCheckSchema as canonicalSourceCheckSchema,
} from "../schema/lessonRuleSchema.js";

// Route-specific size limits: the canonical authoring schema allows arbitrary
// string lengths, but the harness runs these strings through a container eval
// loop where oversized payloads inflate memory + runtime. Enforced here at the
// route boundary, not in the shared schema.
const functionTestSchema = canonicalFunctionTestSchema.innerType().extend({
  name: z.string().min(1).max(120),
  call: z.string().min(1).max(4000),
  expected: z.string().min(1).max(4000).optional(),
  expectedError: z
    .object({
      type: z.string().min(1).max(120),
      message: z.string().min(1).max(500).optional(),
    })
    .optional(),
  beforeLoad: z.string().max(4000).optional(),
  setup: z.string().max(4000).optional(),
  category: z.string().max(120).optional(),
}).superRefine((test, ctx) => {
  if ((test.expected === undefined) === (test.expectedError === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one of expected or expectedError is required",
    });
  }
});

const sourceCheckSchema = canonicalSourceCheckSchema.extend({
  name: z.string().min(1).max(120),
  file: z.string().min(1).max(256).optional(),
  target: z.string().min(1).max(120).optional(),
  scope: z.string().min(1).max(240).optional(),
  category: z.string().max(120).optional(),
  feedback: z.string().min(1).max(500),
}).superRefine((check, ctx) => {
  const path = check.file ?? "main.py";
  if (
    path.startsWith("/") ||
    path.includes("\\\\") ||
    path.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["file"],
      message: "source-check file must be a safe project-relative path",
    });
  }
});

const body = z
  .object({
    sessionId: z.string().min(1),
    language: languageSchema,
    tests: z.array(functionTestSchema).max(50).default([]),
    sourceChecks: z.array(sourceCheckSchema).max(50).default([]),
  })
  .refine((value) => value.tests.length + value.sourceChecks.length > 0, {
    message: "at least one test or source check is required",
  });

export function createExecuteTestsRouter(backend: ExecutionBackend): Router {
  const router = Router();

  router.post("/", async (req, res, next) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { sessionId, language, tests, sourceChecks } = parsed.data;
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

    if (sourceChecks.length > 0 && language !== "python") {
      return res.status(422).json({
        error: `source_checks not yet supported for language: ${language}`,
      });
    }

    try {
      const session = requireActiveSession(sessionId, userId);
      const result = await runTests(backend, harness, {
        handle: session.handle,
        suite: { tests, sourceChecks },
      });
      touchSession(sessionId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
