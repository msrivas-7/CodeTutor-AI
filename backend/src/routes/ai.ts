import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  estimateReservationForAsk,
  estimateReservationForSummary,
  openaiProvider,
} from "../services/ai/openaiProvider.js";
import { languageSchema } from "../services/execution/commands.js";
import {
  validateKeyUserRateLimit,
  validateKeyGlobalRateLimit,
} from "../middleware/aiRateLimit.js";
import { getOpenAIKey } from "../db/preferences.js";
import { config } from "../config.js";
import {
  resolveAICredential,
  invalidateUsageCaches,
  markPlatformAuthFailed,
  type AICredential,
  type CredentialNoneReason,
} from "../services/ai/credential.js";
import { flagSuspectApis } from "../services/ai/suspectApi.js";
import { AIProviderError, type AIAskParams } from "../services/ai/provider.js";
import {
  isPlatformAllowedModel,
  priceUsd,
} from "../services/ai/pricing.js";
import {
  aiPlatformRequests,
  aiPlatformAbuseSignals,
} from "../services/metrics.js";
import {
  registerAbortController,
  unregisterAbortController,
} from "../services/shutdown/abortRegistry.js";
import { hashUserId } from "../services/crypto/logHash.js";
import { updateUserStreak } from "../db/userStreak.js";
import {
  finalizeAIRequest,
  fingerprintAIRequest,
  releaseAIRequest,
  reserveAIRequest,
  type AIAdmissionDeniedReason,
  type FinalizeAIRequestInput,
  type ReserveAIRequestResult,
} from "../db/aiReservations.js";
import {
  getEffectiveDailyQuestionsCap,
  getEffectiveDailyUsdCap,
  getEffectiveDailyUsdCapPerUser,
  getEffectiveLifetimeUsdCapPerUser,
} from "../services/ai/effectiveCaps.js";
import { resolveCanonicalTutorContext } from "../services/ai/canonicalTutorContext.js";
import { isContextualTutorModel } from "../services/ai/modelRegistry.js";
import {
  mintTutorProgressToken,
  resolveTutorStage,
  tutorTaskScope,
} from "../services/ai/tutorProgress.js";

// Wire a per-request AbortController to (a) a config-driven deadline and
// (b) the response's `close` event, so OpenAI calls stop burning tokens
// the moment the client disconnects or the deadline hits. Returns the
// signal plus a cleanup fn; call cleanup on successful completion so the
// timer doesn't sit in the event loop for 90s after we're done.
//
// Phase 26 (audit H-6): registers with the per-user registry so admin
// freeze can fan-abort just this user's in-flight streams without
// taking down everyone else's. The userId arg is required on auth'd
// AI routes (every caller threads req.userId through here).
function requestAbortSignal(
  res: Response,
  userId: string | null,
): {
  signal: AbortSignal;
  cleanup: () => void;
  reason: () => "timeout" | "client-close" | "shutdown" | "frozen" | null;
} {
  const controller = new AbortController();
  let reason: "timeout" | "client-close" | "shutdown" | "frozen" | null = null;
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
  // S-13 (bucket 7) + Phase 26 H-6: register with the process-level
  // registry so SIGTERM can fan-abort every in-flight stream AND admin
  // freeze can fan-abort one user's streams. Each handler gets a chance
  // to write its partial ledger row before the grace window expires.
  const entry = registerAbortController(controller, userId);
  const onAbortFromRegistry = () => {
    if (reason === null && controller.signal.reason instanceof Error) {
      const msg = controller.signal.reason.message;
      if (msg.startsWith("shutdown:")) reason = "shutdown";
      else if (msg.startsWith("frozen:")) reason = "frozen";
    }
  };
  controller.signal.addEventListener("abort", onAbortFromRegistry, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      res.off("close", onClose);
      unregisterAbortController(entry);
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
    email_not_confirmed: "email_not_confirmed",
    // Phase 27 §3d: anon-only outcome. Authed routes can't actually
    // surface this (resolveAICredential never returns it), but the
    // type is shared and the map must be exhaustive.
    anon_exhausted: "anon_exhausted",
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
  if (reason === "email_not_confirmed") {
    // Phase 22A: defense-in-depth gate. The user has a JWT (so reached
    // authMiddleware) but auth.users.email_confirmed_at is null. Surface
    // a distinct error code so the frontend can prompt them to check
    // their inbox / resend the confirmation link rather than blaming
    // BYOK or the free tier.
    res.status(403).json({ error: "EMAIL_NOT_CONFIRMED", reason });
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

async function safeFinalizeUsage(
  userId: string,
  route: "ask" | "ask_stream" | "summarize",
  input: FinalizeAIRequestInput,
): Promise<void> {
  try {
    await finalizeAIRequest(input);
    invalidateUsageCaches(userId);
  } catch (err) {
    // The reservation remains active and crash recovery will conservatively
    // finalize it at the reserved maximum. Never create an unaccounted call.
    console.error(`[ai] reservation finalize failed user=${hashUserId(userId)} route=${route}:`, err);
  }
}

function reservationTtlMs(): number {
  return Math.min(config.aiRequestTimeoutMs, 60_000);
}

async function reserveUserAction(args: {
  userId: string;
  cred: Exclude<AICredential, { source: "none" }>;
  requestId: string;
  fingerprint: string;
  model: string;
  route: "ask" | "ask_stream" | "summarize";
  countsTowardQuota: boolean;
  reservedInputTokens: number;
  reservedOutputTokens: number;
}): Promise<ReserveAIRequestResult> {
  const priced = safePrice(
    args.model,
    args.reservedInputTokens,
    args.reservedOutputTokens,
    args.cred.source,
  );
  const caps =
    args.cred.source === "platform"
      ? {
          globalDailyUsd: await getEffectiveDailyUsdCap(),
          userDailyQuestions: await getEffectiveDailyQuestionsCap(args.userId),
          userDailyUsd: await getEffectiveDailyUsdCapPerUser(args.userId),
          userLifetimeUsd: await getEffectiveLifetimeUsdCapPerUser(args.userId),
        }
      : undefined;
  return reserveAIRequest({
    actorKind: "user",
    userId: args.userId,
    requestId: args.requestId,
    requestFingerprint: args.fingerprint,
    fundingSource: args.cred.source,
    model: args.model,
    route: args.route,
    countsTowardQuota: args.countsTowardQuota,
    reservedInputTokens: args.reservedInputTokens,
    reservedOutputTokens: args.reservedOutputTokens,
    reservedCostUsd: priced.costUsd,
    priceVersion: priced.priceVersion,
    expiresInMs: reservationTtlMs(),
    caps,
  });
}

function respondReservationResult(
  res: Response,
  result: Exclude<ReserveAIRequestResult, { ok: true }>,
): void {
  if (result.kind === "duplicate") {
    res.status(409).json({ error: "AI_REQUEST_ALREADY_ACCEPTED", state: result.state });
    return;
  }
  if (result.kind === "conflict") {
    res.status(409).json({ error: "AI_REQUEST_ID_CONFLICT" });
    return;
  }
  const statusByReason: Record<AIAdmissionDeniedReason, number> = {
    free_exhausted: 429,
    anon_exhausted: 429,
    daily_usd_per_user_hit: 503,
    lifetime_usd_per_user_hit: 503,
    usd_cap_hit: 503,
  };
  const error = result.reason === "free_exhausted"
    ? "FREE_TIER_EXHAUSTED"
    : "PLATFORM_AI_PAUSED";
  res.status(statusByReason[result.reason]).json({ error, reason: result.reason });
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
  requestId: z.string().uuid(),
  model: z.string().min(1),
  question: z.string().min(1),
  files: z.array(projectFileSchema).max(50),
  activeFile: z.string().optional(),
  language: languageSchema.optional(),
  lastRun: runResultSchema.nullish(),
  history: historySchema.default([]),
  tutorProgressToken: z.string().max(1_024).optional(),
  stdin: z.string().nullish(),
  diffSinceLastTurn: z.string().nullish(),
  runsSinceLastTurn: z.number().int().min(0).optional(),
  editsSinceLastTurn: z.number().int().min(0).optional(),
  persona: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  selection: selectionSchema.nullish(),
  lessonContext: z.object({
    courseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    lessonId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    exerciseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).nullish(),
  }).nullish(),
});

const summarizeBody = z.object({
  requestId: z.string().uuid(),
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
  if (!enforceModelAllowlist(cred, parsed.data.model, res, "ask")) return;

  let canonicalLessonContext = null;
  try {
    if (parsed.data.lessonContext) {
      if (!isContextualTutorModel(parsed.data.model)) {
        return res.status(403).json({ error: "MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_TUTOR" });
      }
      canonicalLessonContext = await resolveCanonicalTutorContext(
        userId,
        parsed.data.lessonContext,
      );
      if (!canonicalLessonContext) {
        return res.status(404).json({ error: "LESSON_CONTEXT_NOT_FOUND" });
      }
    }
  } catch (err) {
    console.error(`[ai] canonical context failed user=${hashUserId(userId)} route=ask:`, err);
    return res.status(503).json({ error: "LESSON_CONTEXT_UNAVAILABLE" });
  }

  const providerParams: AIAskParams = {
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
    lessonContext: canonicalLessonContext,
    tutorStage: "clarify" as const,
  };
  const progressIdentity = {
    actorId: `user:${userId}`,
    taskScope: tutorTaskScope(providerParams),
  };
  providerParams.tutorStage = resolveTutorStage(
    parsed.data.tutorProgressToken,
    progressIdentity,
  );
  let estimate;
  try {
    estimate = estimateReservationForAsk(providerParams);
  } catch (err) {
    return next(err);
  }
  let reservation: ReserveAIRequestResult;
  try {
    reservation = await reserveUserAction({
      userId,
      cred,
      requestId: parsed.data.requestId,
      fingerprint: fingerprintAIRequest({ ...parsed.data, lessonContext: canonicalLessonContext }),
      model: parsed.data.model,
      route: "ask",
      countsTowardQuota: cred.source === "platform",
      ...estimate,
    });
  } catch (err) {
    console.error(`[ai] reservation failed user=${hashUserId(userId)} route=ask:`, err);
    return res.status(503).json({ error: "AI_ADMISSION_UNAVAILABLE" });
  }
  if (!reservation.ok) {
    respondReservationResult(res, reservation);
    return;
  }

  const abort = requestAbortSignal(res, userId);
  let providerStarted = false;
  try {
    providerStarted = true;
    const result = await openaiProvider.ask({ ...providerParams, signal: abort.signal });
    // Successful provider payloads normally include exact usage. If that
    // metadata is absent, charge the admission ceiling rather than turning a
    // telemetry omission into an unmetered platform call.
    const usageKnown = result.usage !== undefined;
    const inTok = result.usage?.inputTokens ?? estimate.reservedInputTokens;
    const outTok = result.usage?.outputTokens ?? estimate.reservedOutputTokens;
    const { costUsd } = safePrice(
      parsed.data.model,
      inTok,
      outTok,
      cred.source,
    );
    await safeFinalizeUsage(userId, "ask", {
      requestId: parsed.data.requestId,
      countsTowardQuota: cred.source === "platform",
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd,
      ledgerStatus: "finish",
      providerOutcomeUncertain: !usageKnown,
    });
    // Phase A — A4: fabricated-API tripwire (measure-only).
    flagSuspectApis({
      responseText: result.raw,
      userFiles: parsed.data.files,
      userQuestion: parsed.data.question,
      language: parsed.data.language === "javascript" ? "javascript" : "python",
      route: "ask",
    });
    res.json({
      ...result,
      tutorProgressToken: mintTutorProgressToken(progressIdentity),
    });
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
    if (providerStarted) {
      const { costUsd } = safePrice(
        parsed.data.model,
        estimate.reservedInputTokens,
        estimate.reservedOutputTokens,
        cred.source,
      );
      await safeFinalizeUsage(userId, "ask", {
        requestId: parsed.data.requestId,
        countsTowardQuota: false,
        inputTokens: estimate.reservedInputTokens,
        outputTokens: estimate.reservedOutputTokens,
        costUsd,
        ledgerStatus: "aborted",
        providerOutcomeUncertain: true,
      });
    } else {
      await releaseAIRequest(parsed.data.requestId);
    }
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

  let canonicalLessonContext = null;
  try {
    if (parsed.data.lessonContext) {
      if (!isContextualTutorModel(parsed.data.model)) {
        return res.status(403).json({ error: "MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_TUTOR" });
      }
      canonicalLessonContext = await resolveCanonicalTutorContext(
        userId,
        parsed.data.lessonContext,
      );
      if (!canonicalLessonContext) {
        return res.status(404).json({ error: "LESSON_CONTEXT_NOT_FOUND" });
      }
    }
  } catch (err) {
    console.error(`[ai] canonical context failed user=${hashUserId(userId)} route=ask_stream:`, err);
    return res.status(503).json({ error: "LESSON_CONTEXT_UNAVAILABLE" });
  }

  const providerParams: AIAskParams = {
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
    lessonContext: canonicalLessonContext,
    tutorStage: "clarify" as const,
  };
  const progressIdentity = {
    actorId: `user:${userId}`,
    taskScope: tutorTaskScope(providerParams),
  };
  providerParams.tutorStage = resolveTutorStage(
    parsed.data.tutorProgressToken,
    progressIdentity,
  );
  let estimate;
  try {
    estimate = estimateReservationForAsk(providerParams);
  } catch (err) {
    return res.status(err instanceof AIProviderError && err.status ? err.status : 400)
      .json({ error: err instanceof Error ? err.message : "INVALID_AI_REQUEST" });
  }
  let reservation: ReserveAIRequestResult;
  try {
    reservation = await reserveUserAction({
      userId,
      cred,
      requestId: parsed.data.requestId,
      fingerprint: fingerprintAIRequest({ ...parsed.data, lessonContext: canonicalLessonContext }),
      model: parsed.data.model,
      route: "ask_stream",
      countsTowardQuota: cred.source === "platform",
      reservedInputTokens: estimate.reservedInputTokens,
      reservedOutputTokens: estimate.reservedOutputTokens,
    });
  } catch (err) {
    console.error(`[ai] reservation failed user=${hashUserId(userId)} route=ask_stream:`, err);
    return res.status(503).json({ error: "AI_ADMISSION_UNAVAILABLE" });
  }
  if (!reservation.ok) {
    respondReservationResult(res, reservation);
    return;
  }

  // Phase 21B: a substantive tutor question is a qualifying streak signal.
  // Fire-and-forget so the SSE stream isn't blocked on streak math; the
  // frontend refetches /streak on stream completion to drive the chip.
  // ≥4 chars after trim avoids "hi"/"k" no-ops counting as engagement.
  if (parsed.data.question.trim().length >= 4) {
    void updateUserStreak(userId).catch(() => {
      /* silent — streak is non-critical to the ask path */
    });
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
  // QA-H4: track whether a terminal event (done/error) fired so we can
  // detect the abort path (provider silently returned after upstream
  // cancellation). Without this, a client Stop / network drop / timeout
  // leaves no ledger trace at all — which both obscures abuse shapes
  // (start-cancel-retry spam) and makes "where did my request go?"
  // support threads unanswerable.
  let terminalFired = false;
  const abort = requestAbortSignal(res, userId);
  res.on("close", () => {
    closed = true;
  });

  try {
    await openaiProvider.askStream(
      { ...providerParams, signal: abort.signal },
      {
        onDelta: (chunk) => {
          if (closed) return;
          send({ delta: chunk });
        },
        onDone: async (raw, sections, usage) => {
          terminalFired = true;
          const usageKnown = usage !== undefined;
          const inTok = usage?.inputTokens ?? estimate.reservedInputTokens;
          const outTok = usage?.outputTokens ?? estimate.reservedOutputTokens;
          const { costUsd } = safePrice(
            parsed.data.model,
            inTok,
            outTok,
            cred.source,
          );
          await safeFinalizeUsage(userId, "ask_stream", {
            requestId: parsed.data.requestId,
            countsTowardQuota: cred.source === "platform",
            inputTokens: inTok,
            outputTokens: outTok,
            costUsd,
            ledgerStatus: "finish",
            providerOutcomeUncertain: !usageKnown,
          });
          // Phase A — A4: fabricated-API tripwire (measure-only).
          flagSuspectApis({
            responseText: raw,
            userFiles: parsed.data.files,
            userQuestion: parsed.data.question,
            language:
              parsed.data.language === "javascript" ? "javascript" : "python",
            route: "ask_stream",
          });
          if (closed) return;
          send({
            done: true,
            raw,
            sections,
            usage,
            tutorProgressToken: mintTutorProgressToken(progressIdentity),
          });
          done();
        },
        onError: async (message, status) => {
          terminalFired = true;
          // S-3: stream path mirror of the /ask 401 trap. Same platform-only
          // guard — a BYOK 401 must not take down the platform path.
          if (cred.source === "platform" && status === 401) {
            markPlatformAuthFailed();
          }
          const reservedPrice = safePrice(
            parsed.data.model,
            estimate.reservedInputTokens,
            estimate.reservedOutputTokens,
            cred.source,
          );
          await safeFinalizeUsage(userId, "ask_stream", {
            requestId: parsed.data.requestId,
            countsTowardQuota: false,
            inputTokens: estimate.reservedInputTokens,
            outputTokens: estimate.reservedOutputTokens,
            costUsd: reservedPrice.costUsd,
            ledgerStatus: "error",
            providerOutcomeUncertain: true,
          });
          if (closed) return;
          send({ error: message });
          done();
        },
        onAbort: async (_raw, estUsage) => {
          // SEC-C1 follow-up (audit-v2): OpenAI bills input tokens once the
          // request is accepted, plus any output tokens it emitted before
          // we aborted. Previously this path wrote cost=0 which let
          // abort-spam bypass the L2/L3/L4 dollar caps. Now we record
          // real estimated cost. `countsTowardQuota: false` is deliberate
          // — the learner saw nothing useful, so the visible 30/day
          // counter doesn't drain. But the dollar caps SEE the spend.
          terminalFired = true;
          const { costUsd } = safePrice(
            parsed.data.model,
            estUsage.inputTokens,
            estUsage.outputTokens,
            cred.source,
          );
          await safeFinalizeUsage(userId, "ask_stream", {
            requestId: parsed.data.requestId,
            countsTowardQuota: false,
            inputTokens: estUsage.inputTokens,
            outputTokens: estUsage.outputTokens,
            costUsd,
            ledgerStatus: "aborted",
            providerOutcomeUncertain: true,
          });
        },
      }
    );
    // Backstop: provider returned without firing any handler. Shouldn't
    // happen now that onAbort covers both abort paths, but write a
    // zero-cost marker so the request is traceable if it ever does.
    if (!terminalFired) {
      const reservedPrice = safePrice(
        parsed.data.model,
        estimate.reservedInputTokens,
        estimate.reservedOutputTokens,
        cred.source,
      );
      await safeFinalizeUsage(userId, "ask_stream", {
        requestId: parsed.data.requestId,
        countsTowardQuota: false,
        inputTokens: estimate.reservedInputTokens,
        outputTokens: estimate.reservedOutputTokens,
        costUsd: reservedPrice.costUsd,
        ledgerStatus: "aborted",
        providerOutcomeUncertain: true,
      });
    }
  } catch (err) {
    if (!terminalFired) {
      terminalFired = true;
      const reservedPrice = safePrice(
        parsed.data.model,
        estimate.reservedInputTokens,
        estimate.reservedOutputTokens,
        cred.source,
      );
      await safeFinalizeUsage(userId, "ask_stream", {
        requestId: parsed.data.requestId,
        countsTowardQuota: false,
        inputTokens: estimate.reservedInputTokens,
        outputTokens: estimate.reservedOutputTokens,
        costUsd: reservedPrice.costUsd,
        ledgerStatus: "error",
        providerOutcomeUncertain: true,
      });
    }
    console.error(`[ai] stream failed user=${hashUserId(userId)}:`, err);
    if (!closed) {
      send({ error: "internal_error" });
      done();
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
  let estimate;
  try {
    estimate = estimateReservationForSummary(parsed.data.history);
  } catch (err) {
    return next(err);
  }
  let reservation: ReserveAIRequestResult;
  try {
    reservation = await reserveUserAction({
      userId,
      cred,
      requestId: parsed.data.requestId,
      fingerprint: fingerprintAIRequest(parsed.data),
      model: parsed.data.model,
      route: "summarize",
      countsTowardQuota: false,
      reservedInputTokens: estimate.reservedInputTokens,
      reservedOutputTokens: estimate.reservedOutputTokens,
    });
  } catch (err) {
    console.error(`[ai] reservation failed user=${hashUserId(userId)} route=summarize:`, err);
    return res.status(503).json({ error: "AI_ADMISSION_UNAVAILABLE" });
  }
  if (!reservation.ok) {
    respondReservationResult(res, reservation);
    return;
  }
  const abort = requestAbortSignal(res, userId);
  try {
    const result = await openaiProvider.summarize({
      key: cred.key,
      model: parsed.data.model,
      fundingSource: cred.source,
      history: parsed.data.history,
      signal: abort.signal,
    });
    const usageKnown = result.usage !== undefined;
    const inTok = result.usage?.inputTokens ?? estimate.reservedInputTokens;
    const outTok = result.usage?.outputTokens ?? estimate.reservedOutputTokens;
    const { costUsd } = safePrice(
      parsed.data.model,
      inTok,
      outTok,
      cred.source,
    );
    // /summarize on platform is metered for $ but NOT counted against the
    // visible 30/day question budget. Users don't see summarize calls —
    // counting them would feel like cheating the learner out of their
    // budget. Caps L2/L3/L4 still apply through cost_usd.
    await safeFinalizeUsage(userId, "summarize", {
      requestId: parsed.data.requestId,
      countsTowardQuota: false,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd,
      ledgerStatus: "finish",
      providerOutcomeUncertain: !usageKnown,
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
    const reservedPrice = safePrice(
      parsed.data.model,
      estimate.reservedInputTokens,
      estimate.reservedOutputTokens,
      cred.source,
    );
    await safeFinalizeUsage(userId, "summarize", {
      requestId: parsed.data.requestId,
      countsTowardQuota: false,
      inputTokens: estimate.reservedInputTokens,
      outputTokens: estimate.reservedOutputTokens,
      costUsd: reservedPrice.costUsd,
      ledgerStatus: "error",
      providerOutcomeUncertain: true,
    });
    if (abort.reason() !== "client-close") next(err);
  } finally {
    abort.cleanup();
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
