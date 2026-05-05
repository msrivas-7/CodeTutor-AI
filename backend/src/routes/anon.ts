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
import { runProject } from "../services/execution/router.js";
import { languageSchema } from "../services/execution/commands.js";
import type { ExecutionBackend, RuntimeSpec } from "../services/execution/backends/index.js";
import { execDuration } from "../services/metrics.js";
import { sessionCreateLimit } from "../middleware/mutationRateLimit.js";
import { openaiProvider } from "../services/ai/openaiProvider.js";
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
import { writeAnonUsageRow } from "../db/usageLedger.js";
import { hashClientIp } from "../services/ai/ipHash.js";
import {
  aiPlatformRequests,
  aiPlatformAbuseSignals,
} from "../services/metrics.js";
import { completionRuleSchema } from "../schema/lessonRuleSchema.js";

// Anon AI is locked to lesson 1 of python-fundamentals. The marketing
// surface (/try/lesson/...) only links to this one lesson; this server-
// side check is defense-in-depth so a hand-crafted POST can't smuggle
// a bigger lessonContext through.
const ANON_ALLOWED_LESSON = {
  courseId: "python-fundamentals",
  lessonId: "hello-world",
} as const;

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
  model: z.string().min(1),
  question: z.string().min(1).max(4_000),
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
  stdin: z.string().nullish(),
  runsSinceLastTurn: z.number().int().min(0).optional(),
  editsSinceLastTurn: z.number().int().min(0).optional(),
  // lessonContext is REQUIRED on anon — narrows the surface to the
  // hello-world lesson. Authed callers can omit it for the editor
  // tutor, but anon has no editor-tutor path.
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
  }),
});

function safePrice(
  model: string,
  inTok: number,
  outTok: number,
): { costUsd: number; priceVersion: number } {
  try {
    return priceUsd(model, inTok, outTok);
  } catch {
    return { costUsd: 0, priceVersion: 1 };
  }
}

async function safeWriteAnonUsage(
  args: Omit<Parameters<typeof writeAnonUsageRow>[0], "ipHash"> & {
    ipHash: string;
  },
): Promise<void> {
  try {
    await writeAnonUsageRow(args);
    invalidateAnonUsageCaches();
  } catch (err) {
    console.error(
      `[anon] ledger write failed route=${args.route}:`,
      (err as Error).message,
    );
  }
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

  // Phase 27-v2 quick fix #5: kill switch. If ENABLE_ANON_LESSON=0,
  // every anon route short-circuits to 503 before doing any work
  // (no DB read, no provider call, no container spawn). Mounted as
  // the FIRST middleware on the router so it runs before any of the
  // per-route validators. Operator flips this for incident response
  // — abuse spike, paused trial, suspected platform-key leak — and
  // restarts; no redeploy. Returns a stable error code the
  // frontend's anon page can branch on to show a "trial paused,
  // please sign up" fallback rather than a generic 503.
  router.use((_req, res, next) => {
    if (!config.anonLessonEnabled) {
      return res
        .status(503)
        .json({ error: "ANON_LESSON_DISABLED" });
    }
    next();
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
    try {
      handle = await backend.createSession(spec);
      await backend.writeFiles(handle, files);
      const started = Date.now();
      const result = await runProject(backend, { handle, language, stdin });
      execDuration.observe(
        { language, ok: result.exitCode === 0 ? "true" : "false" },
        (Date.now() - started) / 1000,
      );
      res.json(result);
    } catch (err) {
      next(err);
    } finally {
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
      }
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
    const ctx = parsed.data.lessonContext;
    if (
      ctx.courseId !== ANON_ALLOWED_LESSON.courseId ||
      ctx.lessonId !== ANON_ALLOWED_LESSON.lessonId
    ) {
      aiPlatformAbuseSignals.inc({ signal: "anon_lesson_not_allowed" });
      return res.status(403).json({ error: "LESSON_NOT_ALLOWED_ANON" });
    }
    // Platform model allowlist: anon never overrides the curated list.
    if (!isPlatformAllowedModel(parsed.data.model)) {
      aiPlatformRequests.inc({ outcome: "model_rejected", route: "ask_stream" });
      aiPlatformAbuseSignals.inc({ signal: "model_rejection" });
      return res.status(403).json({ error: "MODEL_NOT_ALLOWED" });
    }

    const ipHash = hashClientIp(req.ip ?? "");
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

    const requestId = randomUUID();
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

    // Per-request abort: only need the client-close signal here. The
    // provider's own deadline (Phase 27 §3b: REQUEST_DEADLINE_MS=25s)
    // gives the upstream-stall backstop. Anon has no shutdown registry
    // entry — fan-abort by user doesn't apply.
    const controller = new AbortController();
    const onClose = (): void => controller.abort();
    res.on("close", onClose);

    try {
      await openaiProvider.askStream(
        {
          key: cred.key,
          model: parsed.data.model,
          fundingSource: "platform",
          question: parsed.data.question,
          files: parsed.data.files,
          activeFile: parsed.data.activeFile,
          // Anon language pinned via lessonContext.language; the
          // top-level optional was dropped from the schema to prevent
          // inconsistent inputs.
          language: ctx.language,
          lastRun: parsed.data.lastRun ?? null,
          history: parsed.data.history,
          stdin: parsed.data.stdin ?? null,
          runsSinceLastTurn: parsed.data.runsSinceLastTurn,
          editsSinceLastTurn: parsed.data.editsSinceLastTurn,
          lessonContext: ctx,
          signal: controller.signal,
          // Phase 27 §3b — anon callers ask for a tighter cap than
          // authed (512 vs 2000). The provider clamps to
          // min(supplied, MAX_OUTPUT_TOKENS) so the global ceiling
          // still applies as a final guard.
          maxOutputTokens: config.freeTier.anonMaxOutputTokens,
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
            );
            await safeWriteAnonUsage({
              ipHash,
              model: parsed.data.model,
              route: "ask_stream",
              countsTowardQuota: true,
              inputTokens: inTok,
              outputTokens: outTok,
              costUsd,
              priceVersion,
              status: "finish",
              requestId,
            });
            if (closed) return;
            send({ done: true, raw, sections, usage });
            finish();
          },
          onError: async (message, status) => {
            terminalFired = true;
            if (status === 401) markPlatformAuthFailed();
            await safeWriteAnonUsage({
              ipHash,
              model: parsed.data.model,
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
            finish();
          },
          onAbort: async (_raw, estUsage) => {
            terminalFired = true;
            const { costUsd, priceVersion } = safePrice(
              parsed.data.model,
              estUsage.inputTokens,
              estUsage.outputTokens,
            );
            await safeWriteAnonUsage({
              ipHash,
              model: parsed.data.model,
              route: "ask_stream",
              // countsTowardQuota=false: learner saw nothing useful,
              // so the per-IP daily counter doesn't drain. L4 still
              // sees the spend via cost_usd.
              countsTowardQuota: false,
              inputTokens: estUsage.inputTokens,
              outputTokens: estUsage.outputTokens,
              costUsd,
              priceVersion,
              status: "aborted",
              requestId,
            });
          },
        },
      );
      if (!terminalFired) {
        await safeWriteAnonUsage({
          ipHash,
          model: parsed.data.model,
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
      res.off("close", onClose);
    }
  });

  return router;
}
