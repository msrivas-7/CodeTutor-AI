import { Router, type Request } from "express";
import { z } from "zod";
import {
  clearOpenAIKey,
  getPreferences,
  setOpenAIKey,
  upsertPreferences,
} from "../db/preferences.js";
import { isFrozen } from "../db/denylist.js";
import {
  listCourseProgress,
  upsertCourseProgress,
  deleteCourseProgress,
} from "../db/courseProgress.js";
import {
  addLessonTimes,
  assertLessonAccess,
  listLessonProgress,
  saveLessonDraft,
  resetCourseLessonProgress,
  resetLessonProgress,
  resetPracticeProgress,
  upsertLessonProgress,
} from "../db/lessonProgress.js";
import { getEditorProject, saveEditorProject } from "../db/editorProject.js";
import {
  countSavedForLesson,
  deleteSavedTutorMessage,
  insertSavedTutorMessage,
  listSavedTutorMessages,
  listAllSavedTutorMessages,
} from "../db/savedTutorMessages.js";
import {
  getStreakHistory,
  getUserStreak,
  updateUserStreak,
} from "../db/userStreak.js";
import { adminDeleteUser, isAdminAvailable } from "../db/supabaseAdmin.js";
import { insertDeletedAccount } from "../db/deletedAccounts.js";
import { destroyUserSessions } from "../services/session/sessionManager.js";
import { HttpError } from "../middleware/errorHandler.js";
import { hashUserId } from "../services/crypto/logHash.js";
import { buildUserExport } from "../db/userExport.js";
import {
  MEMORY_REFRESH_DAYS,
  answerMemoryWarmup,
  getConceptMemory,
  getOrCreateMemoryWarmup,
  recordPracticeEvidence,
} from "../db/conceptMemory.js";
import {
  getCourseConceptTags,
  getCourseStructure,
  getPracticeEvidenceSnapshot,
} from "../services/share/lessonCatalog.js";
import { canonicalProjectFilePath } from "../schema/projectFiles.js";

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
    // ISO-8601 string accepted from the client; null clears.
    // Undefined = not present on patch = no-op on the server.
    lastWelcomeBackAt: z.string().datetime().nullable().optional(),
    // Phase 22D: streak-nudge email opt-in. Settings UI fires this via
    // setEmailOptIn → patch. The unsubscribe email route bypasses this
    // path and writes directly via setEmailOptInDirect.
    emailOptIn: z.boolean().optional(),
    // Phase 27: disable the streak system entirely for this user.
    // Settings UI exposes a toggle; downstream UI surfaces (StreakChip,
    // LessonCompletePanel streak section, share-page streak count) and
    // the digest sweeper all gate on this flag.
    disableStreaks: z.boolean().optional(),
  })
  .strict();

userDataRouter.get("/preferences", async (req, res, next) => {
  try {
    const userId = requireUser(req);
    const [prefs, frozen] = await Promise.all([
      getPreferences(userId),
      isFrozen(userId),
    ]);
    // Phase 25: surface ONLY the boolean flag — the operator's internal
    // reason text stays server-side. It's intended as an audit-trail
    // record, not user-facing copy: it can leak detection heuristics,
    // ticket IDs, reporter names, internal slang. The user's banner
    // shows a generic "contact support" message instead.
    res.json({ ...prefs, accountFrozen: frozen });
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
    const userId = requireUser(req);
    // Phase 25: PATCH response must mirror GET shape — must include
    // accountFrozen — or the frontend's preferences store will overwrite
    // its true value with `false` after every patch (the store reads
    // `prefs.accountFrozen ?? false` from the response). A frozen user
    // toggling email-opt-in or any uiLayout splitter would briefly hide
    // the suspension banner.
    const [prefs, frozen] = await Promise.all([
      upsertPreferences(userId, parsed.data),
      isFrozen(userId),
    ]);
    res.json({ ...prefs, accountFrozen: frozen });
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
    const userId = requireUser(req);
    const structure = await getCourseStructure(courseId.data);
    if (!structure) return res.status(404).json({ error: "course not found" });
    const lessonRows = await listLessonProgress(userId, courseId.data);
    const completedSet = new Set(
      lessonRows
        .filter((lesson) => lesson.status === "completed")
        .map((lesson) => lesson.lessonId),
    );
    const completedLessonIds = structure.lessonOrder.filter((id) => completedSet.has(id));
    const allDone =
      structure.lessonOrder.length > 0 &&
      completedLessonIds.length === structure.lessonOrder.length;
    const hasStarted =
      lessonRows.some((lesson) => lesson.status !== "not_started") ||
      parsed.data.status === "in_progress";
    const row = await upsertCourseProgress(
      userId,
      courseId.data,
      {
        startedAt: parsed.data.startedAt,
        lastLessonId:
          parsed.data.lastLessonId && structure.lessonOrder.includes(parsed.data.lastLessonId)
            ? parsed.data.lastLessonId
            : undefined,
        completedLessonIds,
        status: allDone ? "completed" : hasStarted ? "in_progress" : "not_started",
        completedAt: allDone ? parsed.data.completedAt ?? new Date().toISOString() : null,
      },
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
    const deletedLessons = await resetCourseLessonProgress(userId, courseId.data);
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

const practiceEvidenceSchema = z
  .object({
    exerciseId: slug("exerciseId"),
    requestId: z.string().uuid(),
    attemptCount: z.number().int().min(1).max(100),
    hintCount: z.number().int().min(0).max(100),
    timeSpentMs: z.number().int().min(0).max(24 * 3600 * 1000),
    modelAssisted: z.boolean(),
  })
  .strict();

const lessonPatchSchema = z
  .object({
    status: z.enum(["not_started", "in_progress", "completed"]).optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    attemptCount: z.number().int().nonnegative().max(1_000_000).optional(),
    runCount: z.number().int().nonnegative().max(1_000_000).optional(),
    hintCount: z.number().int().nonnegative().max(1_000_000).optional(),
    timeSpentMs: z.number().int().nonnegative().max(30 * 24 * 3600 * 1000).optional(),
    lastOutput: z.string().max(200_000).nullable().optional(),
    practiceCompletedIds: z.array(slug("practiceId")).max(256).optional(),
    practiceExerciseCode: practiceExerciseCodeSchema.optional(),
    practiceEvidence: practiceEvidenceSchema.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.practiceEvidence === undefined ||
      patch.practiceCompletedIds?.includes(patch.practiceEvidence.exerciseId) === true,
    {
      message: "practice evidence requires a matching completed exercise",
      path: ["practiceEvidence", "exerciseId"],
    },
  );

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
    const userId = requireUser(req);
    await Promise.all(
      parsed.data.items.map((item) =>
        assertLessonAccess(userId, item.courseId, item.lessonId),
      ),
    );
    const written = await addLessonTimes(
      userId,
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

const lessonDraftBody = z
  .object({
    code: lastCodeSchema.refine((value) => value !== null, {
      message: "code required",
    }),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    writerId: z.string().uuid(),
  })
  .strict();

userDataRouter.put(
  "/lessons/:courseId/:lessonId/draft",
  async (req, res, next) => {
    const courseId = slug("courseId").safeParse(req.params.courseId);
    const lessonId = slug("lessonId").safeParse(req.params.lessonId);
    const parsed = lessonDraftBody.safeParse(req.body ?? {});
    if (!courseId.success || !lessonId.success || !parsed.success) {
      return res.status(400).json({ error: "invalid lesson draft" });
    }
    try {
      const userId = requireUser(req);
      await assertLessonAccess(userId, courseId.data, lessonId.data);
      const result = await saveLessonDraft(userId, courseId.data, lessonId.data, {
        code: parsed.data.code as Record<string, string>,
        expectedRevision: parsed.data.expectedRevision,
        writerId: parsed.data.writerId,
      });
      if (!result.ok) {
        return res.status(409).json({
          error: "lesson draft changed in another tab or device",
          current: result.current,
        });
      }
      return res.json(result.lesson);
    } catch (err) {
      next(err);
    }
  },
);

userDataRouter.delete(
  "/lessons/:courseId/:lessonId/practice",
  async (req, res, next) => {
    const courseId = slug("courseId").safeParse(req.params.courseId);
    const lessonId = slug("lessonId").safeParse(req.params.lessonId);
    if (!courseId.success || !lessonId.success) {
      return res.status(400).json({ error: "invalid courseId or lessonId" });
    }
    try {
      const userId = requireUser(req);
      await assertLessonAccess(userId, courseId.data, lessonId.data);
      const row = await resetPracticeProgress(userId, courseId.data, lessonId.data);
      return res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

userDataRouter.delete(
  "/lessons/:courseId/:lessonId",
  async (req, res, next) => {
    const courseId = slug("courseId").safeParse(req.params.courseId);
    const lessonId = slug("lessonId").safeParse(req.params.lessonId);
    if (!courseId.success || !lessonId.success) {
      return res.status(400).json({ error: "invalid courseId or lessonId" });
    }
    try {
      const userId = requireUser(req);
      const structure = await getCourseStructure(courseId.data);
      if (!structure || !structure.lessonOrder.includes(lessonId.data)) {
        return res.status(404).json({ error: "lesson not found" });
      }
      const reset = await resetLessonProgress(userId, courseId.data, lessonId.data);
      const remaining = await listLessonProgress(userId, courseId.data);
      const completedSet = new Set(
        remaining
          .filter((lesson) => lesson.status === "completed")
          .map((lesson) => lesson.lessonId),
      );
      const completedLessonIds = structure.lessonOrder.filter((id) => completedSet.has(id));
      const anyStarted = remaining.some((lesson) => lesson.status !== "not_started");
      const course = await upsertCourseProgress(userId, courseId.data, {
        status: anyStarted ? "in_progress" : "not_started",
        completedAt: null,
        completedLessonIds,
        lastLessonId:
          remaining.filter((lesson) => lesson.status !== "not_started").at(-1)
            ?.lessonId ?? null,
      });
      return res.json({ reset, course });
    } catch (err) {
      next(err);
    }
  },
);

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
      const userId = requireUser(req);
      await assertLessonAccess(userId, courseId.data, lessonId.data);
      const { practiceEvidence, ...lessonPatch } = parsed.data;
      const practiceSnapshot = practiceEvidence
        ? await getPracticeEvidenceSnapshot(
            courseId.data,
            lessonId.data,
            practiceEvidence.exerciseId,
          )
        : null;
      if (practiceEvidence && !practiceSnapshot) {
        throw new HttpError(400, "unknown practice exercise");
      }
      const row = await upsertLessonProgress(
        userId,
        courseId.data,
        lessonId.data,
        lessonPatch,
      );
      if (practiceEvidence && practiceSnapshot) {
        await recordPracticeEvidence(userId, practiceSnapshot, practiceEvidence);
      }
      // Phase 21B: a qualifying-action signal for the streak. Lesson
      // completion or any run/attempt counts as engagement. Same-day
      // repeats are no-ops inside updateUserStreak. Fire-and-forget so
      // the route response isn't blocked on streak math; the frontend
      // refetches /streak after the patch resolves to drive the chip.
      const isQualifying =
        lessonPatch.status === "completed" ||
        typeof lessonPatch.runCount === "number" ||
        typeof lessonPatch.attemptCount === "number";
      if (isQualifying) {
        void updateUserStreak(userId).catch(() => {
          /* silent — streak is non-critical to the patch path */
        });
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// ---------- concept memory + retrieval warm-ups (Phase B1) ----------

const memoryQuerySchema = z
  .object({ courseId: slug("courseId") })
  .strict();

userDataRouter.get("/memory", async (req, res, next) => {
  const parsed = memoryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid courseId" });
  }
  try {
    const concepts = await getCourseConceptTags(parsed.data.courseId);
    if (!concepts) throw new HttpError(404, "course not found");
    const memory = await getConceptMemory(requireUser(req), concepts);
    res.json({
      courseId: parsed.data.courseId,
      refreshAfterDays: MEMORY_REFRESH_DAYS,
      concepts: memory,
    });
  } catch (err) {
    next(err);
  }
});

const warmupQuerySchema = z
  .object({
    courseId: slug("courseId"),
    lessonId: slug("lessonId"),
  })
  .strict();

userDataRouter.get("/memory/warmup", async (req, res, next) => {
  const parsed = warmupQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid courseId or lessonId" });
  }
  try {
    const warmup = await getOrCreateMemoryWarmup(
      requireUser(req),
      parsed.data.courseId,
      parsed.data.lessonId,
    );
    res.json({ warmup });
  } catch (err) {
    next(err);
  }
});

const answerWarmupSchema = z
  .object({
    requestId: z.string().uuid(),
    choiceIndex: z.number().int().min(0).max(7),
  })
  .strict();

userDataRouter.post(
  "/memory/warmup/:episodeId/answer",
  async (req, res, next) => {
    const episodeId = z.string().uuid().safeParse(req.params.episodeId);
    const body = answerWarmupSchema.safeParse(req.body ?? {});
    if (!episodeId.success || !body.success) {
      return res.status(400).json({ error: "invalid warm-up answer" });
    }
    try {
      const answer = await answerMemoryWarmup(
        requireUser(req),
        episodeId.data,
        body.data.requestId,
        body.data.choiceIndex,
      );
      res.json(answer);
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
  .refine((p) => !p.includes(".."), { message: "path traversal" })
  .refine((p) => canonicalProjectFilePath(p) === p, { message: "noncanonical path" });

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
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    writerId: z.string().uuid(),
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
    const result = await saveEditorProject(requireUser(req), parsed.data);
    if (!result.ok) {
      return res.status(409).json({
        error: "editor project changed in another tab or device",
        current: result.current,
      });
    }
    res.json(result.project);
  } catch (err) {
    next(err);
  }
});

// ---------- learning streak (Phase 21B) ----------
//
// Read-only endpoint for the StartPage chip + LessonPage/EditorPage
// header chip. Writes happen inline from qualifying-action handlers
// (lesson PATCH above; ai/ask/stream below). The hook on the frontend
// refetches this after any qualifying action resolves so the chip
// reflects the new state without an extra round-trip in the response.

userDataRouter.get("/streak", async (req, res, next) => {
  try {
    const streak = await getUserStreak(requireUser(req));
    res.json(streak);
  } catch (err) {
    next(err);
  }
});

// History for the expand-on-click widget. Returns the past `days` UTC
// dates with active/freeze annotations so the chip can render a
// dot-grid + freeze-mark visualization. Default 14 days; cap 30 to
// keep the query bounded.
const streakHistoryQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(14),
});

userDataRouter.get("/streak/history", async (req, res, next) => {
  const parsed = streakHistoryQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid query" });
  }
  try {
    const history = await getStreakHistory(requireUser(req), parsed.data.days);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// ---------- saved tutor messages (Phase 21A) ----------
//
// Per-user "★ saved" pins on assistant messages from the AI tutor history.
// Scope tuple (courseId, lessonId, exerciseId) determines where the
// saved message renders again on re-entry:
//   (null, null, null)            → /editor view
//   (course, lesson, null)        → lesson view (not practice)
//   (course, lesson, exercise)    → specific practice exercise
// Cap: 100 saves per (course, lesson) bucket; editor shares its own bucket.

const SAVED_PER_LESSON_CAP = 100;
const SAVED_CONTENT_MAX_BYTES = 64_000;

const messageIdSchema = z
  .string()
  .min(1, "messageId required")
  .max(64, "messageId too long");

const savedScopeSchema = z
  .object({
    courseId: slug("courseId").nullable(),
    lessonId: slug("lessonId").nullable(),
    exerciseId: slug("exerciseId").nullable(),
  })
  .refine(
    (s) =>
      (s.courseId === null && s.lessonId === null && s.exerciseId === null) ||
      (s.courseId !== null && s.lessonId !== null),
    { message: "scope inconsistent: editor uses all-null; lesson requires courseId+lessonId" },
  );

const savedBodySchema = z
  .object({
    messageId: messageIdSchema,
    courseId: slug("courseId").nullable(),
    lessonId: slug("lessonId").nullable(),
    exerciseId: slug("exerciseId").nullable(),
    content: z
      .string()
      .min(1, "content required")
      .refine(
        (v) => Buffer.byteLength(v, "utf8") <= SAVED_CONTENT_MAX_BYTES,
        { message: `content exceeds ${SAVED_CONTENT_MAX_BYTES} bytes` },
      ),
    sections: z.record(z.string(), z.unknown()).nullable().optional(),
    model: z.string().max(64).nullable().optional(),
  })
  .strict()
  .refine(
    (b) =>
      (b.courseId === null && b.lessonId === null && b.exerciseId === null) ||
      (b.courseId !== null && b.lessonId !== null),
    { message: "scope inconsistent" },
  );

const savedQuerySchema = z.object({
  // Treat the literal string "null" as IS NULL, anything else as a slug match.
  // Mirrors the legitimate URL-encoding boundary between "no value here" and
  // "value here is the literal courseId 'null'", which our slug regex rejects.
  courseId: z.string().max(64).optional(),
  lessonId: z.string().max(64).optional(),
  exerciseId: z.string().max(64).optional(),
});

function parseScopeFromQuery(
  raw: { courseId?: string; lessonId?: string; exerciseId?: string },
): { ok: true; scope: { courseId: string | null; lessonId: string | null; exerciseId: string | null } } | { ok: false; error: string } {
  const decode = (v: string | undefined): string | null | { error: string } => {
    if (v === undefined || v === "null") return null;
    return SLUG_RE.test(v) ? v : { error: `invalid slug: ${v}` };
  };
  const c = decode(raw.courseId);
  const l = decode(raw.lessonId);
  const e = decode(raw.exerciseId);
  if (typeof c === "object" && c !== null && "error" in c) return { ok: false, error: c.error };
  if (typeof l === "object" && l !== null && "error" in l) return { ok: false, error: l.error };
  if (typeof e === "object" && e !== null && "error" in e) return { ok: false, error: e.error };
  const courseId = c as string | null;
  const lessonId = l as string | null;
  const exerciseId = e as string | null;
  // Same scope-consistency rule as POST.
  const editorScope = courseId === null && lessonId === null && exerciseId === null;
  const lessonScope = courseId !== null && lessonId !== null;
  if (!editorScope && !lessonScope) {
    return { ok: false, error: "scope inconsistent: editor uses all-null; lesson requires courseId+lessonId" };
  }
  return { ok: true, scope: { courseId, lessonId, exerciseId } };
}

userDataRouter.get("/saved-tutor-messages", async (req, res, next) => {
  const parsedQ = savedQuerySchema.safeParse(req.query);
  if (!parsedQ.success) {
    return res.status(400).json({ error: "invalid query" });
  }
  const scopeResult = parseScopeFromQuery(parsedQ.data);
  if (!scopeResult.ok) {
    return res.status(400).json({ error: scopeResult.error });
  }
  try {
    const messages = await listSavedTutorMessages(requireUser(req), scopeResult.scope);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

userDataRouter.get("/saved-tutor-messages/all", async (req, res, next) => {
  try {
    const messages = await listAllSavedTutorMessages(requireUser(req));
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

userDataRouter.post("/saved-tutor-messages", async (req, res, next) => {
  const parsed = savedBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid body" });
  }
  const userId = requireUser(req);
  const { messageId, courseId, lessonId, exerciseId, content, sections, model } = parsed.data;
  try {
    // Cap enforcement BEFORE the upsert. Re-saving an already-saved message
    // (same message_id) returns the existing row via ON CONFLICT — count
    // doesn't grow, so we exempt that case. Cheapest check: did the row
    // already exist? If yes, we're not adding a new save and the cap check
    // is moot. Otherwise count and 409 if at cap.
    const existing = await listSavedTutorMessages(userId, { courseId, lessonId, exerciseId });
    const alreadySaved = existing.some((m) => m.messageId === messageId);
    if (!alreadySaved) {
      const count = await countSavedForLesson(userId, courseId, lessonId);
      if (count >= SAVED_PER_LESSON_CAP) {
        return res.status(409).json({
          error: `save limit reached (${SAVED_PER_LESSON_CAP} per lesson)`,
        });
      }
    }
    const saved = await insertSavedTutorMessage(userId, {
      messageId,
      scope: { courseId, lessonId, exerciseId },
      content,
      sections: sections ?? null,
      model: model ?? null,
    });
    res.json({ saved });
  } catch (err) {
    next(err);
  }
});

userDataRouter.delete("/saved-tutor-messages/:id", async (req, res, next) => {
  const idParsed = z.string().uuid().safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: "invalid id" });
  }
  try {
    const deleted = await deleteSavedTutorMessage(requireUser(req), idParsed.data);
    if (!deleted) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
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
//   2. **Phase 23 P0 #1 — recent-auth gate:** require the JWT to have been
//      issued within the last 5 minutes. Closes the "stolen laptop with a
//      60-min-old JWT in localStorage = full account drainage" gap. Returns
//      428 Precondition Required with `code:"REAUTH_REQUIRED"` when stale;
//      the frontend (DeleteAccountModal) catches it, prompts a password
//      reauth, retries with the fresh JWT.
//   3. Tear down any live runner containers owned by this user (the session
//      map is per-process in-memory; without this step the container keeps
//      running after the owning row is gone, billing us CPU until the idle
//      sweeper reaps it).
//   4. Call supabase.auth.admin.deleteUser. The public.* tables all have
//      `ON DELETE CASCADE` on their auth.users(id) FK (see 20260420000000_
//      phase18b_user_data.sql), so user_preferences, course_progress,
//      lesson_progress, editor_project all drop with the auth row. No need
//      to enumerate tables here — the FK graph is the source of truth.
//
// `SUPABASE_SERVICE_ROLE_KEY` is required for step 4. If it's missing we
// 501 rather than pretend to succeed; Phase 20-P1 contemplates dropping
// the key from the VM, at which point this route either flips to an Edge
// Function or stays 501'd.
const deleteAccountSchema = z.object({
  confirmEmail: z.string().min(3).max(320),
}).strict();

// Phase 23 P0 #1: max age of the JWT's `iat` claim (issued-at) for a
// destructive operation. 5 minutes is enough wall-clock for a learner to
// reauth + click, while small enough that a stale localStorage JWT
// (default Supabase session is 1h) is rejected with a re-auth prompt.
// Supabase auto-refreshes JWTs in-page, so a recently-active tab will
// have iat < 5min naturally; we don't need a fresh sign-in for active
// users — only for "left-the-laptop-open" scenarios.
const ACCOUNT_DELETE_MAX_JWT_AGE_SEC = 5 * 60;

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
  // Phase 23 P0 #1: stale JWTs can't authorize destruction. iat is in
  // seconds-since-epoch (RFC 7519 §4.1.6). Allow 60s of clock skew.
  // Applies UNIFORMLY to every session — password, OAuth, future
  // passwordless — because "skip for OAuth" splits the security
  // guarantee (attackers find the easy path). Reauth mechanism on the
  // frontend differs per provider, but the gate is identical.
  const iat = typeof req.authClaims?.iat === "number" ? req.authClaims.iat : null;
  if (iat === null) {
    return res.status(428).json({ error: "REAUTH_REQUIRED", reason: "missing_iat" });
  }
  const ageSec = Math.floor(Date.now() / 1000) - iat;
  if (ageSec > ACCOUNT_DELETE_MAX_JWT_AGE_SEC + 60) {
    return res.status(428).json({ error: "REAUTH_REQUIRED", reason: "stale_jwt" });
  }
  if (!isAdminAvailable()) {
    return res.status(501).json({ error: "account deletion is not configured" });
  }
  try {
    // Phase 23 P1 #6: write the audit row BEFORE the cascade. If the
    // delete then fails, we have proof of intent; if the audit insert
    // fails (DB blip), we don't proceed — failing closed protects us
    // from the "user disputes a delete that we have no record of"
    // scenario.
    await insertDeletedAccount({
      userIdHashed: hashUserId(userId),
      email: claimEmail,
      reason: "self_service",
    });
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
