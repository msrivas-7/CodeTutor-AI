import { db } from "./client.js";

// Phase 20-P1: feedback insert helper. The route handler validates shape +
// owner before calling in; this layer is the last write barrier — it MUST
// pin user_id to the authenticated caller and NEVER accept a user_id
// argument (the row-level ownership policy would catch it, but defense in
// depth: don't expose a footgun that could dump arbitrary user_ids).

export type FeedbackCategory = "bug" | "idea" | "other";

export interface InsertFeedbackArgs {
  userId: string;
  body: string;
  category: FeedbackCategory;
  diagnostics: Record<string, unknown>;
}

export interface FeedbackRow {
  id: string;
  createdAt: string;
}

export async function insertFeedback(args: InsertFeedbackArgs): Promise<FeedbackRow> {
  const sql = db();
  const rows = await sql<Array<{ id: string; created_at: Date }>>`
    INSERT INTO public.feedback (user_id, body, category, diagnostics)
    VALUES (${args.userId}, ${args.body}, ${args.category}, ${sql.json(args.diagnostics as Record<string, never>)})
    RETURNING id, created_at
  `;
  const row = rows[0];
  return { id: row.id, createdAt: row.created_at.toISOString() };
}
