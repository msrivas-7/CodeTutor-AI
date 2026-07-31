import { Router } from "express";
import { z } from "zod";
import {
  listAdminEvalSamples,
  listEvalSynthesisQueue,
  resolveEvalSynthesisQueue,
  upsertEvalSampleReview,
} from "../db/aiEvalSamples.js";
import { logAdminAction } from "../db/adminAuditLog.js";

const sampleListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
  disposition: z
    .enum(["pending_review", "review_complete", "synthesis_queued", "rejected"])
    .optional(),
}).strict();

const ISSUE_CODES = [
  "factual_error",
  "unhelpful",
  "too_much_answer",
  "poor_grounding",
  "unsafe_content",
  "redaction_concern",
  "ambiguous_rubric",
] as const;

const reviewBody = z.object({
  verdict: z.enum(["pass", "fail", "ambiguous", "reject_privacy"]),
  issueCodes: z.array(z.enum(ISSUE_CODES)).max(12).default([]),
  note: z.string().trim().min(1).max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "pass" && value.issueCodes.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["issueCodes"],
      message: "passing reviews cannot include issue codes",
    });
  }
  if (value.verdict !== "pass" && value.issueCodes.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["issueCodes"],
      message: "non-passing reviews require an issue code",
    });
  }
  if (
    value.verdict === "reject_privacy" &&
    (value.issueCodes.length !== 1 || value.issueCodes[0] !== "redaction_concern")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["issueCodes"],
      message: "privacy rejection requires only redaction_concern",
    });
  }
});

const queueListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const resolveQueueBody = z.object({
  state: z.enum(["synthetic_case_authored", "rejected"]),
  syntheticCaseId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{2,79}$/)
    .nullable()
    .optional(),
  reason: z.string().trim().min(4).max(500),
}).strict().superRefine((value, ctx) => {
  if (value.state === "synthetic_case_authored" && !value.syntheticCaseId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["syntheticCaseId"],
      message: "syntheticCaseId is required when a synthetic case was authored",
    });
  }
  if (value.state === "rejected" && value.syntheticCaseId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["syntheticCaseId"],
      message: "syntheticCaseId must be omitted when rejecting a queue item",
    });
  }
});

export const adminEvalSamplesRouter = Router();

adminEvalSamplesRouter.get("/eval-samples", async (req, res, next) => {
  const parsed = sampleListQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const result = await listAdminEvalSamples({
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
      disposition: parsed.data.disposition,
      reviewerId: req.userId!,
    });
    await logAdminAction({
      actorId: req.userId!,
      eventType: "eval_sample_viewed",
      targetKey: "sample-list",
      after: {
        returned: result.samples.length,
        disposition: parsed.data.disposition ?? null,
      },
      reason: "B8 independent quality review",
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

adminEvalSamplesRouter.put("/eval-samples/:sampleId/review", async (req, res, next) => {
  const sampleId = z.string().uuid().safeParse(req.params.sampleId);
  const body = reviewBody.safeParse(req.body ?? {});
  if (!sampleId.success || !body.success) {
    await logAdminAction({
      actorId: req.userId!,
      eventType: "rejected_attempt",
      targetKey: String(req.params.sampleId),
      after: { validation: "invalid eval sample review" },
      reason: "B8 review validation failed",
    });
    return res.status(400).json({ error: "invalid eval sample review" });
  }
  try {
    const reviewed = await upsertEvalSampleReview({
      sampleId: sampleId.data,
      reviewerId: req.userId!,
      verdict: body.data.verdict,
      issueCodes: body.data.issueCodes,
      note: body.data.note,
    });
    if (!reviewed) return res.status(404).json({ error: "sample not reviewable" });
    await logAdminAction({
      actorId: req.userId!,
      eventType: "eval_sample_reviewed",
      targetKey: sampleId.data,
      after: {
        verdict: body.data.verdict,
        issueCodes: body.data.issueCodes,
      },
      reason: "B8 independent quality review",
    });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminEvalSamplesRouter.get("/eval-synthesis-queue", async (req, res, next) => {
  const parsed = queueListQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const items = await listEvalSynthesisQueue(parsed.data.limit);
    await logAdminAction({
      actorId: req.userId!,
      eventType: "eval_sample_viewed",
      targetKey: "synthesis-queue",
      after: { returned: items.length },
      reason: "B8 weekly synthesis review",
    });
    return res.json({ items });
  } catch (err) {
    next(err);
  }
});

adminEvalSamplesRouter.put("/eval-synthesis-queue/:queueId", async (req, res, next) => {
  const queueId = z.string().uuid().safeParse(req.params.queueId);
  const body = resolveQueueBody.safeParse(req.body ?? {});
  if (!queueId.success || !body.success) {
    await logAdminAction({
      actorId: req.userId!,
      eventType: "rejected_attempt",
      targetKey: String(req.params.queueId),
      after: { validation: "invalid eval synthesis resolution" },
      reason: "B8 synthesis validation failed",
    });
    return res.status(400).json({ error: "invalid eval synthesis resolution" });
  }
  try {
    const resolved = await resolveEvalSynthesisQueue({
      queueId: queueId.data,
      state: body.data.state,
      syntheticCaseId: body.data.syntheticCaseId,
    });
    if (!resolved) return res.status(404).json({ error: "queue item not pending" });
    await logAdminAction({
      actorId: req.userId!,
      eventType: "eval_sample_queue_resolved",
      targetKey: queueId.data,
      after: {
        state: body.data.state,
        syntheticCaseId: body.data.syntheticCaseId ?? null,
      },
      reason: body.data.reason,
    });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
