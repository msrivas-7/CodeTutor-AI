// Phase 25: admin-role-gated platform-auth unstick.
//
// The legacy METRICS_TOKEN/loopback-only POST /api/admin/unstick-platform-auth
// in index.ts stays as a break-glass path (operator can curl it from the VM
// without a JWT). This route is the same operation behind the standard admin
// chain so the dashboard's "Clear flag" button works without leaking the
// metrics token to the browser.

import { Router } from "express";
import { z } from "zod";
import { logAdminAction } from "../db/adminAuditLog.js";
import {
  clearPlatformAuthFailed,
  getPlatformAuthStatus,
} from "../services/ai/credential.js";

export const adminPlatformAuthRouter = Router();

const PHRASE_UNSTICK =
  "I understand this may hammer an invalid OpenAI key";

const unstickBody = z
  .object({
    reason: z.string().min(4).max(500),
    confirmUnstick: z.string(),
  })
  .strict();

adminPlatformAuthRouter.get("/platform-auth", (_req, res) => {
  const status = getPlatformAuthStatus();
  res.json({
    failed: !!status,
    sinceMs: status?.sinceMs ?? null,
  });
});

adminPlatformAuthRouter.post("/platform-auth/unstick", async (req, res, next) => {
  const actorId = req.userId!;
  const parsed = unstickBody.safeParse(req.body);
  if (!parsed.success) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: "platform_auth",
      after: req.body,
      reason: `validation: ${parsed.error.message}`,
    });
    return res.status(400).json({ error: parsed.error.message });
  }
  if (parsed.data.confirmUnstick !== PHRASE_UNSTICK) {
    await logAdminAction({
      actorId,
      eventType: "rejected_attempt",
      targetKey: "platform_auth",
      after: parsed.data,
      reason: "missing or wrong confirmUnstick phrase",
    });
    return res.status(400).json({
      error: "confirmUnstick phrase required",
      requiredPhrase: PHRASE_UNSTICK,
    });
  }
  try {
    const before = getPlatformAuthStatus();
    clearPlatformAuthFailed();
    await logAdminAction({
      actorId,
      eventType: "platform_auth_unstick",
      targetKey: "platform_auth",
      before: { failed: !!before, sinceMs: before?.sinceMs ?? null },
      after: { failed: false },
      reason: parsed.data.reason,
    });
    res.json({ ok: true, wasFailed: !!before });
  } catch (err) {
    next(err);
  }
});
