import { Router } from "express";
import { z } from "zod";
import { openaiProvider } from "../services/ai/openaiProvider.js";

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

const askBody = z.object({
  model: z.string().min(1),
  question: z.string().min(1),
  files: z.array(projectFileSchema).max(50),
  activeFile: z.string().optional(),
  language: z.string().optional(),
  lastRun: runResultSchema.nullish(),
  history: historySchema.default([]),
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
    },
    {
      onDelta: (chunk) => {
        if (closed) return;
        send({ delta: chunk });
      },
      onDone: (raw, sections) => {
        if (closed) return;
        send({ done: true, raw, sections });
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
