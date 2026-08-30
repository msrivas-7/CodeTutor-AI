// Phase 27 §3a — anonymous (signed-out) lesson endpoints.
//
// Two routes, both unauthenticated:
//   POST /api/anon/run             one-shot Python execution
//   POST /api/anon/ai/ask/stream   anon AI tutor SSE stream
//
// The anon route surface is intentionally narrow: just the two
// endpoints lesson 1 needs (run + tutor). Save / progress / streak
// surfaces have no anon variant — those trigger the SignupWallDialog
// on the frontend instead.
//
// Defenses (no auth, no CSRF, no session):
//   - aiRateLimit at mount time: 60 req/min per IP (bucketKey falls
//     to ip:<ip> when req.userId is absent).
//   - L_anon cap (Phase 27 §3d): 8 platform AI questions per IP per
//     UTC day, enforced by resolveAnonAICredential.
//   - Combined L4 $ cap (authed + anon): anon spend can't blow past
//     the operator wallet ceiling.
//   - Per-request output-token cap: anonMaxOutputTokens=512 (config).
//   - Provider-side: 25s deadline + 250KB prompt-size guard (Phase 27 §3b).
//   - Sandbox egress controls (Phase 27 §3c): network blocked, host
//     files unreadable.
//   - Allowlist: only the hello-world lesson context is accepted on
//     the AI route; the run route accepts any Python code (the
//     execution sandbox is the defense, not the lesson allowlist).
//
// CSRF is intentionally OFF: there's no session cookie an attacker
// could trick a user's browser into sending. The worst a CSRF
// attack does is consume the user's per-IP anon budget — bounded.

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import {
  isAiEvalSamplingEnabled,
  isAnonLessonEnabled,
} from "../services/share/killSwitches.js";
import { anonLaptopInviteRouter } from "./anonLaptopInvite.js";
import { anonShareRouter } from "./anonShare.js";
import { anonConceptTagRouter } from "./anonConceptTag.js";
import { runProject } from "../services/execution/router.js";
import { languageSchema } from "../services/execution/commands.js";
import type { ExecutionBackend, RuntimeSpec } from "../services/execution/backends/index.js";
import { execDuration } from "../services/metrics.js";
import { sessionCreateLimit } from "../middleware/mutationRateLimit.js";
import { estimateReservationForAsk, openaiProvider } from "../services/ai/openaiProvider.js";
import {
  isPlatformAllowedModel,
  priceUsd,
} from "../services/ai/pricing.js";
import {
  resolveAnonAICredential,
  invalidateAnonUsageCaches,
  markPlatformAuthFailed,
  type CredentialNoneReason,
} from "../services/ai/credential.js";
import { incrementAnonRunCount } from "../db/anonRunCounts.js";
import {
  deleteEvalSamplesForSubjectToken,
  EvalSampleRevocationQuotaError,
  insertEvalSample,
} from "../db/aiEvalSamples.js";
import {
  getEffectiveAnonDailyRunsPerIp,
  getEffectiveAnonDailyUsdCap,
  getEffectiveDailyUsdCap,
} from "../services/ai/effectiveCaps.js";
import { hashClientIp } from "../services/ai/ipHash.js";
import { flagSuspectApis } from "../services/ai/suspectApi.js";
import {
  registerAbortController,
  unregisterAbortController,
} from "../services/shutdown/abortRegistry.js";
import {
  aiPlatformRequests,
  aiPlatformAbuseSignals,
} from "../services/metrics.js";
import {
  cancelAIRequest,
  finalizeAIRequest,
  fingerprintAIRequest,
  reserveAIRequest,
  type FinalizeAIRequestInput,
} from "../db/aiReservations.js";
import { closeTutorTurnAtAllowanceBoundary } from "../services/ai/tutorPolicy.js";
import {
  resolveCanonicalAnonTutorContext,
  resolveCanonicalContextualTutorOffer,
} from "../services/ai/canonicalTutorContext.js";
import {
  isContextualTutorModel,
  isEvaluatedContextualOfferModel,
} from "../services/ai/modelRegistry.js";
import { isContextualTutorEnabled } from "../services/ai/contextualTutor.js";
import {
  canonicalTutorRequestModel,
  routeTutorModel,
} from "../services/ai/modelRouting.js";
import { getEffectivePlatformTutorModel } from "../services/ai/platformTutorModel.js";
import type {
  AIAskParams,
  TutorIntent,
  TutorSections,
  TutorStage,
} from "../services/ai/provider.js";
import {
  AI_EVAL_CONSENT_VERSION,
  projectEvalSample,
  shouldSampleEvalRequest,
  type EvalSamplingConsent,
} from "../services/ai/evalSampling.js";
import {
  mintTutorProgressToken,
  resolveTutorStage,
  tutorTaskScope,
} from "../services/ai/tutorProgress.js";

// Anon AI is locked to lesson 1 of python-fundamentals. The marketing
// surface (/try/lesson/...) only links to this one lesson; this server-
// side check is defense-in-depth so a hand-crafted POST can't smuggle
// a bigger lessonContext through.
const ANON_ALLOWED_LESSON = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
} as const;

// Phase 24B-resize: anon /run sessions are ephemeral and never registered
// with sessionManager (one-shot, destroyed in the same request's finally).
// But they DO consume HybridBackend.localActive — the routing decision
// against the local cap is "any session in flight," authed or not. The
// admin dashboard's Sessions tile reads from sessionManager only, so
// without these counters anon traffic is invisible there: a 4-anon /
// 0-authed state would render as `0/5` while real localActive=4.
//
// Tracked here (route-local) rather than on the handle because the
// HybridBackend doesn't know an anon session from an authed one — both
// arrive via createSession(spec). Increment after createSession resolves
// (so a failed spawn doesn't inflate the gauge); decrement in the same
// finally that destroys the handle. dispatch on handle.__kind to split
// local vs ACI accurately.
let anonLocalActive = 0;
let anonAciActive = 0;
export function getAnonSessionCounts() {
  return { local: anonLocalActive, aci: anonAciActive };
}

// File-shape validation mirrored from authed AI route. Only Python is
// expected on this surface; the languageSchema gate at the executor
// already rejects everything else.
const safePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._/-]+$/);

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

// Run-request body. Anon doesn't have a sessionId — we mint a
// per-request session below. `language` is locked to python at the
// allowlist layer; the schema accepts the full enum so we get
// language-specific error messages from the executor if a future
// anon lesson uses something else.
const runBody = z.object({
  language: languageSchema,
  files: z.array(projectFileSchema).max(10),
  stdin: z.string().max(10_000).optional(),
});

// Ask-stream body. Subset of authed askBody — anon doesn't have BYOK,
// streaks, or per-user history syncing.
const askStreamBody = z.object({
  requestId: z.string().uuid(),
  model: z.string().min(1).optional(),
  question: z.string().min(1).max(4_000),
  tutorAction: z.enum([
    "explain-lesson-task",
    "stronger-hint",
    "explain-more",
    "concrete-example",
    "why-it-matters",
    "contextual-help",
  ]).optional(),
  files: z.array(projectFileSchema).max(10),
  activeFile: z.string().optional(),
  // Top-level language intentionally omitted on the anon body — the
  // language is pinned by lessonContext.language below, and the anon
  // lesson allowlist locks the lesson to python-fundamentals/hello-
  // world. Letting an anon caller smuggle a different top-level
  // language would land in the prompt builder as confused tutor
  // copy. authed askBody keeps the optional top-level language for
  // editor-mode (no lessonContext) callers; anon has no editor path.
  lastRun: runResultSchema.nullish(),
  history: historySchema.default([]),
  tutorProgressToken: z.string().max(1_024).optional(),
  stdin: z.string().nullish(),
  runsSinceLastTurn: z.number().int().min(0).optional(),
  editsSinceLastTurn: z.number().int().min(0).optional(),
  // lessonContext is REQUIRED on anon — narrows the surface to the
  // hello-world lesson. Authed callers can omit it for the editor
  // tutor, but anon has no editor-tutor path.
  lessonContext: z.object({
    courseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    lessonId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    exerciseId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).nullish(),
  }),
  contextualOffer: z.object({
    contextVersion: z.literal(0),
    contextEpoch: z.string().min(1).max(256),
    projectRevision: z.number().int().min(0),
    moveId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    evidence: z.object({
      code: z.literal("python-unclosed-parenthesis"),
      path: safePathSchema,
      line: z.number().int().min(1).max(100_000),
    }),
    scaffoldLevel: z.literal(1),
  }).optional(),
  // B8 is explicit opt-in and anonymous-platform-only. The browser owns the
  // opaque deletion token; only its domain-separated hash can be persisted.
  evalSamplingConsent: z.object({
    version: z.literal(AI_EVAL_CONSENT_VERSION),
    subjectToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }).optional(),
}).superRefine((body, ctx) => {
  if (body.contextualOffer && body.tutorAction !== "contextual-help") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contextualOffer"],
      message: "contextualOffer requires contextual-help action",
    });
  }
});

const cancelAskBody = z.object({ requestId: z.string().uuid() }).strict();

const deleteEvalSamplesBody = z.object({
  subjectToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

function safePrice(
  model: string,
  inTok: number,
  outTok: number,
): { costUsd: number; priceVersion: number } {
  // Anonymous AI is always platform-funded. Unknown models must fail loudly
  // rather than becoming zero-cost ledger rows that bypass dollar caps.
  return priceUsd(model, inTok, outTok);
}

async function safeFinalizeAnonUsage(
  input: FinalizeAIRequestInput,
): Promise<void> {
  try {
    await finalizeAIRequest(input);
    invalidateAnonUsageCaches();
  } catch (err) {
    console.error(
      `[anon] reservation finalize failed request=${input.requestId}:`,
      (err as Error).message,
    );
  }
}

async function visibleAnonRemainingAfterTutorTurn(
  ipHash: string,
  reservedRemaining: number | null,
  countsTowardQuota: boolean,
): Promise<number | null> {
  if (countsTowardQuota) return reservedRemaining;
  const refreshed = await resolveAnonAICredential(ipHash);
  if (refreshed.source === "platform") return refreshed.remainingToday;
  return reservedRemaining == null ? null : reservedRemaining + 1;
}

function reservationTtlMs(): number {
  return Math.min(config.aiRequestTimeoutMs, 60_000);
}

// Map the resolver's "none" reason onto an HTTP response. Mirrors the
// authed handler at routes/ai.ts but the set of reasons that can
// surface on anon is much smaller — see resolveAnonAICredential's
// chain at services/ai/credential.ts.
function respondAnonCredentialDenied(
  res: Response,
  reason: CredentialNoneReason,
  route: "ask_stream",
): void {
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
    anon_exhausted: "anon_exhausted",
  };
  aiPlatformRequests.inc({ outcome: outcomeByReason[reason], route });

  if (reason === "anon_exhausted") {
    // 429 keeps the contract symmetric with FREE_TIER_EXHAUSTED. The
    // frontend SignupWallDialog reads this and pivots to "Sign up to
    // keep going" instead of the generic 30/day exhaustion card.
    res.status(429).json({ error: "ANON_EXHAUSTED", reason });
    return;
  }
  if (reason === "no_key") {
    // free tier off and no platform key — anon has no recovery path.
    res.status(503).json({ error: "PLATFORM_AI_PAUSED", reason });
    return;
  }
  // free_disabled / usd_cap_hit / provider_auth_failed → "paused" 503.
  // Other reasons (per-user $, denylisted, email_not_confirmed) cannot
  // surface on the anon path by construction; map them to 503 anyway
  // so a future resolver change doesn't silently drop a denial.
  res.status(503).json({ error: "PLATFORM_AI_PAUSED", reason });
}

export function createAnonRouter(backend: ExecutionBackend): Router {
  const router = Router();

  // Privacy controls stay available even when the trial product is drained.
  // The token is 256 bits of browser-generated entropy and acts only as a
  // delete capability; the server stores its hash and returns no row count.
  router.delete("/eval-samples", async (req, res, next) => {
    const parsed = deleteEvalSamplesBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_EVAL_DELETION_TOKEN" });
    }
    try {
      await deleteEvalSamplesForSubjectToken(parsed.data.subjectToken);
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof EvalSampleRevocationQuotaError) {
        return res.status(429).json({ error: "EVAL_DELETION_RATE_LIMITED" });
      }
      next(err);
    }
  });

  // Phase 27-v2 quick fix #5: kill switch. If ENABLE_ANON_LESSON=0,
  // every anon route short-circuits to 503 before doing any work
  // (no DB read, no provider call, no container spawn). Mounted as
  // the FIRST middleware on the router so it runs before any of the
  // per-route validators. Operator flips this for incident response
  // — abuse spike, paused trial, suspected platform-key leak — and
  // restarts; no redeploy. Returns a stable error code the
  // frontend's anon page can branch on to show a "trial paused,
  // please sign up" fallback rather than a generic 503.
  // Phase 27-v2.2 Fix 7c: read the kill switch from system_config first
  // (admin-toggleable via /api/admin/system-config without redeploy);
  // env (ENABLE_ANON_LESSON, surfaced as config.anonLessonEnabled)
  // is the boot-time default + DB-unreachable fallback.
  // isAnonLessonEnabled() is async but served from a 60s in-process
  // cache — hot-path cost on every anon request is a Map lookup, not
  // a query. Same pattern as the share kill switches.
  router.use((_req, res, next) => {
    void (async () => {
      try {
        const enabled = await isAnonLessonEnabled();
        if (!enabled) {
          res.status(503).json({ error: "ANON_LESSON_DISABLED" });
          return;
        }
        next();
      } catch {
        // Belt-and-suspenders: readBool already returns the env fallback
        // on any throw, so this catch is unreachable in practice. Kept
        // so a future readBool refactor that lets a throw escape can't
        // open the anon path by accident — same fail-closed-on-disable
        // shape as the inner branch above.
        if (!config.anonLessonEnabled) {
          res.status(503).json({ error: "ANON_LESSON_DISABLED" });
          return;
        }
        next();
      }
    })();
  });

  // -------- POST /api/anon/run -----------------------------------------
  // One-shot Python execution. Creates an ephemeral session per request;
  // tears it down in a finally block so a thrown executor doesn't leak
  // containers. Slow path (~3s container creation overhead each) — the
  // anon surface only ever runs lesson 1 a handful of times per visitor,
  // so the cold-start cost is acceptable for v0 without a warm pool.
  //
  // sessionCreateLimit is the load-bearing floor here: container
  // creation is the expensive op, and authed traffic gates /api/session
  // on the same limiter (30/min/IP). Without this, anon could spawn
  // 60 containers/min/IP (the aiRateLimit ceiling), 2x the authed
  // budget, with no signup friction. Applied at the route level (not
  // the mount) so the cheaper /ai/ask/stream endpoint keeps the looser
  // 60/min budget for the natural "ask hint, run code, ask another
  // hint" cadence.
  router.post("/run", sessionCreateLimit, async (req, res, next) => {
    const parsed = runBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const { language, files, stdin } = parsed.data;

    // Phase A — A5 (operational floor): per-IP daily spawn cap. The
    // per-minute sessionCreateLimit above bounds bursts; this bounds
    // sustained abuse (a patient IP could otherwise spawn ~43k
    // containers per UTC day inside the per-minute budget). Same
    // req.ip fail-loud guard as ask/stream — an empty req.ip means
    // the trust-proxy chain is misconfigured and every caller would
    // share one counter bucket.
    if (!req.ip) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "anon_run_no_ip",
          msg: "req.ip empty — trust-proxy chain misconfigured",
        }),
      );
      return res.status(503).json({ error: "CLIENT_IDENTITY_UNKNOWN" });
    }
    try {
      const runsToday = await incrementAnonRunCount(hashClientIp(req.ip));
      const runCap = await getEffectiveAnonDailyRunsPerIp();
      if (runsToday > runCap) {
        aiPlatformAbuseSignals.inc({ signal: "anon_run_cap_exceeded" });
        // Structured emit so KQL alerting can watch this independent
        // of the in-process Prom counter (same C5 pattern as the
        // lesson-allowlist signal above).
        console.warn(
          JSON.stringify({
            level: "warn",
            evt: "anon_abuse_signal",
            signal: "anon_run_cap_exceeded",
            runsToday,
            runCap,
          }),
        );
        return res.status(429).json({ error: "ANON_RUN_CAP_EXCEEDED" });
      }
    } catch (err) {
      // Fail-open on counter errors: the per-minute limiter still
      // bounds worst-case cost, and blocking every anon learner on a
      // DB blip is the worse failure. Log so a sustained outage of
      // the shield is visible.
      console.error(
        JSON.stringify({
          level: "error",
          evt: "anon_run_count_error",
          msg: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Ephemeral runtime spec. RuntimeSpec is sessionId-only at this
    // layer (the language is passed to runProject below). We mint a
    // UUID prefixed with "anon-" so localDocker / ACI logs visibly
    // distinguish anon containers from authed sessions when an op
    // tails the runtime — searches like `grep anon-` cleanly isolate
    // the anon population.
    const spec: RuntimeSpec = {
      sessionId: `anon-${randomUUID()}`,
    };
    let handle: Awaited<ReturnType<typeof backend.createSession>> | null = null;
    let responseFinished = false;
    const cancelOnDisconnect = () => {
      if (responseFinished || !handle) return;
      void backend.cancel(handle).catch((error) => {
        console.warn(`[anon] cancel on disconnect failed: ${(error as Error).message}`);
      });
    };
    res.once("close", cancelOnDisconnect);
    try {
      handle = await backend.createSession(spec);
      if (handle.__kind === "aci") anonAciActive += 1;
      else anonLocalActive += 1;
      await backend.writeFiles(handle, files);
      const started = Date.now();
      const result = await runProject(backend, { handle, language, stdin });
      execDuration.observe(
        { language, ok: result.exitCode === 0 ? "true" : "false" },
        (Date.now() - started) / 1000,
      );
      responseFinished = true;
      res.json(result);
    } catch (err) {
      next(err);
    } finally {
      res.off("close", cancelOnDisconnect);
      if (handle) {
        try {
          await backend.destroy(handle);
        } catch (err) {
          // Container teardown failure is non-fatal — the backend's GC
          // sweep will catch orphans. Log so a pattern surfaces.
          console.error(
            `[anon] session destroy failed: ${(err as Error).message}`,
          );
        }
        if (handle.__kind === "aci") anonAciActive -= 1;
        else anonLocalActive -= 1;
      }
    }
  });

  router.post("/ai/ask/cancel", async (req, res) => {
    const parsed = cancelAskBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }
    if (!req.ip) {
      return res.status(503).json({ error: "CLIENT_IDENTITY_UNKNOWN" });
    }
    try {
      const state = await cancelAIRequest(parsed.data.requestId, {
        actorKind: "anonymous",
        ipHash: hashClientIp(req.ip),
      });
      if (!state) return res.status(404).json({ error: "AI_REQUEST_NOT_FOUND" });
      invalidateAnonUsageCaches();
      return res.status(204).end();
    } catch (err) {
      console.error("[anon] cancellation failed:", err);
      return res.status(503).json({ error: "AI_CANCELLATION_UNAVAILABLE" });
    }
  });

  // -------- POST /api/anon/ai/ask/stream -------------------------------
  // SSE stream of tutor JSON sections. Mirrors /api/ai/ask/stream but:
  //   - resolveAnonAICredential(ipHash) instead of resolveAICredential
  //   - writeAnonUsageRow on completion (no per-user denorm)
  //   - maxOutputTokens clamped to anonMaxOutputTokens (512) at the
  //     provider level via the explicit param
  //   - lessonContext is REQUIRED and locked to ANON_ALLOWED_LESSON
  router.post("/ai/ask/stream", async (req, res) => {
    const parsed = askStreamBody.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    // Lesson-context allowlist: only hello-world is anon-accessible.
    // Phase 27-v2.2 audit fix C3: only the (courseId, lessonId) tuple
    // from the client is consulted. Everything else flows from the
    // server-pinned ANON_PINNED_LESSON_CONTEXT — see the constant for
    // why. Discarding parsed.data.lessonContext.* (other than the
    // allowlist tuple) closes the prompt-injection vector flagged by
    // the security lane.
    const clientCtx = parsed.data.lessonContext;
    if (
      clientCtx.courseId !== ANON_ALLOWED_LESSON.courseId ||
      clientCtx.lessonId !== ANON_ALLOWED_LESSON.lessonId
    ) {
      aiPlatformAbuseSignals.inc({ signal: "anon_lesson_not_allowed" });
      // Phase 27-v2.2 audit fix C5 (staff-sre): structured log emit so
      // log-based alerting (KQL on ContainerLog) can fire on this signal
      // independent of the in-process Prom counter (which resets on
      // backend restart and isn't scraped externally). Each signal
      // carries the rejected (courseId, lessonId) so the operator can
      // distinguish honest errors from someone iterating values.
      console.warn(
        JSON.stringify({
          level: "warn",
          evt: "anon_abuse_signal",
          signal: "anon_lesson_not_allowed",
          courseId: clientCtx.courseId,
          lessonId: clientCtx.lessonId,
        }),
      );
      return res.status(403).json({ error: "LESSON_NOT_ALLOWED_ANON" });
    }
    // Anonymous tutoring is always platform-funded. Canonicalize the model
    // before validation so old tabs cannot fail and handcrafted requests
    // cannot promote themselves to a costlier operator-funded model.
    const platformModel = (await getEffectivePlatformTutorModel()).model;
    const requestModel = canonicalTutorRequestModel({
      requestedModel: parsed.data.model,
      fundingSource: "platform",
      platformModel,
    });
    if (!isPlatformAllowedModel(requestModel)) {
      aiPlatformRequests.inc({ outcome: "model_rejected", route: "ask_stream" });
      aiPlatformAbuseSignals.inc({ signal: "model_rejection" });
      console.warn(
        JSON.stringify({
          level: "warn",
          evt: "anon_abuse_signal",
          signal: "model_rejection",
          model: requestModel,
        }),
      );
      return res.status(403).json({ error: "MODEL_NOT_ALLOWED" });
    }
    if (!isContextualTutorModel(requestModel)) {
      return res.status(403).json({ error: "MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_TUTOR" });
    }
    let ctx;
    try {
      ctx = await resolveCanonicalAnonTutorContext(clientCtx);
    } catch (err) {
      console.error("[anon] canonical lesson context failed:", err);
      return res.status(503).json({ error: "LESSON_CONTEXT_UNAVAILABLE" });
    }
    if (!ctx) {
      return res.status(404).json({ error: "LESSON_CONTEXT_NOT_FOUND" });
    }
    let canonicalContextualOffer = null;
    if (parsed.data.contextualOffer) {
      try {
        if (!(await isContextualTutorEnabled())) {
          return res.status(503).json({ error: "CONTEXTUAL_TUTOR_DISABLED" });
        }
        if (!isEvaluatedContextualOfferModel(requestModel)) {
          return res.status(403).json({ error: "MODEL_NOT_EVALUATED_FOR_CONTEXTUAL_OFFER" });
        }
        canonicalContextualOffer = await resolveCanonicalContextualTutorOffer(
          clientCtx,
          parsed.data.contextualOffer,
          parsed.data.files,
          parsed.data.lastRun,
        );
      } catch (err) {
        console.error("[anon] canonical contextual offer failed:", err);
        return res.status(503).json({ error: "LESSON_CONTEXT_UNAVAILABLE" });
      }
      if (!canonicalContextualOffer) {
        return res.status(409).json({ error: "CONTEXTUAL_EVIDENCE_STALE" });
      }
    }

    // Phase 27-v2.2 audit fix (staff-security P2 + bug-hunter P3):
    // refuse the request if Express couldn't populate req.ip. Pre-fix,
    // empty-string fallthrough hashed to a stable digest, collapsing
    // every unknown-IP caller into one shared L_anon=8 bucket — first
    // such request burned the quota for everyone (legitimate users
    // affected by trust-proxy misconfig). Fail-loud here so the operator
    // sees the misconfig and fixes it instead of silently fail-closing
    // legitimate users.
    if (!req.ip) {
      console.error(
        JSON.stringify({
          level: "error",
          evt: "anon_ask_stream_no_ip",
          msg: "req.ip empty — trust-proxy chain misconfigured",
        }),
      );
      return res.status(503).json({ error: "CLIENT_IDENTITY_UNKNOWN" });
    }
    const ipHash = hashClientIp(req.ip);
    const cred = await resolveAnonAICredential(ipHash);
    if (cred.source === "none") {
      respondAnonCredentialDenied(res, cred.reason, "ask_stream");
      return;
    }
    if (cred.source !== "platform") {
      // resolveAnonAICredential never returns "byok" — but TS narrows
      // exhaustively so a future resolver tweak that DID return BYOK
      // would surface here as an explicit refusal rather than a
      // miscategorization on the anon path.
      aiPlatformRequests.inc({ outcome: "byok_unexpected_anon", route: "ask_stream" });
      return res.status(500).json({ error: "ANON_CREDENTIAL_UNEXPECTED" });
    }
    aiPlatformRequests.inc({ outcome: "served", route: "ask_stream" });

    const providerParams: AIAskParams = {
      key: cred.key,
      model: requestModel,
      fundingSource: "platform" as const,
      question: parsed.data.question,
      tutorAction: parsed.data.tutorAction,
      files: parsed.data.files,
      activeFile: parsed.data.activeFile,
      language: ctx.language,
      lastRun: parsed.data.lastRun ?? null,
      history: parsed.data.history,
      stdin: parsed.data.stdin ?? null,
      runsSinceLastTurn: parsed.data.runsSinceLastTurn,
      editsSinceLastTurn: parsed.data.editsSinceLastTurn,
      lessonContext: ctx,
      contextualOffer: canonicalContextualOffer,
      maxOutputTokens: config.freeTier.anonMaxOutputTokens,
      tutorStage: "clarify" as const,
    };
    const progressIdentity = {
      actorId: `anonymous:${ipHash}`,
      taskScope: tutorTaskScope(providerParams),
    };
    providerParams.tutorStage = resolveTutorStage(
      parsed.data.tutorProgressToken,
      progressIdentity,
    );
    let routedIntent: TutorIntent;
    try {
      const route = routeTutorModel({
        requestedModel: requestModel,
        fundingSource: "platform",
        question: parsed.data.question,
        files: parsed.data.files,
        history: parsed.data.history,
        tutorStage: providerParams.tutorStage,
        platformModel,
      });
      providerParams.model = route.model;
      routedIntent = route.intent;
    } catch (err) {
      console.error("[anon] model routing failed:", err);
      return res.status(503).json({ error: "AI_MODEL_ROUTING_UNAVAILABLE" });
    }
    const evalSamplingEnabled =
      parsed.data.evalSamplingConsent !== undefined &&
      shouldSampleEvalRequest(parsed.data.requestId)
        ? await isAiEvalSamplingEnabled()
        : false;
    let estimate;
    try {
      estimate = estimateReservationForAsk(providerParams);
    } catch (err) {
      const status = err instanceof Error && "status" in err
        ? Number((err as { status?: number }).status) || 400
        : 400;
      return res.status(status).json({
        error: err instanceof Error ? err.message : "INVALID_AI_REQUEST",
      });
    }
    const reservedPrice = safePrice(
      providerParams.model,
      estimate.reservedInputTokens,
      estimate.reservedOutputTokens,
    );
    let reservation;
    try {
      const [globalDailyUsd, anonDailyUsd] = await Promise.all([
        getEffectiveDailyUsdCap(),
        getEffectiveAnonDailyUsdCap(),
      ]);
      reservation = await reserveAIRequest({
        actorKind: "anonymous",
        ipHash,
        requestId: parsed.data.requestId,
        requestFingerprint: fingerprintAIRequest({
          ...parsed.data,
          model: requestModel,
          lessonContext: ctx,
          contextualOffer: canonicalContextualOffer,
        }),
        fundingSource: "platform",
        model: providerParams.model,
        route: "ask_stream",
        countsTowardQuota: true,
        reservedInputTokens: estimate.reservedInputTokens,
        reservedOutputTokens: estimate.reservedOutputTokens,
        reservedCostUsd: reservedPrice.costUsd,
        priceVersion: reservedPrice.priceVersion,
        expiresInMs: reservationTtlMs(),
        caps: {
          globalDailyUsd,
          anonDailyQuestions: config.freeTier.anonDailyQuestionsPerIp,
          anonDailyUsd,
        },
      });
    } catch (err) {
      console.error("[anon] reservation failed:", err);
      return res.status(503).json({ error: "AI_ADMISSION_UNAVAILABLE" });
    }
    if (!reservation.ok) {
      if (reservation.kind === "duplicate") {
        return res.status(409).json({
          error: "AI_REQUEST_ALREADY_ACCEPTED",
          state: reservation.state,
        });
      }
      if (reservation.kind === "conflict") {
        return res.status(409).json({ error: "AI_REQUEST_ID_CONFLICT" });
      }
      respondAnonCredentialDenied(res, reservation.reason, "ask_stream");
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (event: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const finish = (): void => {
      res.end();
    };

    let closed = false;
    let terminalFired = false;
    res.on("close", () => {
      closed = true;
    });

    // Per-request abort: client-close signal + process-level shutdown
    // registry. The provider's own deadline (Phase 27 §3b:
    // REQUEST_DEADLINE_MS=25s) gives the upstream-stall backstop.
    //
    // Phase 27-v2.2 audit fix C2 (staff-sre): pre-fix, the anon SSE
    // handler did NOT register with abortRegistry. On SIGTERM in-flight
    // anon streams kept burning OpenAI tokens until the upstream
    // deadline. More importantly, when the operator flipped
    // anon_lesson_enabled=false to drain abuse, NEW requests got 503
    // — but EXISTING streams continued to completion, prolonging
    // damage by minutes. Registering the controller (with userId=null
    // since anon has no user) makes the kill switch's drain semantic
    // honest: the operator can call abortRegistry.abortAll() during
    // an incident to stop all in-flight anon streams alongside SIGTERM.
    const controller = new AbortController();
    const registryEntry = registerAbortController(controller, null);
    const onClose = (): void => controller.abort();
    res.on("close", onClose);

    try {
      await openaiProvider.askStream(
        { ...providerParams, signal: controller.signal },
        {
          onDelta: (chunk) => {
            if (closed) return;
            send({ delta: chunk });
          },
          onDone: async (raw, sections, usage, providerHasTeachingValue) => {
            terminalFired = true;
            const hasTeachingValue = providerHasTeachingValue !== false;
            const countsTowardQuota = hasTeachingValue;
            const usageKnown = usage !== undefined;
            const inTok = usage?.inputTokens ?? estimate.reservedInputTokens;
            const outTok = usage?.outputTokens ?? estimate.reservedOutputTokens;
            const { costUsd } = safePrice(
              providerParams.model,
              inTok,
              outTok,
            );
            await safeFinalizeAnonUsage({
              requestId: parsed.data.requestId,
              countsTowardQuota,
              inputTokens: inTok,
              outputTokens: outTok,
              costUsd,
              ledgerStatus: "finish",
              providerOutcomeUncertain: !usageKnown,
            });
            // Phase B7: calibrated suspect-symbol telemetry. This
            // fire-and-forget scan emits a bounded tutor_suspect_api event
            // and counter without touching the learner's stream.
            flagSuspectApis({
              responseText: raw,
              userFiles: parsed.data.files,
              userQuestion: parsed.data.question,
              language: ctx.language === "python" ? "python" : "javascript",
              route: "anon_ask_stream",
            });
            if (closed) return;
            const remainingToday = await visibleAnonRemainingAfterTutorTurn(
              ipHash,
              reservation.remainingToday,
              countsTowardQuota,
            );
            const visibleSections = closeTutorTurnAtAllowanceBoundary(
              sections,
              remainingToday,
            );
            send({
              done: true,
              raw: visibleSections === sections
                ? raw
                : JSON.stringify(visibleSections),
              sections: visibleSections,
              usage,
              remainingToday,
              countsTowardQuota,
              tutorProgressToken: hasTeachingValue
                ? mintTutorProgressToken(progressIdentity)
                : parsed.data.tutorProgressToken ?? null,
            });
            finish();
            if (evalSamplingEnabled && parsed.data.evalSamplingConsent) {
              // Optional quality collection begins only after the successful
              // response is delivered. Pre-insert redaction runs immediately;
              // the database write cannot extend learner-visible latency.
              void safeCaptureEvalSample({
                requestId: parsed.data.requestId,
                consent: parsed.data.evalSamplingConsent,
                model: providerParams.model,
                language: ctx.language,
                courseId: ctx.courseId,
                lessonId: ctx.lessonId,
                intent: routedIntent,
                tutorStage: providerParams.tutorStage!,
                question: parsed.data.question,
                files: parsed.data.files,
                history: parsed.data.history,
                lastRun: parsed.data.lastRun ?? null,
                sections: visibleSections,
              });
            }
          },
          onError: async (message, status) => {
            terminalFired = true;
            if (status === 401) markPlatformAuthFailed();
            await safeFinalizeAnonUsage({
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
            finish();
          },
          onAbort: async (_raw, estUsage) => {
            terminalFired = true;
            const { costUsd } = safePrice(
              providerParams.model,
              estUsage.inputTokens,
              estUsage.outputTokens,
            );
            await safeFinalizeAnonUsage({
              requestId: parsed.data.requestId,
              // countsTowardQuota=false: learner saw nothing useful,
              // so the per-IP daily counter doesn't drain. L4 still
              // sees the spend via cost_usd.
              countsTowardQuota: false,
              inputTokens: estUsage.inputTokens,
              outputTokens: estUsage.outputTokens,
              costUsd,
              ledgerStatus: "aborted",
              providerOutcomeUncertain: true,
            });
          },
        },
      );
      if (!terminalFired) {
        await safeFinalizeAnonUsage({
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
      // Phase 27-v2.2 audit fix (fresh-eyes P2-A): defense-in-depth
      // around openaiProvider.askStream. Today the provider drives
      // every terminal through callbacks (onError, onAbort, onDone)
      // and never throws — but a future refactor that lets a throw
      // escape would (without this catch) silently leave the SSE
      // connection hanging with no terminal frame written. Symmetric
      // to the existing onError callback: write an aborted-status
      // ledger row, send {error}, finish.
      if (!terminalFired) {
        await safeFinalizeAnonUsage({
          requestId: parsed.data.requestId,
          countsTowardQuota: false,
          inputTokens: estimate.reservedInputTokens,
          outputTokens: estimate.reservedOutputTokens,
          costUsd: reservedPrice.costUsd,
          ledgerStatus: "error",
          providerOutcomeUncertain: true,
        });
      }
      console.error(
        JSON.stringify({
          level: "error",
          evt: "anon_ask_stream_unhandled",
          msg: (err as Error).message,
        }),
      );
      if (!closed) {
        send({ error: "internal_error" });
        finish();
      }
    } finally {
      res.off("close", onClose);
      // Phase 27-v2.2 audit fix C2: unregister so the entry doesn't
      // pile up in the registry across thousands of anon requests.
      unregisterAbortController(registryEntry);
    }
  });

  // Phase A — A2 (device contract): magic-link graduation handoff. The
  // route lives inside createAnonRouter so it inherits the
  // anon_lesson_enabled kill switch (above) — when anon is fully
  // disabled the laptop-link route 503s for the same reason as /run.
  // Granular `anon_laptop_invite_disabled` is checked inside the route
  // handler.
  router.use(anonLaptopInviteRouter);

  // Phase A — A3 (anon-share unlock): per-IP-hashed share creation.
  // Same kill-switch-chain inheritance as the laptop-link route. The
  // granular kill is `share_create_disabled` (Phase 21C), checked
  // inside the route handler — so an operator can drain anon-share
  // abuse via the same switch that already drains authed-share abuse,
  // without nuking the entire trial path.
  router.use(anonShareRouter);

  // Phase A — A6 (memory v0): write-only concept-tag ledger for the
  // anon path. Same kill-switch + rate-limit inheritance as the rest
  // of /api/anon/*. Idempotent at the DB layer.
  router.use(anonConceptTagRouter);

  return router;
}

async function safeCaptureEvalSample(input: {
  requestId: string;
  consent: EvalSamplingConsent;
  model: string;
  language: string;
  courseId: string;
  lessonId: string;
  intent: TutorIntent;
  tutorStage: TutorStage;
  question: string;
  files: AIAskParams["files"];
  history: NonNullable<AIAskParams["history"]>;
  lastRun: { errorType: "none" | "compile" | "runtime" | "timeout" | "system" } | null;
  sections: TutorSections;
}): Promise<void> {
  try {
    await insertEvalSample(projectEvalSample(input));
  } catch (err) {
    // Sampling is never allowed to break or delay a completed tutor answer.
    // Do not log raw content or the deletion token on this error path.
    console.error(
      JSON.stringify({
        level: "error",
        evt: "ai_eval_sample_insert_failed",
        requestId: input.requestId,
        msg: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
