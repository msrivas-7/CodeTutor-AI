import { Router, type Request } from "express";
import { z } from "zod";
import { insertFeedback } from "../db/feedback.js";
import { HttpError } from "../middleware/errorHandler.js";

// Phase 20-P1: POST /api/feedback. Mounted under the same csrfGuard +
// authMiddleware + mutationLimit stack as /api/user — so we inherit the
// 1/min-per-user write floor without introducing a second bucket. Body
// limit is 16 KB (4 KB textarea + 8 KB diagnostics + slack for encoding).

function requireUser(req: Request): string {
  const u = req.userId;
  if (!u) throw new HttpError(401, "not authenticated");
  return u;
}

// Diagnostics is a loose Record because the client adds keys as features
// ship (current keys: route, viewport, theme, lessonId, editorLanguage,
// sessionPhase, appSha, userAgent). We cap the serialized size here AND at
// the DB (octet_length <= 8192) so a malicious client can't stuff arbitrary
// blobs. Per-value strings are capped to 1 KB so a single key can't swallow
// the budget.
const DIAG_MAX_BYTES = 8_000;

const diagnosticsSchema = z
  .record(
    z.string().max(64),
    z.union([
      z.string().max(1024),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  )
  .refine(
    (v) => Buffer.byteLength(JSON.stringify(v)) <= DIAG_MAX_BYTES,
    { message: `diagnostics exceeds ${DIAG_MAX_BYTES} bytes` },
  );

const feedbackSchema = z.object({
  body: z.string().trim().min(1, "body required").max(4000, "body too long"),
  category: z.enum(["bug", "idea", "other"]),
  diagnostics: diagnosticsSchema.optional().default({}),
});

export const feedbackRouter: Router = Router();

feedbackRouter.post("/", async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const parsed = feedbackSchema.parse(req.body ?? {});
    const row = await insertFeedback({
      userId,
      body: parsed.body,
      category: parsed.category,
      diagnostics: parsed.diagnostics,
    });
    res.status(201).json({ id: row.id, createdAt: row.createdAt });
  } catch (err) {
    next(err);
  }
});
