// Phase 27-v2 Day 1 — anon→authed handoff endpoint.
//
// Mounted at /api/anon-handoff (NOT under /api/anon — that's the
// unauthed surface). Caller must be authenticated; the request body
// describes what the user did on the anon trial path before signing
// up, and the endpoint idempotently:
//   - marks lesson 1 done in lesson_progress
//   - persists `name` into user_metadata.first_name (so the lesson 2
//     scripted greeter says "Hey Maya")
//   - persists the final main.py code into the project store
//   - sets first_run_done = true, workspace_coach_done = true,
//     welcome_done = true on user_preferences so /welcome cinematic,
//     ?firstRun=1 choreography, and the WorkspaceCoach 6-step tour
//     all stay suppressed on the post-signup landing
//
// Day 1 (this file): VALIDATION + STUB. Accepts the body, validates
// shape, returns { ok: true, applied: false } without writing. The
// real idempotent inserts land Day 4 alongside the SignupPage
// signup-from-anon detection. Stub-now lets the frontend wire end
// to end (write stash → signup → POST handoff → route to lesson 2)
// before any of the underlying writes are live.
//
// Idempotency contract (for Day 4):
//   - If lesson_progress already has a completed row for this
//     (userId, course, lesson), return { ok: true, applied: false }.
//   - If preferences already has welcome_done=true, leave them as-is
//     (no clobbering a user who somehow signed up direct THEN
//     navigated through anon — vanishingly rare but the code
//     shouldn't lie about it).
//   - Otherwise apply all four writes and return { ok: true, applied: true }.

import { Router, type Request, type Response } from "express";
import { z } from "zod";

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
  // (1..40 chars, not "YOUR_NAME").
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[^"'<>]*$/) // No quote/angle-bracket smuggling.
    .nullable(),
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

    // Day 1 stub. Day 4 will:
    //   - INSERT INTO lesson_progress (idempotent ON CONFLICT)
    //   - UPDATE user_metadata SET first_name = body.name (Supabase auth)
    //   - UPSERT project_files for (userId, course, lesson)
    //   - UPDATE user_preferences SET welcome_done=true,
    //         first_run_done=true, workspace_coach_done=true
    // All under one tx via withRlsContext(userId).
    return res.json({ ok: true, applied: false, stub: true });
  });

  return router;
}
