// Phase 27-v2 Day 4b — anon→authed handoff endpoint.
//
// Mounted at /api/anon-handoff (NOT under /api/anon — that's the
// unauthed surface). Caller must be authenticated; the request body
// describes what the user did on the anon trial path before signing
// up, and the endpoint idempotently:
//   - marks lesson 1 done in lesson_progress (status=completed,
//     completed_at=now, last_code.main.py=user's final code)
//   - upserts course_progress so course-level dashboards see the
//     lesson as completed
//   - sets welcome_done + workspace_coach_done on user_preferences
//     to suppress /welcome cinematic + ?firstRun=1 + the 6-step
//     spotlight tour on the post-signup landing
//
// Idempotency: callers (StartPage's handoff phase) replay this on
// every fresh-tab return until the stash clears. Every write uses
// UPSERT semantics keyed on (user_id, course_id, lesson_id) so a
// second invocation is a no-op as long as the data is unchanged. We
// return `applied: true` on first successful invocation,
// `applied: false` when the lesson was ALREADY completed (the
// caller's behavior is the same — route to lesson 2 — but the
// distinction lets ops/metrics see how often a refresh re-triggered
// the path).
//
// What's INTENTIONALLY not written here:
//   - user_metadata.first_name: too privileged (requires Supabase
//     admin API). Maya's signup form firstName is the source of
//     truth for the lesson-2 tutor's "Hey Maya"; the stash.name is
//     informational and used only for the anon celebration's
//     "You did it, Maya." header.
//   - editor_project: the scratch editor's project store. Lesson
//     code lives in lesson_progress.last_code, not editor_project.

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { upsertLessonProgress, listLessonProgress } from "../db/lessonProgress.js";
import { upsertCourseProgress } from "../db/courseProgress.js";
import { upsertPreferences } from "../db/preferences.js";

const handoffBody = z.object({
  // Bounded to lesson 1 of python-fundamentals — same allowlist as
  // /api/anon/ai/ask/stream. Frontend should never send anything
  // else, but server is the trust boundary.
  courseId: z.literal("python-fundamentals"),
  lessonId: z.literal("hello-world"),
  // The user's final main.py contents at lesson completion. Bounded
  // at 4KB so a hand-crafted POST can't smuggle a giant payload
  // through the project-store write — hello-world starter is ~80
  // bytes, a Maya-edited version is ~85 bytes.
  code: z.string().min(1).max(4_096),
  // The literal name parsed from `name = "Maya"` in the user's code,
  // OR null if the parser didn't find a clean match. Bounded the
  // same way the anonStash.extractNameFromCode parser bounds it
  // (1..40 chars, not "YOUR_NAME"). Currently informational only on
  // the server side — the lesson-2 tutor reads firstName from
  // signup user_metadata, not from this field.
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[^"'<>]*$/) // No quote/angle-bracket smuggling.
    .nullable(),
  // Honest record of orientation surfaces that fired on anon. Day 6
  // will mount WorkspaceCoach on anon and start passing
  // workspaceCoachDone:true; pre-Day-6 stash writers MUST pass
  // false to avoid silently skipping a feature Maya never saw.
  flags: z.object({
    welcomeDone: z.boolean(),
    workspaceCoachDone: z.boolean(),
  }),
});

export type HandoffBody = z.infer<typeof handoffBody>;

export function createAnonHandoffRouter(): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) {
      // authMiddleware should have populated req.userId; defensive
      // 401 in case the mount-order is ever wrong.
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }

    const parsed = handoffBody.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const body = parsed.data;

    // Idempotency check: did this user already complete lesson 1?
    // listLessonProgress already RLS-scopes by userId. If found
    // completed, skip the writes and report applied=false. Maya
    // refreshing /start mid-redirect must not double-write.
    const existing = await listLessonProgress(userId, body.courseId);
    const alreadyCompleted = existing.some(
      (lp) => lp.lessonId === body.lessonId && lp.status === "completed",
    );
    if (alreadyCompleted) {
      return res.json({ ok: true, applied: false });
    }

    const completedAt = new Date().toISOString();

    // Run the three writes. Not in one DB transaction because each
    // helper opens its own withRlsContext() block (different
    // tables, different RLS scopes). If lesson_progress succeeds
    // and preferences fails, the user's lesson is correctly marked
    // done but their /welcome flag isn't suppressed — they'd see
    // the cinematic on next visit, but their progress is intact.
    // That's the right failure mode (under-suppress vs lose
    // progress); the alternative — reverse order — risks losing
    // the lesson completion if preferences errors after.
    await upsertLessonProgress(userId, body.courseId, body.lessonId, {
      status: "completed",
      startedAt: completedAt,
      completedAt,
      attemptCount: 1,
      runCount: 1,
      lastCode: { "main.py": body.code },
    });

    // Course progress: mark in-progress, set completed_lesson_ids
    // to [lessonId]. Note this OVERWRITES any prior list — the
    // upsert helper's COALESCE returns the new value when the
    // patch supplies a non-null value, which we always do. Data
    // loss is bounded by the idempotency early-return above:
    // we only reach this write when lesson_progress shows
    // hello-world NOT yet completed, which for any real user
    // means course_progress also has an empty/missing list. If
    // a future edit removes the early-return, this write needs
    // to be changed to array-union semantics or we'd clobber a
    // legitimate "user manually completed lessons 2-3 already"
    // edge case (vanishingly rare on signup-from-anon, but worth
    // calling out).
    await upsertCourseProgress(userId, body.courseId, {
      status: "in_progress",
      lastLessonId: body.lessonId,
      completedLessonIds: [body.lessonId],
    });

    // Preferences: flip welcome_done + workspace_coach_done per
    // the honest flags from the stash. workspace_coach_done is
    // false today (Day 6 mounts the coach on anon); after Day 6,
    // the stash carries true and post-signup coach is suppressed.
    await upsertPreferences(userId, {
      welcomeDone: body.flags.welcomeDone,
      workspaceCoachDone: body.flags.workspaceCoachDone,
    });

    return res.json({ ok: true, applied: true });
  });

  return router;
}
