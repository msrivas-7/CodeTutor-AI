// Phase 25: read-only email log surface for the admin console.
//
// The send side (services/email/sentLog.ts) writes a row per send.
// Pre-Phase-25 the operator queried this via psql; the dashboard now
// surfaces the table with cursor pagination + filter by kind / email
// substring. No write actions on this router.

import { Router } from "express";
import { z } from "zod";
import { listEmailLog, listEmailLogKinds } from "../db/emailLog.js";

export const adminEmailLogRouter = Router();

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  kind: z.string().max(64).optional(),
  toEmailLike: z.string().max(200).optional(),
});

adminEmailLogRouter.get("/email-log", async (req, res, next) => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const { cursor, limit, kind, toEmailLike } = parsed.data;
    const result = await listEmailLog({
      cursor: cursor ?? null,
      limit,
      kind: kind ?? null,
      toEmailLike: toEmailLike ?? null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

adminEmailLogRouter.get("/email-log/kinds", async (_req, res, next) => {
  try {
    const kinds = await listEmailLogKinds();
    res.json({ kinds });
  } catch (err) {
    next(err);
  }
});
