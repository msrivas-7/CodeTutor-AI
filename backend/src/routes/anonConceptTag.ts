// Phase A — A6 (memory v0): anon-side concept-tag write.
//
// Authed lesson completion writes concept rows automatically through
// `upsertLessonProgress`'s side effect (the lesson_progress UPSERT
// fires the ledger insert). Anon completions don't have a server-side
// progress write today — the cinematic + LessonCompletePanel are
// client-only — so the ledger needs its own fire-and-forget hook for
// the anon path. This route is that hook.
//
// Body: `{ courseId, lessonId }`. The server reads the lesson's
// `teachesConceptTags` + `usesConceptTags` from the catalog and
// writes one row per concept (event_type='taught' or 'used'),
// ip_hash-keyed.
//
// The route is a "best effort" — the AnonLessonPage fires it
// fire-and-forget after the celebration mounts; a 4xx/5xx response
// just means the ledger missed this completion (OK for v0; the
// authed-side write picks it up after signup via the handoff path).
//
// Defenses:
//   - Inherits anon_lesson_enabled kill switch (parent router).
//   - Inherits aiRateLimit (parent router) — bot-flood protection.
//   - Body shape locked to the (course, lesson) literals the anon
//     surface allows today.
//   - Idempotent at the DB layer (UNIQUE partial index): replays are
//     no-ops, not errors.

import { Router } from "express";
import { z } from "zod";
import { writeConceptTags } from "../db/conceptLedger.js";
import { hashClientIp } from "../services/ai/ipHash.js";
import { getLessonConceptTags } from "../services/share/lessonCatalog.js";

const bodySchema = z
  .object({
    courseId: z.literal("python-fundamentals"),
    lessonId: z.literal("hello-world"),
  })
  .strict();

export const anonConceptTagRouter = Router();

anonConceptTagRouter.post("/concept-tag", async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_BODY" });
    }
    const { courseId, lessonId } = parsed.data;

    const tags = await getLessonConceptTags(courseId, lessonId);
    if (!tags) {
      // Catalog miss — silently 200; the lesson exists in the anon
      // allowlist but not in the catalog (deploy-time race). The
      // authed-side write at handoff time covers the gap if needed.
      return res.status(200).json({ ok: true, written: 0 });
    }
    if (tags.taught.length === 0 && tags.used.length === 0) {
      return res.status(200).json({ ok: true, written: 0 });
    }

    const ipHash = hashClientIp(req.ip ?? "");
    const written = await writeConceptTags({
      ipHash,
      courseId,
      lessonId,
      taught: tags.taught,
      used: tags.used,
    });
    return res.status(200).json({ ok: true, written });
  } catch (err) {
    next(err);
  }
});
