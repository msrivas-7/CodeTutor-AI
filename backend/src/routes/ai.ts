import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { openaiProvider } from "../services/ai/openaiProvider.js";
import { languageSchema } from "../services/execution/commands.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { aiRateLimit } from "../middleware/aiRateLimit.js";
import { getOpenAIKey } from "../db/preferences.js";
import { config } from "../config.js";

// Wire a per-request AbortController to (a) a config-driven deadline and
// (b) the response's `close` event, so OpenAI calls stop burning tokens
// the moment the client disconnects or the deadline hits. Returns the
// signal plus a cleanup fn; call cleanup on successful completion so the
// timer doesn't sit in the event loop for 90s after we're done.
function requestAbortSignal(res: Response): {
  signal: AbortSignal;
  cleanup: () => void;
  reason: () => "timeout" | "client-close" | null;
} {
  const controller = new AbortController();
  let reason: "timeout" | "client-close" | null = null;
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      reason = "timeout";
      controller.abort();
    }
  }, config.aiRequestTimeoutMs);
  const onClose = () => {
    if (!controller.signal.aborted) {
      reason = "client-close";
      controller.abort();
    }
  };
  res.on("close", onClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      res.off("close", onClose);
    },
    reason: () => reason,
  };
}

export const aiRouter = Router();

// Phase 18a. `validate-key` stays public: the learner hasn't necessarily
// finished signup yet (they may want to test their OpenAI key first). Every
// other AI surface requires a valid Supabase session. Rate-limiting is
// applied AFTER auth so the per-user bucket sees the authenticated userId.
const authed = [authMiddleware, aiRateLimit] as const;

// Phase 18e: the user's OpenAI key lives encrypted in user_preferences.
// Every authed AI route fetches + decrypts it on demand via the signed-in
// userId. 400 with `KEY_MISSING` so the frontend can prompt the user to
// open Settings and enter one.
async function resolveKey(req: Request, res: Response): Promise<string | null> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return null;
  }
  const key = await getOpenAIKey(userId);
  if (!key) {
    res.status(400).json({ error: "KEY_MISSING" });
    return null;
  }
  return key;
}

const validateBody = z.object({
  key: z.string().min(1),
});

aiRouter.post("/validate-key", aiRateLimit, async (req, res, next) => {
  const parsed = validateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "key required" });
  try {
    const result = await openaiProvider.validateKey(parsed.data.key);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

aiRouter.get("/models", ...authed, async (req, res, next) => {
  const key = await resolveKey(req, res);
  if (!key) return;
  try {
    const models = await openaiProvider.listModels(key);
    res.json({ models });
  } catch (err) {
    next(err);
  }
});

// Phase 17 / M-A1: reject paths that could break out of the <user_file path="…">
// wrapper in prompts (XML escape is the primary defense in renderContext.ts —
// this is belt-and-suspenders at the route boundary). Alphanumerics, dot,
// underscore, dash, slash only; 256-char cap to prevent log-bloat too.
const safePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._/-]+$/, "path contains disallowed characters");

const projectFileSchema = z.object({
  path: safePathSchema,
  content: z.string(),
});

const runResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  errorType: z.enum(["none", "compile", "runtime", "timeout", "system"]),
  durationMs: z.number(),
  stage: z.enum(["compile", "run", "setup"]),
});

const historySchema = z.array(
  z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })
);

const selectionSchema = z.object({
  path: safePathSchema,
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  text: z.string(),
});

// Mirrors the authoring schema in frontend/src/features/learning/content/schema.ts.
// Kept as a discriminated union here so the `function_tests.tests` payload
// survives the route boundary instead of being silently dropped.
const functionTestSchema = z.object({
  name: z.string().min(1),
  call: z.string().min(1),
  expected: z.string().min(1),
  setup: z.string().optional(),
  hidden: z.boolean().optional(),
  category: z.string().optional(),
});
const completionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("expected_stdout"), expected: z.string() }),
  z.object({
    type: z.literal("required_file_contains"),
    file: z.string().optional(),
    pattern: z.string(),
  }),
  z.object({ type: z.literal("function_tests"), tests: z.array(functionTestSchema).min(1) }),
  z.object({ type: z.literal("custom_validator") }),
]);

const askBody = z.object({
  model: z.string().min(1),
  question: z.string().min(1),
  files: z.array(projectFileSchema).max(50),
  activeFile: z.string().optional(),
  language: languageSchema.optional(),
  lastRun: runResultSchema.nullish(),
  history: historySchema.default([]),
  stdin: z.string().nullish(),
  diffSinceLastTurn: z.string().nullish(),
  runsSinceLastTurn: z.number().int().min(0).optional(),
  editsSinceLastTurn: z.number().int().min(0).optional(),
  persona: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  selection: selectionSchema.nullish(),
  lessonContext: z.object({
    courseId: z.string(),
    lessonId: z.string(),
    lessonTitle: z.string(),
    language: languageSchema,
    lessonObjectives: z.array(z.string()),
    teachesConceptTags: z.array(z.string()),
    usesConceptTags: z.array(z.string()),
    priorConcepts: z.array(z.string()),
    completionRules: z.array(completionRuleSchema),
    studentProgressSummary: z.string(),
    lessonOrder: z.number().int().optional(),
    totalLessons: z.number().int().optional(),
  }).nullish(),
});

const summarizeBody = z.object({
  model: z.string().min(1),
  history: historySchema,
});

aiRouter.post("/ask", ...authed, async (req, res, next) => {
  const key = await resolveKey(req, res);
  if (!key) return;
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  const abort = requestAbortSignal(res);
  try {
    const result = await openaiProvider.ask({
      key,
      model: parsed.data.model,
      question: parsed.data.question,
      files: parsed.data.files,
      activeFile: parsed.data.activeFile,
      language: parsed.data.language,
      lastRun: parsed.data.lastRun ?? null,
      history: parsed.data.history,
      stdin: parsed.data.stdin ?? null,
      diffSinceLastTurn: parsed.data.diffSinceLastTurn ?? null,
      runsSinceLastTurn: parsed.data.runsSinceLastTurn,
      editsSinceLastTurn: parsed.data.editsSinceLastTurn,
      persona: parsed.data.persona,
      selection: parsed.data.selection ?? null,
      lessonContext: parsed.data.lessonContext ?? null,
      signal: abort.signal,
    });
    res.json(result);
  } catch (err) {
    // Client-close: response is already gone, no point forwarding to the
    // error handler. Timeout: pass through so the client sees a 5xx.
    if (abort.reason() === "client-close") return;
    next(err);
  } finally {
    abort.cleanup();
  }
});

aiRouter.post("/ask/stream", ...authed, async (req, res) => {
  const key = await resolveKey(req, res);
  if (!key) return;
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const done = (): void => {
    res.end();
  };

  // `requestAbortSignal` fires on res.on("close") — same signal used pre-P0
  // to detect client disconnect — AND on the request-wide deadline. The
  // provider forwards the signal to its upstream fetch, so when it fires we
  // stop draining OpenAI's stream. Handlers still check `closed` before
  // writing, since the reader can emit a last delta after abort.
  let closed = false;
  const abort = requestAbortSignal(res);
  res.on("close", () => {
    closed = true;
  });

  try {
    await openaiProvider.askStream(
      {
        key,
        model: parsed.data.model,
        question: parsed.data.question,
        files: parsed.data.files,
        activeFile: parsed.data.activeFile,
        language: parsed.data.language,
        lastRun: parsed.data.lastRun ?? null,
        history: parsed.data.history,
        stdin: parsed.data.stdin ?? null,
        diffSinceLastTurn: parsed.data.diffSinceLastTurn ?? null,
        runsSinceLastTurn: parsed.data.runsSinceLastTurn,
        editsSinceLastTurn: parsed.data.editsSinceLastTurn,
        persona: parsed.data.persona,
        selection: parsed.data.selection ?? null,
        lessonContext: parsed.data.lessonContext ?? null,
        signal: abort.signal,
      },
      {
        onDelta: (chunk) => {
          if (closed) return;
          send({ delta: chunk });
        },
        onDone: (raw, sections, usage) => {
          if (closed) return;
          send({ done: true, raw, sections, usage });
          done();
        },
        onError: (message) => {
          if (closed) return;
          send({ error: message });
          done();
        },
      }
    );
  } finally {
    abort.cleanup();
  }
});

aiRouter.post("/summarize", ...authed, async (req, res, next) => {
  const key = await resolveKey(req, res);
  if (!key) return;
  const parsed = summarizeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  if (parsed.data.history.length === 0) {
    return res.json({ summary: "" });
  }
  try {
    const summary = await openaiProvider.summarize({
      key,
      model: parsed.data.model,
      history: parsed.data.history,
    });
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});
