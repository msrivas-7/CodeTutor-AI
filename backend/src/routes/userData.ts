import { Router, type Request } from "express";
import { z } from "zod";
import {
  clearOpenAIKey,
  getPreferences,
  setOpenAIKey,
  upsertPreferences,
} from "../db/preferences.js";
import {
  listCourseProgress,
  upsertCourseProgress,
  deleteCourseProgress,
} from "../db/courseProgress.js";
import {
  addLessonTimes,
  listLessonProgress,
  upsertLessonProgress,
  deleteLessonProgress,
} from "../db/lessonProgress.js";
import { getEditorProject, saveEditorProject } from "../db/editorProject.js";
import { adminDeleteUser, isAdminAvailable } from "../db/supabaseAdmin.js";
import { destroyUserSessions } from "../services/session/sessionManager.js";
import { HttpError } from "../middleware/errorHandler.js";
import { hashUserId } from "../services/crypto/logHash.js";
import { buildUserExport } from "../db/userExport.js";

// Phase 18b: /api/user/* endpoints. authMiddleware upstream guarantees
// req.userId; every handler scopes reads/writes by that id. RLS on the tables
// is a second line of defense (backend holds a service-role connection; if
// that connection context is ever downgraded, RLS enforces per-user access).

function requireUser(req: Request): string {
  const u = req.userId;
  // authMiddleware guarantees req.userId on every /api/user/* route. This
  // guard catches only the pathological misconfig where the router is
  // mounted without authMiddleware upstream — treat it as an auth failure
  // so the client surfaces a login prompt rather than a 500 stack trace.
  if (!u) throw new HttpError(401, "not authenticated");
  return u;
}

// ── Shared bounds ──────────────────────────────────────────────────────────
//
// courseId / lessonId are drawn from content authored in the repo (see
// content/courses/**). Human-curated, always short, always `[a-z0-9-]+`.
// Bounding them keeps a malicious client from jamming a megabyte string
// into the primary-key column and fanning the cost out through the RLS
// query plan. The regex matches what our content linter emits.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const slug = (name: string) =>
  z
    .string()
    .min(1, `${name} required`)
    .max(64, `${name} too long`)
    .regex(SLUG_RE, `${name} has invalid chars`);

// `last_code` is a jsonb blob keyed by file path. A single 200 KB cap
// covers any reasonable project (our largest starter files are ~2 KB) and
// forecloses a user gradually consuming hundreds of MB of Postgres with
// a pathologically large autosave payload. Enforced on encoded byte
// length since TextEncoder-compatible size is what Postgres stores.
const LAST_CODE_MAX_BYTES = 200_000;

function byteLen(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v));
}

const lastCodeSchema = z
  .record(z.string().max(256), z.string().max(100_000))
  .nullable()
  .refine(
    (v) => v === null || byteLen(v) <= LAST_CODE_MAX_BYTES,
    { message: `lastCode exceeds ${LAST_CODE_MAX_BYTES} bytes` },
  );

export const userDataRouter = Router();

// ---------- preferences ----------

const prefsPatchSchema = z
  .object({
    persona: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    openaiModel: z.string().nullable().optional(),
    theme: z.enum(["system", "light", "dark"]).optional(),
    welcomeDone: z.boolean().optional(),
    workspaceCoachDone: z.boolean().optional(),
    editorCoachDone: z.boolean().optional(),
    uiLayout: z.record(z.unknown()).optional(),
  })
  .strict();

userDataRouter.get("/preferences", async (req, res, next) => {
  try {
    const prefs = await getPreferences(requireUser(req));
    res.json(prefs);
  } catch (err) {
    next(err);
  }
});

userDataRouter.patch("/preferences", async (req, res, next) => {
  const parsed = prefsPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid preferences patch" });
  }
  try {
    const prefs = await upsertPreferences(requireUser(req), parsed.data);
    res.json(prefs);
  } catch (err) {
    next(err);
  }
});

// ---------- BYOK OpenAI key (Phase 18e) ----------
//
// Plaintext flows in over TLS, lives encrypted at rest (AES-256-GCM, keyed
// off BYOK_ENCRYPTION_KEY), and is only decrypted server-side when the AI
// routes forward it to OpenAI. GET is deliberately not exposed — the client
// sees only `hasOpenaiKey: true|false` via GET /preferences.
const openaiKeySchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(20, "key looks too short")
      .max(400, "key looks too long")
      .regex(/^[A-Za-z0-9_\-]+$/, "key has invalid characters"),
  })
  .strict();

userDataRouter.put("/openai-key", async (req, res, next) => {
  const parsed = openaiKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid openai key" });
  }
  try {
    await setOpenAIKey(requireUser(req), parsed.data.key);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

userDataRouter.delete("/openai-key", async (req, res, next) => {
  try {
    await clearOpenAIKey(requireUser(req));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- course progress ----------

const coursePatchSchema = z
  .object({
    status: z.enum(["not_started", "in_progress", "completed"]).optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    lastLessonId: z.string().nullable().optional(),
    completedLessonIds: z.array(z.string()).optional(),
  })
  .strict();

userDataRouter.get("/courses", async (req, res, next) => {
  try {
    const rows = await listCourseProgress(requireUser(req));
    res.json({ courses: rows });
  } catch (err) {
    next(err);
  }
});

userDataRouter.patch("/courses/:courseId", async (req, res, next) => {
  const courseId = slug("courseId").safeParse(req.params.courseId);
  if (!courseId.success) {
    return res.status(400).json({ error: "invalid courseId" });
  }
  const parsed = coursePatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid course patch" });
  }
  try {
    const row = await upsertCourseProgress(
      requireUser(req),
      courseId.data,
      parsed.data,
    );
    res.json(row);
  } catch (err) {
    next(err);
  }
});

userDataRouter.delete("/courses/:courseId", async (req, res, next) => {
  const courseId = slug("courseId").safeParse(req.params.courseId);
  if (!courseId.success) {
    return res.status(400).json({ error: "invalid courseId" });
  }
  try {
    const userId = requireUser(req);
    const deletedLessons = await deleteLessonProgress(userId, courseId.data);
    const deletedCourse = await deleteCourseProgress(userId, courseId.data);
    res.json({ course: deletedCourse, lessons: deletedLessons });
  } catch (err) {
    next(err);
  }
});

// ---------- lesson progress ----------

// `practiceExerciseCode` is keyed by exerciseId → (file-path → content).
// Shares the same aggregate jsonb ceiling as lastCode so a user can't turn
// "practice this exercise" into an unbounded-size persistence surface.
const practiceExerciseCodeSchema = z
  .record(
    slug("exerciseId"),
    z.record(z.string().max(256), z.string().max(100_000)),
  )
  .refine(
    (v) => byteLen(v) <= LAST_CODE_MAX_BYTES,
    { message: `practiceExerciseCode exceeds ${LAST_CODE_MAX_BYTES} bytes` },
  );

const lessonPatchSchema = z
  .object({
    status: z.enum(["not_started", "in_progress", "completed"]).optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    attemptCount: z.number().int().nonnegative().max(1_000_000).optional(),
    runCount: z.number().int().nonnegative().max(1_000_000).optional(),
    hintCount: z.number().int().nonnegative().max(1_000_000).optional(),
    timeSpentMs: z.number().int().nonnegative().max(30 * 24 * 3600 * 1000).optional(),
    lastCode: lastCodeSchema.optional(),
    lastOutput: z.string().max(200_000).nullable().optional(),
    practiceCompletedIds: z.array(slug("practiceId")).max(256).optional(),
    practiceExerciseCode: practiceExerciseCodeSchema.optional(),
  })
  .strict();

userDataRouter.get("/lessons", async (req, res, next) => {
  let courseId: string | undefined;
  if (typeof req.query.courseId === "string" && req.query.courseId.length > 0) {
    const parsed = slug("courseId").safeParse(req.query.courseId);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid courseId" });
    }
    courseId = parsed.data;
  }
  try {
    const rows = await listLessonProgress(requireUser(req), courseId);
    res.json({ lessons: rows });
  } catch (err) {
    next(err);
  }
});

// P-H4: batch heartbeat endpoint. The frontend client-accumulates lesson-time
// ticks in memory and POSTs them on a slow cadence (periodic 60s + on
// pagehide/visibilitychange via navigator.sendBeacon). Deltas are additive
// — the DB path is INSERT...ON CONFLICT DO UPDATE SET time_spent_ms = ... +
// ${delta}, not the COALESCE-set semantics the PATCH route uses. Cap per-
// item at 5 minutes so a runaway tab can't post a gigantic delta; cap the
// batch size so a malicious client can't make the server loop through
// thousands of inserts per request.
const heartbeatBody = z.object({
  items: z
    .array(
      z.object({
        courseId: slug("courseId"),
        lessonId: slug("lessonId"),
        // 5 min ceiling per item matches the client's MAX_DELTA from
        // useLessonLoader so anything the client could legitimately post
        // fits, but a 10-minute "I forgot to tab back" span is capped.
        deltaMs: z.number().int().nonnegative().max(5 * 60 * 1000),
      }),
    )
    .max(64),
});

userDataRouter.post("/lessons/heartbeat", async (req, res, next) => {
  const parsed = heartbeatBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid heartbeat batch" });
  }
  try {
    const written = await addLessonTimes(
      requireUser(req),
      parsed.data.items.map((i) => ({
        courseId: i.courseId,
        lessonId: i.lessonId,
        deltaMs: i.deltaMs,
      })),
    );
    res.json({ written });
  } catch (err) {
    next(err);
  }
});

userDataRouter.patch(
  "/lessons/:courseId/:lessonId",
  async (req, res, next) => {
    const courseId = slug("courseId").safeParse(req.params.courseId);
    const lessonId = slug("lessonId").safeParse(req.params.lessonId);
    if (!courseId.success || !lessonId.success) {
      return res.status(400).json({ error: "invalid courseId or lessonId" });
    }
    const parsed = lessonPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid lesson patch" });
    }
    try {
      const row = await upsertLessonProgress(
        requireUser(req),
        courseId.data,
        lessonId.data,
        parsed.data,
      );
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ---------- editor project ----------

// Editor-project limits: we persist one row per user, so the bound is
// "what a reasonable learner would realistically build", not "what an
// IDE can handle". 64 files × 100 KB each caps the payload at ~6 MB
// before compression, and the aggregate check below caps jsonb at 500 KB
// which is the practical Postgres sweet spot for row reads.
const EDITOR_MAX_FILES = 64;
const EDITOR_PATH_MAX = 256;
const EDITOR_FILE_MAX = 100_000;
const EDITOR_STDIN_MAX = 64_000;
const EDITOR_FILES_JSONB_MAX = 500_000;

// Accept only POSIX-ish file paths. Blocks `..` traversal, absolute paths,
// Windows backslashes, and anything that Monaco's tab strip couldn't
// render sanely. Matches what projectStore.createFile() already enforces
// on the frontend — we're hardening the server-side boundary too.
const EDITOR_PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const editorPathSchema = z
  .string()
  .min(1)
  .max(EDITOR_PATH_MAX)
  .regex(EDITOR_PATH_RE, "invalid path")
  .refine((p) => !p.includes(".."), { message: "path traversal" });

const editorProjectSchema = z
  .object({
    language: z.string().min(1).max(32),
    files: z
      .record(editorPathSchema, z.string().max(EDITOR_FILE_MAX))
      .refine(
        (f) => Object.keys(f).length <= EDITOR_MAX_FILES,
        { message: `too many files (max ${EDITOR_MAX_FILES})` },
      )
      .refine(
        (f) => byteLen(f) <= EDITOR_FILES_JSONB_MAX,
        { message: `files payload exceeds ${EDITOR_FILES_JSONB_MAX} bytes` },
      ),
    activeFile: editorPathSchema.nullable(),
    openTabs: z.array(editorPathSchema).max(EDITOR_MAX_FILES),
    fileOrder: z.array(editorPathSchema).max(EDITOR_MAX_FILES),
    stdin: z.string().max(EDITOR_STDIN_MAX),
  })
  .strict();

userDataRouter.get("/editor-project", async (req, res, next) => {
  try {
    const project = await getEditorProject(requireUser(req));
    res.json(project);
  } catch (err) {
    next(err);
  }
});

userDataRouter.put("/editor-project", async (req, res, next) => {
  const parsed = editorProjectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid editor project payload" });
  }
  try {
    const project = await saveEditorProject(requireUser(req), parsed.data);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ---------- data export (P-3, GDPR Art. 15 scaffold) ----------
//
// Returns every row the learner owns across public.* tables as one JSON
// document. Filename is date-stamped so the browser's default save dialog
// lands it in Downloads as e.g. codetutor-export-2026-04-22.json. The
// `attachment` disposition cues the browser to save rather than render;
// `application/json` keeps it machine-readable (Art. 15 "commonly used
// electronic form"). See db/userExport.ts for what's included / excluded.
userDataRouter.get("/export", async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const bundle = await buildUserExport(userId);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="codetutor-export-${stamp}.json"`,
    );
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    next(err);
  }
});

// ---------- account deletion (Phase 20-P0 #9) ----------
//
// Self-service deletion. Flow:
//   1. UI posts `{confirmEmail}`; we match it (case-insensitive) against the
//      email claim on the user's current access token. Belt-and-suspenders
//      against a confused-click from an accidentally-shared laptop.
//   2. Tear down any live runner containers owned by this user (the session
//      map is per-process in-memory; without this step the container keeps
//      running after the owning row is gone, billing us CPU until the idle
//      sweeper reaps it).
//   3. Call supabase.auth.admin.deleteUser. The public.* tables all have
//      `ON DELETE CASCADE` on their auth.users(id) FK (see 20260420000000_
//      phase18b_user_data.sql), so user_preferences, course_progress,
//      lesson_progress, editor_project all drop with the auth row. No need
//      to enumerate tables here — the FK graph is the source of truth.
//
// `SUPABASE_SERVICE_ROLE_KEY` is required for step 3. If it's missing we
// 501 rather than pretend to succeed; Phase 20-P1 contemplates dropping
// the key from the VM, at which point this route either flips to an Edge
// Function or stays 501'd.
const deleteAccountSchema = z.object({
  confirmEmail: z.string().min(3).max(320),
}).strict();

userDataRouter.delete("/account", async (req, res, next) => {
  const userId = requireUser(req);
  const parsed = deleteAccountSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "confirmEmail required" });
  }
  const claimEmail = (req.authClaims?.email as string | undefined)?.trim().toLowerCase();
  const submitted = parsed.data.confirmEmail.trim().toLowerCase();
  if (!claimEmail || claimEmail !== submitted) {
    return res.status(400).json({ error: "EMAIL_MISMATCH" });
  }
  if (!isAdminAvailable()) {
    return res.status(501).json({ error: "account deletion is not configured" });
  }
  try {
    const killed = await destroyUserSessions(userId);
    if (killed.length) {
      console.log(`[account-delete] reaped ${killed.length} session(s) for user=${hashUserId(userId)}`);
    }
    await adminDeleteUser(userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
