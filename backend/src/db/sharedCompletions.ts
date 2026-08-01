import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "./client.js";
import { HttpError } from "../middleware/errorHandler.js";

// Phase 21C: per-user shareable lesson-completion artifacts.
//
// Schema lives in supabase/migrations/20260429000000_shared_lesson_completions.sql.
// Two SQL helpers are routed through here as well:
//   - bump_share_view(token)  — atomic view-count increment (anon-callable)
//   - revoke_share(token)     — owner-only soft-delete (auth-callable)

export interface SharedCompletion {
  id: string;
  shareToken: string;
  // Phase A — A3: nullable. Authed shares carry user_id; anon shares
  // (created from /try/) carry ip_hash instead. The owner_ck DB CHECK
  // enforces XOR (exactly one of the two is set per row).
  userId: string | null;
  ipHash: string | null;
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
  mastery: "strong" | "okay" | "shaky";
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
  ogImagePath: string | null;
  ogStoryImagePath: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  rotatedAt: string | null;
  revokedAt: string | null;
}

const SharedRowSchema = z.object({
  id: z.string().uuid(),
  share_token: z.string(),
  user_id: z.string().uuid().nullable(),
  ip_hash: z.string().nullable(),
  course_id: z.string(),
  lesson_id: z.string(),
  lesson_title: z.string(),
  lesson_order: z.union([z.number(), z.string()]),
  course_title: z.string(),
  course_total_lessons: z.union([z.number(), z.string()]),
  mastery: z.enum(["strong", "okay", "shaky"]),
  time_spent_ms: z.union([z.number(), z.string()]),
  attempt_count: z.union([z.number(), z.string()]),
  code_snippet: z.string(),
  display_name: z.string().nullable(),
  og_image_path: z.string().nullable(),
  og_story_image_path: z.string().nullable(),
  view_count: z.union([z.number(), z.string()]),
  created_at: z.date(),
  updated_at: z.date(),
  revision: z.union([z.number(), z.string()]),
  rotated_at: z.date().nullable(),
  revoked_at: z.date().nullable(),
});

function rowToShared(raw: unknown): SharedCompletion {
  const parsed = SharedRowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      500,
      `corrupt shared_lesson_completions row: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const r = parsed.data;
  return {
    id: r.id,
    shareToken: r.share_token,
    userId: r.user_id,
    ipHash: r.ip_hash,
    courseId: r.course_id,
    lessonId: r.lesson_id,
    lessonTitle: r.lesson_title,
    lessonOrder: Number(r.lesson_order),
    courseTitle: r.course_title,
    courseTotalLessons: Number(r.course_total_lessons),
    mastery: r.mastery,
    timeSpentMs: Number(r.time_spent_ms),
    attemptCount: Number(r.attempt_count),
    codeSnippet: r.code_snippet,
    displayName: r.display_name,
    ogImagePath: r.og_image_path,
    ogStoryImagePath: r.og_story_image_path,
    viewCount: Number(r.view_count),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    revision: Number(r.revision),
    rotatedAt: r.rotated_at?.toISOString() ?? null,
    revokedAt: r.revoked_at?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Token generation. 12-char base32 URL-safe → 60 bits of entropy (alphabet
// is exactly 32 chars, so byte % 32 is unbiased: 256 % 32 = 0). Per the
// post-launch security audit, 8-char tokens (40 bits) made targeted
// scraping of populated shares cheap once the table grows past ~10k
// rows; 60 bits pushes the expected hit rate to ~1 / 1B per request,
// neutralising the attack even with aggressive rate limits.
// ---------------------------------------------------------------------------

export const TOKEN_LENGTH = 12;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // base32 minus look-alikes (l, o, 0, 1)

export function generateShareToken(): string {
  // 256 % ALPHABET.length === 0, so plain modulo is unbiased.
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    out += ALPHABET[bytes[i] % 32];
  }
  return out;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Phase A — A3: shares are now created from two surfaces — authed
// `/api/shares` (userId) and anon `/api/anon/shares` (ipHash). The
// CreateSharedInput XOR-types over those two ownership shapes; the
// owner_ck DB CHECK enforces exactly one of them is set.
type CreateSharedOwner =
  | { userId: string; ipHash?: never }
  | { userId?: never; ipHash: string };

export type CreateSharedInput = CreateSharedOwner & {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number;
  courseTitle: string;
  courseTotalLessons: number;
  mastery: "strong" | "okay" | "shaky";
  timeSpentMs: number;
  attemptCount: number;
  codeSnippet: string;
  displayName: string | null;
};

/**
 * Insert a new share row with a freshly-generated token. On the very
 * rare token collision (UNIQUE violation on share_token), retry up to
 * 5 times. Returns the created row (with og_image_path=null pending
 * the renderer's upload).
 */
export async function insertSharedCompletion(
  input: CreateSharedInput,
): Promise<SharedCompletion> {
  const sql = db();
  // Resolve ownership at the typed-union boundary so the SQL below
  // doesn't need to branch — exactly one of the two columns is set,
  // the other is null. owner_ck CHECK enforces this server-side too.
  const userId: string | null = input.userId ?? null;
  const ipHash: string | null = input.ipHash ?? null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateShareToken();
    try {
      const rows = await sql`
        INSERT INTO public.shared_lesson_completions (
          share_token, user_id, ip_hash, course_id, lesson_id,
          lesson_title, lesson_order, course_title, course_total_lessons,
          mastery, time_spent_ms, attempt_count,
          code_snippet, display_name
        )
        VALUES (
          ${token}, ${userId}, ${ipHash}, ${input.courseId}, ${input.lessonId},
          ${input.lessonTitle}, ${input.lessonOrder}, ${input.courseTitle}, ${input.courseTotalLessons},
          ${input.mastery}, ${input.timeSpentMs}, ${input.attemptCount},
          ${input.codeSnippet}, ${input.displayName}
        )
        RETURNING id, share_token, user_id, ip_hash, course_id, lesson_id,
                  lesson_title, lesson_order, course_title, course_total_lessons,
                  mastery, time_spent_ms, attempt_count,
                  code_snippet, display_name, og_image_path,
                  og_story_image_path, view_count,
                  created_at, updated_at, revision, rotated_at, revoked_at
      `;
      return rowToShared(rows[0]);
    } catch (err) {
      // Postgres unique-violation code 23505. Retry with a new token.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        if (userId) {
          const existing = await findOwnerShareForLesson(
            userId,
            input.courseId,
            input.lessonId,
          );
          if (existing) return existing;
        }
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(500, "share token generation: collision retry limit exhausted");
}

/** Set the og_image_path after the renderer + storage upload completes. */
export async function setShareOgImagePath(
  shareToken: string,
  path: string,
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.shared_lesson_completions
       SET og_image_path = ${path}
     WHERE share_token = ${shareToken}
  `;
}

/** Phase 21C-ext: set the og_story_image_path. Mirrors the OG variant
 *  but writes the 9:16 Story-format object path. Called from the same
 *  fire-and-forget pipeline as the OG image so both end states are
 *  observable to the share dialog's "Save for Stories" poll. */
export async function setShareOgStoryImagePath(
  shareToken: string,
  path: string,
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.shared_lesson_completions
       SET og_story_image_path = ${path}
     WHERE share_token = ${shareToken}
  `;
}

/** Public read by token. Returns null if missing OR revoked. */
export async function getSharedByToken(
  shareToken: string,
): Promise<SharedCompletion | null> {
  const sql = db();
  const rows = await sql`
    SELECT id, share_token, user_id, ip_hash, course_id, lesson_id,
           lesson_title, lesson_order, course_title, course_total_lessons,
           mastery, time_spent_ms, attempt_count,
           code_snippet, display_name, og_image_path,
           og_story_image_path, view_count,
           created_at, updated_at, revision, rotated_at, revoked_at
      FROM public.shared_lesson_completions
     WHERE share_token = ${shareToken}
       AND revoked_at IS NULL
  `;
  if (rows.length === 0) return null;
  return rowToShared(rows[0]);
}

/**
 * Find the most recent non-revoked share by `(userId, courseId,
 * lessonId)`. Used by the "have I already shared this lesson?" lookup
 * the dialog runs on open — if a fresh share exists, we open straight
 * to the created state instead of forcing a duplicate creation.
 *
 * Owner-scoped (the WHERE clause), so this never leaks across users.
 */
export async function findOwnerShareForLesson(
  userId: string,
  courseId: string,
  lessonId: string,
): Promise<SharedCompletion | null> {
  const sql = db();
  const rows = await sql`
    SELECT id, share_token, user_id, ip_hash, course_id, lesson_id,
           lesson_title, lesson_order, course_title, course_total_lessons,
           mastery, time_spent_ms, attempt_count,
           code_snippet, display_name, og_image_path,
           og_story_image_path, view_count,
           created_at, updated_at, revision, rotated_at, revoked_at
      FROM public.shared_lesson_completions
     WHERE user_id = ${userId}
       AND course_id = ${courseId}
       AND lesson_id = ${lessonId}
       AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToShared(rows[0]);
}

export async function listOwnerShares(userId: string): Promise<SharedCompletion[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, share_token, user_id, ip_hash, course_id, lesson_id,
           lesson_title, lesson_order, course_title, course_total_lessons,
           mastery, time_spent_ms, attempt_count,
           code_snippet, display_name, og_image_path,
           og_story_image_path, view_count,
           created_at, updated_at, revision, rotated_at, revoked_at
      FROM public.shared_lesson_completions
     WHERE user_id = ${userId}
       AND revoked_at IS NULL
     ORDER BY updated_at DESC, created_at DESC
  `;
  return rows.map(rowToShared);
}

export interface UpdateOwnerShareInput {
  displayName: string | null;
  codeSnippet: string;
  mastery: SharedCompletion["mastery"];
  timeSpentMs: number;
  attemptCount: number;
}

export async function updateShareByOwner(
  userId: string,
  shareToken: string,
  input: UpdateOwnerShareInput,
): Promise<SharedCompletion | null> {
  const sql = db();
  const rows = await sql`
    UPDATE public.shared_lesson_completions
       SET display_name = ${input.displayName},
           code_snippet = ${input.codeSnippet},
           mastery = ${input.mastery},
           time_spent_ms = ${input.timeSpentMs},
           attempt_count = ${input.attemptCount},
           og_image_path = NULL,
           og_story_image_path = NULL,
           updated_at = now(),
           revision = revision + 1
     WHERE share_token = ${shareToken}
       AND user_id = ${userId}
       AND revoked_at IS NULL
     RETURNING id, share_token, user_id, ip_hash, course_id, lesson_id,
               lesson_title, lesson_order, course_title, course_total_lessons,
               mastery, time_spent_ms, attempt_count,
               code_snippet, display_name, og_image_path,
               og_story_image_path, view_count,
               created_at, updated_at, revision, rotated_at, revoked_at
  `;
  return rows.length > 0 ? rowToShared(rows[0]) : null;
}

export async function rotateShareTokenByOwner(
  userId: string,
  shareToken: string,
): Promise<SharedCompletion | null> {
  const sql = db();
  for (let attempt = 0; attempt < 5; attempt++) {
    const nextToken = generateShareToken();
    try {
      const rows = await sql`
        UPDATE public.shared_lesson_completions
           SET share_token = ${nextToken},
               og_image_path = NULL,
               og_story_image_path = NULL,
               rotated_at = now(),
               updated_at = now(),
               revision = revision + 1
         WHERE share_token = ${shareToken}
           AND user_id = ${userId}
           AND revoked_at IS NULL
         RETURNING id, share_token, user_id, ip_hash, course_id, lesson_id,
                   lesson_title, lesson_order, course_title, course_total_lessons,
                   mastery, time_spent_ms, attempt_count,
                   code_snippet, display_name, og_image_path,
                   og_story_image_path, view_count,
                   created_at, updated_at, revision, rotated_at, revoked_at
      `;
      return rows.length > 0 ? rowToShared(rows[0]) : null;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(500, "share token rotation collision retry limit exhausted");
}

/**
 * Bump the view counter. Called from the public share-page render.
 * Idempotent (one bump per call); IP-based throttling lives in the
 * route handler. Plain UPDATE — backend uses service role so the
 * SECURITY DEFINER pattern isn't needed here.
 */
export async function bumpShareView(shareToken: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.shared_lesson_completions
       SET view_count = view_count + 1
     WHERE share_token = ${shareToken}
       AND revoked_at IS NULL
  `;
}

/**
 * Owner-only soft-revoke. Plain UPDATE with user_id in the WHERE
 * clause — the backend always connects with the service role, so we
 * don't need the SECURITY DEFINER + auth.uid() dance (that pattern
 * only matters if the path can be reached via a user-JWT-scoped
 * connection like PostgREST, which we don't expose).
 *
 * Returns true on success, false if the share didn't exist, the
 * caller doesn't own it, or it was already revoked.
 */
export async function revokeShareByOwner(
  userId: string,
  shareToken: string,
): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    UPDATE public.shared_lesson_completions
       SET revoked_at = now(),
           updated_at = now(),
           revision = revision + 1
     WHERE share_token = ${shareToken}
       AND user_id = ${userId}
       AND revoked_at IS NULL
     RETURNING id
  `;
  return rows.length > 0;
}

/** Per-user creation rate limit support: count shares created in
 *  the last 24h. Used by the route handler to enforce 30/day. */
export async function countSharesLast24h(userId: string): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ c: string }>>`
    SELECT COUNT(*)::text AS c
      FROM public.shared_lesson_completions
     WHERE user_id = ${userId}
       AND created_at > NOW() - INTERVAL '24 hours'
  `;
  return Number(rows[0]?.c ?? 0);
}

/**
 * Phase 23 P0 #4: GC candidate query. Returns share tokens whose OG /
 * Story images are sitting in storage with **zero views** and are
 * older than `staleDays`. The cron in
 * services/share/orphanShareGc.ts deletes the images, then nulls out
 * the path columns — the row stays so the share URL still resolves
 * (with default OG fallback) and the per-user lifetime cap math still
 * counts it.
 *
 * Why view_count == 0 only: a share that's been viewed even once is
 * "in use" — the URL might be in someone's bookmarks, a Slack thread,
 * etc. Deleting the image there breaks the social-card preview. A
 * never-viewed share is almost certainly a bot upload or a learner
 * who never copied the link.
 */
export async function listOrphanShareTokens(
  staleDays: number,
  limit: number,
): Promise<string[]> {
  const sql = db();
  const rows = await sql<Array<{ share_token: string }>>`
    SELECT share_token
      FROM public.shared_lesson_completions
     WHERE view_count = 0
       AND revoked_at IS NULL
       AND created_at < NOW() - (${staleDays} || ' days')::interval
       AND (og_image_path IS NOT NULL OR og_story_image_path IS NOT NULL)
     ORDER BY created_at ASC
     LIMIT ${limit}
  `;
  return rows.map((r) => r.share_token);
}

/**
 * Phase 23 P0 #4: null out the storage path columns on a share row
 * after the GC cron has deleted the actual storage objects. Idempotent
 * — running it on a row whose paths are already null is a no-op.
 */
export async function clearShareImagePaths(shareToken: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.shared_lesson_completions
       SET og_image_path = NULL,
           og_story_image_path = NULL
     WHERE share_token = ${shareToken}
  `;
}

/**
 * Phase 23 P0 #4: per-user lifetime share count. The route enforces a
 * 50/lifetime ceiling so a single bot account can't fill the
 * (Supabase-free-tier-bounded) `share-og` storage bucket. Excludes
 * revoked rows — a user who revoked old shares legitimately gets the
 * slot back. Also excludes shares whose images were already GC'd (the
 * share-bucket-gc cron sets `image_url = NULL` when it deletes orphan
 * objects).
 */
export async function countActiveSharesAllTime(userId: string): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ c: string }>>`
    SELECT COUNT(*)::text AS c
      FROM public.shared_lesson_completions
     WHERE user_id = ${userId}
       AND revoked_at IS NULL
  `;
  return Number(rows[0]?.c ?? 0);
}

/**
 * Phase A — A3: per-IP-hash anon-share rate-limit support. Counts anon
 * shares (rows with user_id IS NULL) created from a given ip_hash within
 * the last `windowMs`. The route enforces:
 *   - 1 anon share per IP per hour (catches casual abuse)
 *   - 5 anon shares per IP per day (catches bot loops)
 * Both windows are checked separately by the route; this helper is
 * window-agnostic to keep the policy in one place at the call site.
 */
export async function countAnonSharesByIpHash(
  ipHash: string,
  windowMs: number,
): Promise<number> {
  const sql = db();
  const rows = await sql<Array<{ c: string }>>`
    SELECT COUNT(*)::text AS c
      FROM public.shared_lesson_completions
     WHERE ip_hash = ${ipHash}
       AND user_id IS NULL
       AND created_at > NOW() - (${windowMs}::bigint || ' milliseconds')::interval
  `;
  return Number(rows[0]?.c ?? 0);
}
