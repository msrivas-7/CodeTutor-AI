// Phase A — A3 (anon-share unlock): per-IP-hashed share creation for
// the anon `/try/` flow.
//
// Today the share dialog on `/try/lesson/...` pivots straight to the
// SignupWallDialog because the cinematic-share artifact requires an
// authed insert path. That broke the "viral artifact" loop the founder
// design called out: a phone learner who finishes lesson 1 has the
// peak intent to share, but every share click ended in a wall, so
// K-factor was zero. This route closes the loop: anon learners get a
// real `/s/:token` artifact created BEFORE the wall opens, the wall
// then fires post-share so the conversion ask still lands.
//
// Defenses:
//   - Kill switches: parent `anon_lesson_enabled` (anon.ts router-level
//     middleware) AND `share_create_disabled` (Phase 21C, applies to
//     all share creation regardless of source).
//   - Per-IP cap: 1 share / IP / hour (catches casual abuse) + 5 / IP /
//     day (catches bot loops). DB-counted via the new ip_hash index.
//   - Sanitizer: same `sanitizeShareSnippet` as the authed path —
//     credential-shape regex blocks would-be secret leaks.
//   - Server-side lesson-title lookup via `getLessonSnapshot` — the
//     client cannot smuggle a fake title (brand-impersonation defense
//     mirrors the authed path).
//   - Rate-limit middleware (`aiRateLimit`) inherited from the
//     `/api/anon` mount.

import { Router } from "express";
import { z } from "zod";
import {
  countAnonSharesByIpHash,
  insertSharedCompletion,
} from "../db/sharedCompletions.js";
import { hashClientIp } from "../services/ai/ipHash.js";
import { isShareCreateDisabled } from "../services/share/killSwitches.js";
import { getLessonSnapshot } from "../services/share/lessonCatalog.js";
import {
  sanitizeDisplayName,
  sanitizeShareSnippet,
} from "../services/share/sanitizer.js";
import { kickOffRenders } from "../services/share/kickOffRenders.js";
import { isShareRenderDisabled } from "../services/share/killSwitches.js";

// Per-IP rate limits. Tighter than the authed path because the anon
// surface has no account-level accountability — the only signal is the
// hashed IP, which is shared with /run + AI-tutor caps.
const ANON_SHARE_PER_HOUR_CAP = 1;
const ANON_SHARE_PER_DAY_CAP = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Anon lesson 1 is the only allowed (course, lesson) pair on the trial
// surface today, so we lock the share path to that pair too. A future
// expansion just adds entries to the allowlist.
const ANON_ALLOWED_PAIRS = new Set(["python-fundamentals/hello-world"]);

const bodySchema = z
  .object({
    courseId: z.literal("python-fundamentals"),
    lessonId: z.literal("hello-world"),
    mastery: z.enum(["strong", "okay", "shaky"]),
    timeSpentMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000),
    attemptCount: z.number().int().min(1).max(10_000),
    codeSnippet: z
      .string()
      .min(1, "codeSnippet required")
      .refine((v) => v.split("\n").length <= 200, {
        message: "codeSnippet has too many lines",
      })
      .refine((v) => Buffer.byteLength(v, "utf8") <= 4096, {
        message: "codeSnippet exceeds 4 KB",
      }),
    // Optional name parsed from code (extractNameFromCode). Length-cap
    // matches the authed path so the cinematic OG card layout stays
    // bounded.
    displayName: z.string().max(80).nullable(),
  })
  .strict();

export const anonShareRouter = Router();

anonShareRouter.post("/shares", async (req, res, next) => {
  try {
    if (await isShareCreateDisabled()) {
      return res.status(503).json({ error: "ANON_SHARE_DISABLED" });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_BODY",
        detail: parsed.error.issues[0]?.message ?? "invalid share body",
      });
    }
    const { courseId, lessonId } = parsed.data;
    if (!ANON_ALLOWED_PAIRS.has(`${courseId}/${lessonId}`)) {
      // Belt-and-suspenders — the zod literal already enforces this,
      // but a mistyped allowlist entry would otherwise silently shrink
      // the trial surface.
      return res.status(400).json({ error: "LESSON_NOT_ALLOWED" });
    }

    const ipHash = hashClientIp(req.ip ?? "");

    // Hour cap first (cheaper signal in the abuse-tightening direction:
    // a bot hammering the route trips the hour cap before the day cap).
    const recentHour = await countAnonSharesByIpHash(ipHash, ONE_HOUR_MS);
    if (recentHour >= ANON_SHARE_PER_HOUR_CAP) {
      return res.status(429).json({
        error: "ANON_SHARE_RATE_LIMITED",
        scope: "hour",
        retryAfterMs: ONE_HOUR_MS,
      });
    }
    const recentDay = await countAnonSharesByIpHash(ipHash, ONE_DAY_MS);
    if (recentDay >= ANON_SHARE_PER_DAY_CAP) {
      return res.status(429).json({
        error: "ANON_SHARE_RATE_LIMITED",
        scope: "day",
        retryAfterMs: ONE_DAY_MS,
      });
    }

    const safety = sanitizeShareSnippet(parsed.data.codeSnippet);
    if (!safety.ok) {
      return res.status(400).json({ error: safety.reason });
    }

    let snapshot;
    try {
      snapshot = await getLessonSnapshot(courseId, lessonId);
    } catch {
      return res.status(503).json({
        error: "lesson catalog unavailable — please try again",
      });
    }
    if (!snapshot) {
      return res.status(400).json({ error: "unknown lesson" });
    }

    const safeDisplayName = sanitizeDisplayName(parsed.data.displayName);

    const share = await insertSharedCompletion({
      ipHash,
      courseId,
      lessonId,
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

    // Fire-and-forget OG render, same shape as the authed path.
    if (!(await isShareRenderDisabled())) {
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
    }

    return res.status(200).json({
      shareToken: share.shareToken,
      url: `/s/${share.shareToken}`,
    });
  } catch (err) {
    next(err);
  }
});
