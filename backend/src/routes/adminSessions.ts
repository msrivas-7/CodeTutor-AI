// Phase 25: live-session management for the admin console.
//
// GET    /api/admin/sessions               — list active sessions
// DELETE /api/admin/sessions/:sessionId    — kill one (phrase-confirmed)
// DELETE /api/admin/sessions/by-user/:uid  — kill all for a user (phrase-confirmed)
//
// All three are mounted under the standard admin chain (csrfGuard +
// authMiddleware + mutationLimit + adminGuard + adminWriteLimit) so we
// don't repeat the gating here. The DELETE endpoints require a
// `reason` (≥4 chars) and the kill phrase to match exactly — same
// pattern as system_config dangerous changes.

import { Router } from "express";
import { z } from "zod";
import { logAdminAction } from "../db/adminAuditLog.js";
import { getAuthUser } from "../db/supabaseAdmin.js";
import {
  adminDestroySession,
  adminDestroyUserSessions,
  listSessions,
} from "../services/session/sessionManager.js";

export const adminSessionsRouter = Router();

const PHRASE_KILL_SESSION =
  "I understand killing this session loses unsaved code";

// ---------------------------------------------------------------------------
// GET /api/admin/sessions
// ---------------------------------------------------------------------------
// Joins each in-memory session with the owner's email by querying Supabase
// admin auth API once per distinct userId. We cache the email lookup for
// 5 min in-process so polling at 5s doesn't fan out to Supabase admin every
// tick — the active-session count is small (<= ~50) and the same set of
// owners stays steady across many polls.

interface EmailCacheEntry {
  email: string | null;
  expiresAt: number;
}
const emailCache = new Map<string, EmailCacheEntry>();
const EMAIL_CACHE_TTL_MS = 5 * 60_000;

async function emailFor(userId: string): Promise<string | null> {
  const now = Date.now();
  const hit = emailCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.email;
  try {
    const u = await getAuthUser(userId);
    const email = u?.email ?? null;
    emailCache.set(userId, { email, expiresAt: now + EMAIL_CACHE_TTL_MS });
    return email;
  } catch {
    // Soft-fail: surface as null email rather than 500-ing the whole list.
    emailCache.set(userId, { email: null, expiresAt: now + EMAIL_CACHE_TTL_MS });
    return null;
  }
}

adminSessionsRouter.get("/sessions", async (_req, res, next) => {
  try {
    const records = listSessions();
    const distinctUserIds = [...new Set(records.map((r) => r.userId))];
    const emails = new Map<string, string | null>();
    await Promise.all(
      distinctUserIds.map(async (uid) => emails.set(uid, await emailFor(uid))),
    );
    const now = Date.now();
    const sessions = records.map((r) => ({
      sessionId: r.id,
      userId: r.userId,
      userEmail: emails.get(r.userId) ?? null,
      // SessionHandle has a __kind discriminator: "aci" | "local-docker".
      // Surface as the simpler "aci" | "local" label the UI expects.
      backend:
        (r.handle as { __kind?: string } | null)?.__kind === "aci"
          ? "aci"
          : "local",
      ageMs: now - r.createdAt,
      lastSeenMs: now - r.lastSeen,
      selectedModel: r.selectedModel,
    }));
    res.json({ sessions, total: sessions.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/sessions/:sessionId
// ---------------------------------------------------------------------------

const killSessionBody = z
  .object({
    reason: z.string().min(4).max(500),
    confirmKill: z.string(),
  })
  .strict();

adminSessionsRouter.delete("/sessions/:sessionId", async (req, res, next) => {
  const sessionId = req.params.sessionId;
  const actorId = req.userId!;
  const parsed = killSessionBody.safeParse(req.body);
  if (!parsed.success) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: `session:${sessionId}`,
      after: req.body,
      reason: `validation: ${parsed.error.message}`,
    });
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.confirmKill !== PHRASE_KILL_SESSION) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: `session:${sessionId}`,
      after: parsed.data,
      reason: "missing or wrong confirmKill phrase",
    });
    return res.status(400).json({
      error: "confirmKill phrase required",
      requiredPhrase: PHRASE_KILL_SESSION,
    });
  }
  try {
    const destroyed = await adminDestroySession(sessionId);
    await logAdminAction({
      actorId,
      eventType: "session_terminated",
      targetKey: `session:${sessionId}`,
      after: { sessionId, destroyed },
      reason: parsed.data.reason,
    });
    if (!destroyed) {
      return res.status(404).json({ error: "session not found" });
    }
    res.json({ ok: true, sessionId });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/sessions/by-user/:userId
// ---------------------------------------------------------------------------

adminSessionsRouter.delete("/sessions/by-user/:userId", async (req, res, next) => {
  const userId = req.params.userId;
  const actorId = req.userId!;
  const parsed = killSessionBody.safeParse(req.body);
  if (!parsed.success) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetUserId: userId,
      after: req.body,
      reason: `validation: ${parsed.error.message}`,
    });
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.confirmKill !== PHRASE_KILL_SESSION) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetUserId: userId,
      after: parsed.data,
      reason: "missing or wrong confirmKill phrase",
    });
    return res.status(400).json({
      error: "confirmKill phrase required",
      requiredPhrase: PHRASE_KILL_SESSION,
    });
  }
  try {
    const destroyed = await adminDestroyUserSessions(userId);
    await logAdminAction({
      actorId,
      eventType: "session_terminated_bulk",
      targetUserId: userId,
      after: { count: destroyed.length, sessionIds: destroyed },
      reason: parsed.data.reason,
    });
    res.json({ ok: true, count: destroyed.length, sessionIds: destroyed });
  } catch (err) {
    next(err);
  }
});
