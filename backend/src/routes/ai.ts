import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { openaiProvider } from "../services/ai/openaiProvider.js";
import { languageSchema } from "../services/execution/commands.js";
import {
  validateKeyUserRateLimit,
  validateKeyGlobalRateLimit,
} from "../middleware/aiRateLimit.js";
import { getOpenAIKey } from "../db/preferences.js";
import { config } from "../config.js";
import { completionRuleSchema } from "../schema/lessonRuleSchema.js";
import {
  resolveAICredential,
  invalidateUsageCaches,
  markPlatformAuthFailed,
  type AICredential,
  type CredentialNoneReason,
} from "../services/ai/credential.js";
import { AIProviderError } from "../services/ai/provider.js";
import {
  isPlatformAllowedModel,
  priceUsd,
} from "../services/ai/pricing.js";
import { writeUsageRow } from "../db/usageLedger.js";
import {
  aiPlatformRequests,
  aiPlatformAbuseSignals,
} from "../services/metrics.js";
import {
  registerAbortController,
  unregisterAbortController,
} from "../services/shutdown/abortRegistry.js";
import { hashUserId } from "../services/crypto/logHash.js";

// Wire a per-request AbortController to (a) a config-driven deadline and
// (b) the response's `close` event, so OpenAI calls stop burning tokens
// the moment the client disconnects or the deadline hits. Returns the
// signal plus a cleanup fn; call cleanup on successful completion so the
// timer doesn't sit in the event loop for 90s after we're done.
function requestAbortSignal(res: Response): {
  signal: AbortSignal;
  cleanup: () => void;
  reason: () => "timeout" | "client-close" | "shutdown" | null;
} {
  const controller = new AbortController();
  let reason: "timeout" | "client-close" | "shutdown" | null = null;
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
  // S-13 (bucket 7): register with the process-level registry so SIGTERM
  // can fan-abort every in-flight stream and each handler gets a chance to
  // write its partial ledger row before the grace window expires.
  registerAbortController(controller);
  const onAbortFromRegistry = () => {
    if (reason === null && controller.signal.reason instanceof Error) {
      const msg = controller.signal.reason.message;
      if (msg.startsWith("shutdown:")) reason = "shutdown";
    }
  };
  controller.signal.addEventListener("abort", onAbortFromRegistry, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      res.off("close", onClose);
      unregisterAbortController(controller);
    },
    reason: () => reason,
  };
}

export const aiRouter = Router();

// authMiddleware + aiRateLimit are applied at the router mount in index.ts
// so every path under /api/ai — including unknown subpaths — pays the same
// auth + rate-limit price. /validate-key layers its own tighter sub-buckets
// (see validateKeyUserRateLimit + validateKeyGlobalRateLimit).

// Phase 18e: the user's OpenAI key lives encrypted in user_preferences.
// Kept around for `validate-key` + `/models`, which are BYOK-only surfaces
// (validating a user-provided key, listing the user's models). Neither
// consumes platform tokens; no free-tier path.
async function resolveByokKey(req: Request, res: Response): Promise<string | null> {
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

// Phase 20-P4: every AI route runs through this. It resolves the user's
// credential (BYOK > platform > none), translates `none` reasons into the
// correct HTTP status/body, and emits a `ai_platform_requests_total`
// sample so each outcome shows up on the operator dashboard. The caller
// receives the credential on success and must return immediately on null
// (response was already written).
async function resolveCredentialOrRespond(
  req: Request,
  res: Response,
  route: "ask" | "ask_stream" | "summarize",
): Promise<AICredential | null> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: "not authenticated" });
    return null;
  }
  const cred = await resolveAICredential(userId);
  if (cred.source === "byok") {
    aiPlatformRequests.inc({ outcome: "byok", route });
    return cred;
  }
  if (cred.source === "platform") {
    aiPlatformRequests.inc({ outcome: "served", route });
    return cred;
  }
  // cred.source === 'none' — map reason to outcome + HTTP status.
  const reason = cred.reason;
  const outcomeByReason: Record<CredentialNoneReason, string> = {
    no_key: "byok",
    free_disabled: "killed_disabled",
    free_exhausted: "exhausted",
    daily_usd_per_user_hit: "daily_usd_user",
    lifetime_usd_per_user_hit: "lifetime_usd_user",
    usd_cap_hit: "killed_usd_cap",
    denylisted: "denylisted",
    provider_auth_failed: "provider_auth_failed",
  };
  aiPlatformRequests.inc({ outcome: outcomeByReason[reason], route });

  if (reason === "free_exhausted") {
    res.status(429).json({ error: "FREE_TIER_EXHAUSTED", reason });
    return null;
  }
  if (reason === "denylisted") {
    res.status(403).json({ error: "USER_DENYLISTED", reason });
    return null;
  }
  if (reason === "no_key") {
    // Free tier disabled AND no BYOK. Keep the existing KEY_MISSING contract
    // so the SettingsPanel prompt path triggers unchanged for BYOK-only mode.
    res.status(400).json({ error: "KEY_MISSING", reason });
    return null;
  }
  // free_disabled / usd_cap_hit / provider_auth_failed / daily_usd_per_user_hit
  // / lifetime_usd_per_user_hit → user-visible "paused" copy. Operator sees
  // the precise reason in metrics; we don't leak the cap numbers.
  res.status(503).json({ error: "PLATFORM_AI_PAUSED", reason });
  return null;
}

// Server-side model gate. The `byok` path is permissive — the user owns
// their bill. The `platform` path is locked to the curated allowlist
// (gpt-4.1-nano), so there's no "request gpt-4 on the operator's key"
// escalation. Returns true if the route should proceed; false if it
// already responded with a 403.
function enforceModelAllowlist(
  cred: AICredential,
  model: string,
  res: Response,
  route: "ask" | "ask_stream" | "summarize",
): boolean {
  if (cred.source !== "platform") return true;
  if (!isPlatformAllowedModel(model)) {
    aiPlatformRequests.inc({ outcome: "model_rejected", route });
    aiPlatformAbuseSignals.inc({ signal: "model_rejection" });
    res.status(403).json({ error: "MODEL_NOT_ALLOWED" });
    return false;
  }
  return true;
}

// Wrap the writeUsageRow call so route handlers don't have to swallow DB
// errors inline; a failed ledger write shouldn't take the whole response
// down, but it MUST be logged and flagged — an unlogged platform call is a
// hole in the cap enforcement.
async function safeWriteUsage(
  userId: string,
  row: Omit<Parameters<typeof writeUsageRow>[0], "userId">,
): Promise<void> {
  try {
    await writeUsageRow({ userId, ...row });
    if (row.fundingSource === "platform") {
      invalidateUsageCaches(userId);
    }
  } catch (err) {
    console.error(`[ai] ledger write failed user=${hashUserId(userId)} route=${row.route}:`, err);
  }
}

// Cheap platform-route diagnostic: a user hit the per-user daily $ cap
// without using up their visible 30-question budget. Means they're
// minting cost on ways we didn't plan for. Counter → operator investigates.
function flagIfAbuseShape(reason: CredentialNoneReason | null): void {
  if (reason === "daily_usd_per_user_hit") {
    aiPlatformAbuseSignals.inc({ signal: "daily_usd_hit" });
  } else if (reason === "lifetime_usd_per_user_hit") {
    aiPlatformAbuseSignals.inc({ signal: "lifetime_usd_hit" });
  }
}

const validateBody = z.object({
  key: z.string().min(1),
});

aiRouter.post(
  "/validate-key",
  validateKeyUserRateLimit,
  validateKeyGlobalRateLimit,
  async (req, res, next) => {
    const parsed = validateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "key required" });
    try {
      const result = await openaiProvider.validateKey(parsed.data.key);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

aiRouter.get("/models", async (req, res, next) => {
  // /models is BYOK-only: the operator's list is fixed at allowlist.
  const key = await resolveByokKey(req, res);
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
  const userId = req.userId!;
  const cred = await resolveCredentialOrRespond(req, res, "ask");
  if (!cred || cred.source === "none") return;
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  // Platform users are locked to the nano allowlist even if the client
  // sends a bigger model. BYOK users use whatever they want.
  if (!enforceModelAllowlist(cred, parsed.data.model, res, "ask")) return;
  const requestId = randomUUID();
  const abort = requestAbortSignal(res);
  try {
    const result = await openaiProvider.ask({
      key: cred.key,
      model: parsed.data.model,
      fundingSource: cred.source,
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
    // Ledger write on success. For /ask both BYOK and platform rows land
    // here; BYOK is for debugging/audit only, platform rows gate the caps.
    const inTok = result.usage?.inputTokens ?? 0;
    const outTok = result.usage?.outputTokens ?? 0;
    const { costUsd, priceVersion } = safePrice(
      parsed.data.model,
      inTok,
      outTok,
      cred.source,
    );
    await safeWriteUsage(userId, {
      model: parsed.data.model,
      fundingSource: cred.source,
      route: "ask",
      countsTowardQuota: cred.source === "platform",
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd,
      priceVersion,
      status: "finish",
      requestId,
    });
    res.json(result);
  } catch (err) {
    // S-3: if OpenAI 401s on the platform key, trip the kill flag so every
    // subsequent caller short-circuits to the "paused" 503 path instead of
    // burning the same bad request. Only fires on the platform branch —
    // a BYOK 401 is the user's problem, not a platform-wide outage.
    if (
      cred.source === "platform" &&
      err instanceof AIProviderError &&
      err.status === 401
    ) {
      markPlatformAuthFailed();
    }
    // Client-close: response is already gone, no point forwarding to the
    // error handler. Timeout: pass through so the client sees a 5xx.
    if (abort.reason() === "client-close") return;
    next(err);
  } finally {
    abort.cleanup();
  }
});

aiRouter.post("/ask/stream", async (req, res) => {
  const userId = req.userId!;
  const cred = await resolveCredentialOrRespond(req, res, "ask_stream");
  if (!cred || cred.source === "none") return;
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  if (!enforceModelAllowlist(cred, parsed.data.model, res, "ask_stream")) return;
  const requestId = randomUUID();

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
  // QA-H4: track whether a terminal event (done/error) fired so we can
  // detect the abort path (provider silently returned after upstream
  // cancellation). Without this, a client Stop / network drop / timeout
  // leaves no ledger trace at all — which both obscures abuse shapes
  // (start-cancel-retry spam) and makes "where did my request go?"
  // support threads unanswerable.
  let terminalFired = false;
  const abort = requestAbortSignal(res);
  res.on("close", () => {
    closed = true;
  });

  try {
    await openaiProvider.askStream(
      {
        key: cred.key,
        model: parsed.data.model,
        fundingSource: cred.source,
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
        onDone: async (raw, sections, usage) => {
          terminalFired = true;
          const inTok = usage?.inputTokens ?? 0;
          const outTok = usage?.outputTokens ?? 0;
          const { costUsd, priceVersion } = safePrice(
            parsed.data.model,
            inTok,
            outTok,
            cred.source,
          );
          await safeWriteUsage(userId, {
            model: parsed.data.model,
            fundingSource: cred.source,
            route: "ask_stream",
            countsTowardQuota: cred.source === "platform",
            inputTokens: inTok,
            outputTokens: outTok,
            costUsd,
            priceVersion,
            status: "finish",
            requestId,
          });
          if (closed) return;
          send({ done: true, raw, sections, usage });
          done();
        },
        onError: async (message, status) => {
          terminalFired = true;
          // S-3: stream path mirror of the /ask 401 trap. Same platform-only
          // guard — a BYOK 401 must not take down the platform path.
          if (cred.source === "platform" && status === 401) {
            markPlatformAuthFailed();
          }
          await safeWriteUsage(userId, {
            model: parsed.data.model,
            fundingSource: cred.source,
            route: "ask_stream",
            countsTowardQuota: false,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            priceVersion: 1,
            status: "error",
            requestId,
          });
          if (closed) return;
          send({ error: message });
          done();
        },
      }
    );
    // QA-H4: provider returned without firing a terminal handler. That's
    // the abort path — either the client disconnected (res close) or the
    // backend deadline fired. Write an aborted ledger row so the request
    // is accounted for. countsTowardQuota=false because the learner
    // didn't actually receive help; zero tokens because OpenAI doesn't
    // emit partial usage on abort.
    if (!terminalFired) {
      await safeWriteUsage(userId, {
        model: parsed.data.model,
        fundingSource: cred.source,
        route: "ask_stream",
        countsTowardQuota: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        priceVersion: 1,
        status: "aborted",
        requestId,
      });
    }
  } finally {
    abort.cleanup();
  }
});

aiRouter.post("/summarize", async (req, res, next) => {
  const userId = req.userId!;
  const cred = await resolveCredentialOrRespond(req, res, "summarize");
  if (!cred || cred.source === "none") {
    flagIfAbuseShape(cred?.source === "none" ? cred.reason : null);
    return;
  }
  const parsed = summarizeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  if (parsed.data.history.length === 0) {
    return res.json({ summary: "" });
  }
  if (!enforceModelAllowlist(cred, parsed.data.model, res, "summarize")) return;
  const requestId = randomUUID();
  try {
    const result = await openaiProvider.summarize({
      key: cred.key,
      model: parsed.data.model,
      fundingSource: cred.source,
      history: parsed.data.history,
    });
    const inTok = result.usage?.inputTokens ?? 0;
    const outTok = result.usage?.outputTokens ?? 0;
    const { costUsd, priceVersion } = safePrice(
      parsed.data.model,
      inTok,
      outTok,
      cred.source,
    );
    // /summarize on platform is metered for $ but NOT counted against the
    // visible 30/day question budget. Users don't see summarize calls —
    // counting them would feel like cheating the learner out of their
    // budget. Caps L2/L3/L4 still apply through cost_usd.
    await safeWriteUsage(userId, {
      model: parsed.data.model,
      fundingSource: cred.source,
      route: "summarize",
      countsTowardQuota: false,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd,
      priceVersion,
      status: "finish",
      requestId,
    });
    res.json({ summary: result.summary });
  } catch (err) {
    // S-3: /summarize uses the same platform key; a 401 here is just as
    // indicative of a dead key as one from /ask. Same platform-only guard.
    if (
      cred.source === "platform" &&
      err instanceof AIProviderError &&
      err.status === 401
    ) {
      markPlatformAuthFailed();
    }
    next(err);
  }
});

// priceUsd throws if a non-allowlisted model reaches it. On BYOK we've
// seen real users paste new/future models; we don't want to 500 on them.
// Return 0 cost with the current price_version and let the ledger record
// the call as "accounted-for but not priced" — operator can query later.
function safePrice(
  model: string,
  inTok: number,
  outTok: number,
  fundingSource: "byok" | "platform",
): { costUsd: number; priceVersion: number } {
  if (fundingSource === "byok") {
    try {
      return priceUsd(model, inTok, outTok);
    } catch {
      return { costUsd: 0, priceVersion: 1 };
    }
  }
  // Platform path: model gate already ran, so priceUsd must succeed.
  return priceUsd(model, inTok, outTok);
}
