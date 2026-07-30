import { Router, type Request } from "express";
import { z } from "zod";
import {
  countActiveSharesAllTime,
  countSharesLast24h,
  findOwnerShareForLesson,
  getSharedByToken,
  insertSharedCompletion,
  bumpShareView,
  revokeShareByOwner,
} from "../db/sharedCompletions.js";
import { kickOffRenders } from "../services/share/kickOffRenders.js";
import { listLessonProgress } from "../db/lessonProgress.js";
import {
  sanitizeDisplayName,
  sanitizeShareSnippet,
} from "../services/share/sanitizer.js";
import { getLessonSnapshot } from "../services/share/lessonCatalog.js";
import { config } from "../config.js";
import {
  renderOgPng,
  renderOgStoryPng,
} from "../services/share/ogRenderer.js";
import { withRenderSlot } from "../services/share/renderQueue.js";
import {
  isShareCreateDisabled,
  isSharePublicDisabled,
  isShareRenderDisabled,
} from "../services/share/killSwitches.js";
import {
  deleteShareImages,
  publicUrl,
  uploadOgPng,
  uploadStoryPng,
} from "../services/share/storage.js";
import { HttpError } from "../middleware/errorHandler.js";

// Phase 21C: cinematic share routes.
//
// Three endpoints split across two routers because GET is anon-readable
// while POST/DELETE require auth + CSRF + rate limit:
//
//   GET    /api/shares/:token   — public; returns the share JSON for
//                                 the cinematic share page render.
//   POST   /api/shares          — authed; creates a share for a
//                                 completed lesson.
//   DELETE /api/shares/:token   — authed; owner-only soft-revoke via
//                                 SECURITY DEFINER fn.
//
// The split mount lives in backend/src/index.ts.

function requireUser(req: Request): string {
  const u = req.userId;
  if (!u) throw new HttpError(401, "not authenticated");
  return u;
}

// 12-char base32 (the alphabet excludes l/o/0/1 to avoid look-alike
// confusion). Tokens are server-generated; the route only validates
// shape on incoming requests. Length bumped from 8 → 12 post launch
// audit (60 bits) to defeat targeted-scrape attacks on populated
// shares once the table grows.
const TOKEN_RE = /^[a-z2-9]{12}$/i;

// Token helper — used on routes that take :token in the path. Returns
// a normalized lowercase token or throws 400.
function parseToken(raw: unknown): string {
  if (typeof raw !== "string" || !TOKEN_RE.test(raw)) {
    throw new HttpError(400, "invalid share token");
  }
  return raw.toLowerCase();
}

// ---------------------------------------------------------------------------
// Public router — anon-readable GET only
// ---------------------------------------------------------------------------

export const sharesPublicRouter = Router();

// In-memory IP-throttle for view bumps. 1 bump / IP / token / hour.
// JS Map preserves insertion order, so eviction is FIFO via
// `keys().next()` — O(1) per drop instead of the prior O(n log n)
// sort that would itself become the bottleneck under viral traffic.
const viewBumpCache = new Map<string, number>();
const VIEW_BUMP_TTL_MS = 60 * 60 * 1000;
const VIEW_BUMP_MAX = 10_000;

function shouldBumpView(token: string, ip: string | undefined): boolean {
  const key = `${token}:${ip ?? "unknown"}`;
  const last = viewBumpCache.get(key);
  const now = Date.now();
  if (last && now - last < VIEW_BUMP_TTL_MS) return false;
  // Re-insert by deleting first → bumps to end of insertion order, so
  // the oldest entry (head of the Map) is genuinely the next to evict.
  viewBumpCache.delete(key);
  viewBumpCache.set(key, now);
  if (viewBumpCache.size > VIEW_BUMP_MAX) {
    // Drop ~1k oldest in one pass, FIFO. No sort, no spread.
    let toDrop = 1_000;
    for (const k of viewBumpCache.keys()) {
      if (toDrop-- <= 0) break;
      viewBumpCache.delete(k);
    }
  }
  return true;
}

// Public-route IP throttle — closes the token-enumeration + poll-DoS
// window. Two separate buckets so a malicious scanner pounding random
// tokens (all 404s) can't deny legitimate viewers (all 200s) sharing
// the same NAT/CGNAT egress IP. 60 successful resolutions/min/IP +
// 240 lookup attempts/min/IP — both ceilings are loose for honest
// users, tight enough to make scraping unrewarding.
const GET_RATE_LIMIT_WINDOW_MS = 60_000;
const GET_HIT_MAX = 60; // per IP per minute, only successful (200) lookups
const GET_LOOKUP_MAX = 240; // per IP per minute, ANY lookup attempt
type Bucket = "hit" | "lookup";
interface RateEntry {
  hit: number;
  lookup: number;
  resetAt: number;
}
const getRateLimitCache = new Map<string, RateEntry>();

/**
 * Returns false (rate-limited) when the bucket cap is exceeded. Caller
 * passes the bucket — `lookup` for every request that reaches the
 * handler, `hit` only on successful resolution. Splitting buckets
 * means a scraper hammering bad tokens chews the lookup budget but
 * doesn't burn the hit budget that real viewers rely on.
 */
function checkGetRateLimit(ip: string, bucket: Bucket): boolean {
  const now = Date.now();
  let entry = getRateLimitCache.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { hit: 0, lookup: 0, resetAt: now + GET_RATE_LIMIT_WINDOW_MS };
    getRateLimitCache.set(ip, entry);
    // Janitor: cap entries to bound memory. 100k = ~12 MB at peak,
    // bumped from 10k post-audit because under viral spread the cache
    // would otherwise cycle every few seconds and effectively become
    // a no-op against the viewers we want to protect.
    if (getRateLimitCache.size > 100_000) {
      let toDrop = 10_000;
      for (const k of getRateLimitCache.keys()) {
        if (toDrop-- <= 0) break;
        getRateLimitCache.delete(k);
      }
    }
  }
  const cap = bucket === "hit" ? GET_HIT_MAX : GET_LOOKUP_MAX;
  if (entry[bucket] >= cap) return false;
  entry[bucket] += 1;
  return true;
}

sharesPublicRouter.get("/:token", async (req, res, next) => {
  try {
    // Kill switch + lookup-bucket rate limit run BEFORE the
    // invalid-token pass-through so a malformed-token attacker can't
    // bypass them by sending shapes the regex rejects. Public surface
    // gating sits outside the token-shape branch.
    if (await isSharePublicDisabled()) {
      return res.status(503).json({ error: "share temporarily unavailable" });
    }
    const ip = req.ip ?? "unknown";
    if (!checkGetRateLimit(ip, "lookup")) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "rate limit exceeded" });
    }
    // Pass-through on invalid token shape so other routers mounted at
    // /api/shares (e.g. authed `GET /mine`) get a chance to match.
    // If we threw 400 here, Express would short-circuit before reaching
    // the authed handler.
    if (!TOKEN_RE.test(req.params.token ?? "")) {
      return next();
    }
    const token = parseToken(req.params.token);
    const share = await getSharedByToken(token);
    if (!share) {
      return res.status(404).json({ error: "share not found" });
    }
    // Successful resolution — count against the tighter "hit" bucket
    // too. Scrapers hammering bad tokens never reach this point.
    if (!checkGetRateLimit(ip, "hit")) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "rate limit exceeded" });
    }
    // Bump view counter (rate-limited per IP+token). Once the share is
    // popular (>1000 views), sample at 1-in-10 — same expected count
    // over time, 10x less write pressure on a hot row when something
    // goes viral.
    const shouldSample =
      share.viewCount < 1000 || Math.random() < 0.1;
    if (shouldSample && shouldBumpView(token, req.ip)) {
      void bumpShareView(token).catch(() => {
        /* swallow — counter is non-critical */
      });
    }
    // Cache header — only set when BOTH images have landed. Until
    // they do, the share dialog polls this endpoint waiting for the
    // story image; if the response gets cached at "ogStoryImageUrl:
    // null", the poll keeps reading the same stale `null` for 60s
    // and the user sees the timer climb until the 30s give-up. Once
    // both images are non-null, the row is effectively immutable
    // (apart from view_count and revoked_at), so caching is safe.
    if (share.ogImagePath && share.ogStoryImagePath) {
      res.setHeader("Cache-Control", "public, max-age=60");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    // Strip user_id from the response — the public artifact has no
    // need to expose it. ogImageUrl resolves the storage object path
    // to its public CDN URL for direct embed in the share page's
    // <meta og:image> tag and the inline preview.
    res.json({
      shareToken: share.shareToken,
      courseId: share.courseId,
      lessonId: share.lessonId,
      lessonTitle: share.lessonTitle,
      lessonOrder: share.lessonOrder,
      courseTitle: share.courseTitle,
      courseTotalLessons: share.courseTotalLessons,
      mastery: share.mastery,
      timeSpentMs: share.timeSpentMs,
      attemptCount: share.attemptCount,
      codeSnippet: share.codeSnippet,
      displayName: share.displayName,
      ogImageUrl: share.ogImagePath ? publicUrl(share.ogImagePath) : null,
      ogStoryImageUrl: share.ogStoryImagePath
        ? publicUrl(share.ogStoryImagePath)
        : null,
      viewCount: share.viewCount,
      createdAt: share.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Authed router — POST + DELETE require auth + CSRF + mutationLimit
// ---------------------------------------------------------------------------

export const sharesAuthedRouter = Router();

const SHARE_PER_DAY_CAP = 30;
// Phase 23 P0 #4: per-user lifetime share ceiling. Caps storage growth
// at 50 shares × ~200 KB-per-share-pair (OG + Story) × N users — keeps
// any single farmed account from filling the free-tier 1 GB bucket on
// its own. Revoked shares don't count (legitimate "I want to redo this
// share" path). Conservative ceiling — operator can raise via env or
// config if a real user ever asks.
const SHARE_LIFETIME_CAP = 50;

const slug = (name: string) =>
  z
    .string()
    .min(1, `${name} required`)
    .max(64, `${name} too long`)
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, `${name} has invalid chars`);

// Post-audit: lessonTitle / lessonOrder / courseTitle / courseTotalLessons
// are NOT accepted from the client anymore. They were the brand-impersonation
// vector ("I just leaked the database" minted as a share title). The route
// now looks them up canonically from the published course catalog. Snapshot
// values are still stored on the row so curriculum edits don't mutate
// already-shared receipts.
const createShareBody = z
  .object({
    courseId: slug("courseId"),
    lessonId: slug("lessonId"),
    mastery: z.enum(["strong", "okay", "shaky"]),
    timeSpentMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000),
    attemptCount: z.number().int().min(1).max(10_000),
    codeSnippet: z
      .string()
      .min(1, "codeSnippet required")
      .refine(
        // Hard line-count cap belt-and-suspenders alongside the byte cap:
        // a 4KB snippet of all newlines (single-char lines) would still
        // produce 4096 div nodes in the Satori tree, melting the renderer.
        (v) => v.split("\n").length <= 200,
        { message: "codeSnippet has too many lines" },
      )
      .refine(
        (v) => Buffer.byteLength(v, "utf8") <= 4096,
        { message: "codeSnippet exceeds 4 KB" },
      ),
    displayName: z.string().max(80).nullable(),
  })
  .strict();

sharesAuthedRouter.post("/", async (req, res, next) => {
  // Kill switch — `share_create_disabled` blocks new shares only.
  // The viral GET surface and existing-share lookups stay live, so
  // viewers keep loading shares already in the wild. `publicDisabled`
  // and `renderDisabled` are independent and gate different surfaces.
  if (await isShareCreateDisabled()) {
    return res.status(503).json({ error: "share creation temporarily disabled" });
  }
  const parsed = createShareBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "invalid share body",
    });
  }
  try {
    // requireUser MUST be inside the try block — express 4 doesn't
    // auto-catch synchronous throws from async handlers, so a thrown
    // HttpError(401) outside the try would surface as an unhandled
    // rejection rather than reaching errorHandler.
    const userId = requireUser(req);
    // Defense-in-depth: only let users share lessons they actually
    // completed. The frontend gates the button on lesson-complete
    // state, but a malicious client could call this directly.
    const lessons = await listLessonProgress(userId, parsed.data.courseId);
    const lp = lessons.find((l) => l.lessonId === parsed.data.lessonId);
    if (!lp || lp.status !== "completed") {
      return res.status(403).json({
        error: "lesson must be completed before sharing",
      });
    }

    // Per-user creation rate limit: 30/24h. Catches runaway scripts
    // and discourages farming; doesn't impede normal celebration use.
    const recent = await countSharesLast24h(userId);
    if (recent >= SHARE_PER_DAY_CAP) {
      return res.status(429).json({
        error: `share creation limit reached (${SHARE_PER_DAY_CAP}/day)`,
      });
    }

    // Phase 23 P0 #4: per-user lifetime ceiling. Even within the daily
    // cap, a single user can't accumulate more than SHARE_LIFETIME_CAP
    // active shares. Revoked shares don't count — a learner who's been
    // sharing legitimately for years can revoke older artifacts and
    // continue. 429 with a friendly message; the frontend should
    // surface "you've reached the lifetime limit, revoke an old one
    // to make room" but the backend's job is the enforcement.
    const totalActive = await countActiveSharesAllTime(userId);
    if (totalActive >= SHARE_LIFETIME_CAP) {
      return res.status(429).json({
        error: `share lifetime limit reached (${SHARE_LIFETIME_CAP}). Revoke an older share to free up a slot.`,
      });
    }

    // Sanitizer (Phase 21C #abuse-mitigation): regex-scan the code
    // snippet for known credential shapes. False positives over false
    // negatives — better to block a learner's celebration than leak
    // a real key.
    const safety = sanitizeShareSnippet(parsed.data.codeSnippet);
    if (!safety.ok) {
      return res.status(400).json({
        error: safety.reason,
        // Don't expose the detector name to clients (it's diagnostic).
      });
    }

    // Canonical lesson + course snapshot — fetched server-side to drop
    // the brand-impersonation vector. lessonProgress already proved the
    // user completed this lesson; the catalog supplies the immutable
    // title/order/total.
    let snapshot;
    try {
      snapshot = await getLessonSnapshot(
        parsed.data.courseId,
        parsed.data.lessonId,
      );
    } catch {
      return res.status(503).json({
        error: "lesson catalog unavailable — please try again",
      });
    }
    if (!snapshot) {
      // Catalog 404 + lessonProgress success would be inconsistent;
      // 400 is appropriate (the URL the caller hit doesn't match a
      // published lesson, even though they have a progress row).
      return res.status(400).json({ error: "unknown lesson" });
    }

    // Strip control / RTL / zero-width chars from displayName before
    // it becomes part of the public artifact. Length-cap stays at 80
    // so realistic names ("Anjali", "李华") still pass.
    const safeDisplayName = sanitizeDisplayName(parsed.data.displayName);

    const share = await insertSharedCompletion({
      userId,
      courseId: parsed.data.courseId,
      lessonId: parsed.data.lessonId,
      lessonTitle: snapshot.lessonTitle,
      lessonOrder: snapshot.lessonOrder,
      courseTitle: snapshot.courseTitle,
      courseTotalLessons: snapshot.courseTotalLessons,
      mastery: parsed.data.mastery,
      timeSpentMs: parsed.data.timeSpentMs,
      attemptCount: parsed.data.attemptCount,
      codeSnippet: parsed.data.codeSnippet,
      displayName: safeDisplayName,
    });

    // Fire-and-forget: render BOTH the 1200×630 OG card and the
    // 1080×1920 Story-format image, upload each to Supabase Storage,
    // and patch the share row with the resulting object paths. Done
    // off the response path so the share creation feels instant; the
    // images become available ~2-3s later. Two pipelines run in
    // parallel so the wall-clock for both is ~max(individual) rather
    // than sum.
    //
    // Each pipeline catches its own errors so a failure in one (e.g.,
    // Satori chokes on a particular layout) doesn't block the other.
    // The frontend's GET /api/shares/:token returns null for whichever
    // image hasn't landed yet — the dialog polls + the share page
    // gracefully degrades.
    const artifactProps = {
      lessonTitle: share.lessonTitle,
      lessonOrder: share.lessonOrder,
      courseTitle: share.courseTitle,
      courseTotalLessons: share.courseTotalLessons,
      mastery: share.mastery,
      timeSpentMs: share.timeSpentMs,
      attemptCount: share.attemptCount,
      codeSnippet: share.codeSnippet,
      displayName: share.displayName,
      shareToken: share.shareToken,
    };
    // `share_render_disabled` short-circuits the render+upload — the
    // share row still gets created (so the URL is valid), images stay
    // null, and the dialog / share page gracefully degrade. The
    // POST /:token/rerender endpoint (also gated on this flag) lets
    // operators re-attempt rendering after the flag is flipped off.
    if (!(await isShareRenderDisabled())) {
      kickOffRenders(artifactProps);
    }

    res.json({
      shareToken: share.shareToken,
      // Frontend builds the canonical share URL from the token. We
      // return both for convenience; clients can choose either.
      url: `/s/${share.shareToken}`,
    });
  } catch (err) {
    next(err);
  }
});

// Per-user rate limit on `/mine` so a single authed account can't
// poll-DoS the DB (each call hits TWO tables). 60/min is generous —
// the dialog calls this exactly once per open in normal flow.
const MINE_RATE_LIMIT_WINDOW_MS = 60_000;
const MINE_RATE_LIMIT_MAX = 60;
const mineRateLimitCache = new Map<
  string,
  { count: number; resetAt: number }
>();

function checkMineRateLimit(userId: string): boolean {
  const now = Date.now();
  let entry = mineRateLimitCache.get(userId);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + MINE_RATE_LIMIT_WINDOW_MS };
    mineRateLimitCache.set(userId, entry);
    if (mineRateLimitCache.size > 50_000) {
      let toDrop = 5_000;
      for (const k of mineRateLimitCache.keys()) {
        if (toDrop-- <= 0) break;
        mineRateLimitCache.delete(k);
      }
    }
  }
  if (entry.count >= MINE_RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

// "Have I already shared this lesson?" lookup. Used by the dialog's
// open flow so a user clicking Share twice for the same lesson sees
// their existing share (copy URL, View page, Save for Stories) instead
// of a duplicate creation cycle.
//
// Returns the existing share IF and ONLY IF the most recent
// non-revoked share for `(userId, courseId, lessonId)` is at least
// as new as the lesson's most recent completion. If the user has
// since reset+re-completed the lesson, the saved share is now stale
// (snapshot of a different attempt), so we return 404 and let the
// client mint a new one.
sharesAuthedRouter.get("/mine", async (req, res, next) => {
  try {
    const userId = requireUser(req);
    if (!checkMineRateLimit(userId)) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "rate limit exceeded" });
    }
    const courseId = String(req.query.courseId ?? "");
    const lessonId = String(req.query.lessonId ?? "");
    if (!courseId || !lessonId) {
      return res.status(400).json({ error: "courseId and lessonId required" });
    }
    const share = await findOwnerShareForLesson(userId, courseId, lessonId);
    if (!share) {
      return res.status(404).json({ error: "no share for this lesson" });
    }
    // Cross-check the lesson's most recent completion. If completedAt
    // is newer than share.createdAt, the lesson was reset+re-completed
    // since the share — surface 404 so the dialog opens the compose
    // path for a fresh share.
    const lessons = await listLessonProgress(userId, courseId);
    const lp = lessons.find((l) => l.lessonId === lessonId);
    if (
      lp?.completedAt &&
      new Date(lp.completedAt).getTime() > new Date(share.createdAt).getTime()
    ) {
      return res
        .status(404)
        .json({ error: "share is older than current completion" });
    }
    return res.json({
      shareToken: share.shareToken,
      url: `/s/${share.shareToken}`,
      ogImageUrl: share.ogImagePath ? publicUrl(share.ogImagePath) : null,
      ogStoryImageUrl: share.ogStoryImagePath
        ? publicUrl(share.ogStoryImagePath)
        : null,
      createdAt: share.createdAt,
      displayName: share.displayName,
    });
  } catch (err) {
    next(err);
  }
});

// Re-render endpoint. Triggers a fresh OG + Story render for an
// existing share — owner-only, idempotent, gated on the same render
// kill switch as create. Two callers:
//   1. The dialog, when it polls for the Story image past 30s, can
//      surface a "retry" button that hits this.
//   2. Operators after flipping `SHARE_RENDER_DISABLED` back off,
//      to retroactively populate rows that were created during the
//      degraded window.
sharesAuthedRouter.post("/:token/rerender", async (req, res, next) => {
  try {
    if (await isShareRenderDisabled()) {
      return res
        .status(503)
        .json({ error: "share rendering temporarily disabled" });
    }
    const token = parseToken(req.params.token);
    const userId = requireUser(req);
    const share = await getSharedByToken(token);
    if (!share || share.userId !== userId) {
      return res.status(404).json({ error: "share not found" });
    }
    kickOffRenders({
      lessonTitle: share.lessonTitle,
      lessonOrder: share.lessonOrder,
      courseTitle: share.courseTitle,
      courseTotalLessons: share.courseTotalLessons,
      mastery: share.mastery,
      timeSpentMs: share.timeSpentMs,
      attemptCount: share.attemptCount,
      codeSnippet: share.codeSnippet,
      displayName: share.displayName,
      shareToken: share.shareToken,
    });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

sharesAuthedRouter.delete("/:token", async (req, res, next) => {
  try {
    const token = parseToken(req.params.token);
    const userId = requireUser(req);
    const ok = await revokeShareByOwner(userId, token);
    if (!ok) {
      return res.status(404).json({ error: "share not found or already revoked" });
    }
    // Best-effort: nuke the storage objects so the public PNGs stop
    // serving once the 24h cache TTL expires (or sooner via origin
    // re-fetch). The DB row's `revoked_at` is the source of truth —
    // if storage deletion fails the share is still effectively gone
    // (the API returns 404), so we don't await/throw on errors.
    void deleteShareImages(token).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
