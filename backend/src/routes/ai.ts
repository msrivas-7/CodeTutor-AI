import { Router } from "express";
import { z } from "zod";
import { openaiProvider } from "../services/ai/openaiProvider.js";
import { languageSchema } from "../services/execution/commands.js";

export const aiRouter = Router();

// The user's OpenAI key is passed per-request via this header. Never logged,
// never persisted server-side — the backend forwards it upstream and forgets.
const KEY_HEADER = "x-openai-key";

function getKey(req: import("express").Request): string | null {
  const raw = req.header(KEY_HEADER);
  return raw && raw.trim() ? raw.trim() : null;
}

const validateBody = z.object({
  key: z.string().min(1),
});

aiRouter.post("/validate-key", async (req, res, next) => {
  const parsed = validateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "key required" });
  try {
    const result = await openaiProvider.validateKey(parsed.data.key);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

aiRouter.get("/models", async (req, res, next) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: "missing X-OpenAI-Key header" });
  try {
    const models = await openaiProvider.listModels(key);
    res.json({ models });
  } catch (err) {
    next(err);
  }
});

const projectFileSchema = z.object({
  path: z.string(),
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
  path: z.string().min(1),
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

aiRouter.post("/ask", async (req, res, next) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: "missing X-OpenAI-Key header" });
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
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
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

aiRouter.post("/ask/stream", async (req, res) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: "missing X-OpenAI-Key header" });
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

  // Detect client disconnect via `res.on("close")` — not `req.on("close")`,
  // which Node fires as soon as the request body has been fully read (even if
  // the socket is still open for our response). Using req here caused every
  // upstream event to be dropped as "client already disconnected".
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

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
});

aiRouter.post("/summarize", async (req, res, next) => {
  const key = getKey(req);
  if (!key) return res.status(400).json({ error: "missing X-OpenAI-Key header" });
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
