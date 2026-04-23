import { db } from "./client.js";

// P-3 scaffold: user-owned data export. One entry point queries every table
// the learner owns a row in, strips non-user fields (encrypted secrets,
// internal denorm columns), and returns a JSON bundle the route streams
// back. Scope decisions:
//
//   * `user_preferences` — included EXCEPT `openai_api_key_cipher` and
//     `openai_api_key_nonce`. The key is encrypted at rest with a master
//     key the user doesn't own, so exporting ciphertext would be noise.
//     `has_openai_key` boolean flag is included so the user knows whether
//     they set one. Nonce is dropped to match.
//   * `course_progress` / `lesson_progress` / `editor_project` — full rows.
//   * `ai_usage_ledger` — tokens, cost, model, route, created_at only.
//     Rows do not store prompts or outputs; the schema ensures this.
//   * `paid_access_interest` / `ai_platform_denylist` — full row if present,
//     `null` if absent. Denylist reason is operator-written and shown per
//     GDPR Art. 15 ("right of access") — a learner flagged as abusive is
//     entitled to see the reason the operator recorded.
//   * `feedback` — only rows currently owned by this user (user_id =
//     auth.uid()). Ghost rows (user_id IS NULL) from previous account
//     deletions are never re-associated.
//
// Deliberately excluded:
//   * `user_ai_costs` — internal denorm rebuildable from ai_usage_ledger.
//   * `auth.users` row — email is already visible to the user via Supabase
//     Auth; including it here duplicates without adding to the Art. 15 story.

export interface UserExportBundle {
  exportedAt: string;
  userId: string;
  preferences: Record<string, unknown> | null;
  courseProgress: Array<Record<string, unknown>>;
  lessonProgress: Array<Record<string, unknown>>;
  editorProject: Record<string, unknown> | null;
  aiUsageLedger: Array<Record<string, unknown>>;
  paidAccessInterest: Record<string, unknown> | null;
  platformDenylist: Record<string, unknown> | null;
  feedback: Array<Record<string, unknown>>;
}

export async function buildUserExport(userId: string): Promise<UserExportBundle> {
  const sql = db();

  // Strip encrypted-key columns at the SELECT level so the ciphertext never
  // leaves Postgres. `has_openai_key` is the boolean learners already see
  // in preferences responses; fine to include.
  const [
    prefsRows,
    coursesRows,
    lessonsRows,
    editorRows,
    ledgerRows,
    paidRows,
    denyRows,
    feedbackRows,
  ] = await Promise.all([
    sql`
      SELECT persona, openai_model, theme, welcome_done, workspace_coach_done,
             editor_coach_done, ui_layout, has_openai_key, updated_at,
             paid_access_shown_at
        FROM public.user_preferences
       WHERE user_id = ${userId}
    `,
    sql`
      SELECT course_id, status, started_at, completed_at, last_lesson_id,
             completed_lesson_ids, updated_at
        FROM public.course_progress
       WHERE user_id = ${userId}
       ORDER BY updated_at DESC
    `,
    sql`
      SELECT course_id, lesson_id, status, started_at, completed_at,
             attempt_count, run_count, hint_count, time_spent_ms,
             last_code, last_output, practice_completed_ids,
             practice_exercise_code, updated_at
        FROM public.lesson_progress
       WHERE user_id = ${userId}
       ORDER BY updated_at DESC
    `,
    sql`
      SELECT language, files, active_file, open_tabs, file_order, stdin,
             updated_at
        FROM public.editor_project
       WHERE user_id = ${userId}
    `,
    sql`
      SELECT created_at, model, funding_source, route, input_tokens,
             output_tokens, cost_usd, status
        FROM public.ai_usage_ledger
       WHERE user_id = ${userId}
       ORDER BY created_at DESC
    `,
    sql`
      SELECT email, display_name, first_clicked_at, last_clicked_at,
             click_count, notes
        FROM public.paid_access_interest
       WHERE user_id = ${userId}
    `,
    sql`
      SELECT reason, denied_at
        FROM public.ai_platform_denylist
       WHERE user_id = ${userId}
    `,
    sql`
      SELECT id, body, category, mood, lesson_id, diagnostics, created_at
        FROM public.feedback
       WHERE user_id = ${userId}
       ORDER BY created_at DESC
    `,
  ]);

  return {
    exportedAt: new Date().toISOString(),
    userId,
    preferences: (prefsRows[0] as Record<string, unknown>) ?? null,
    courseProgress: coursesRows as Array<Record<string, unknown>>,
    lessonProgress: lessonsRows as Array<Record<string, unknown>>,
    editorProject: (editorRows[0] as Record<string, unknown>) ?? null,
    aiUsageLedger: ledgerRows as Array<Record<string, unknown>>,
    paidAccessInterest: (paidRows[0] as Record<string, unknown>) ?? null,
    platformDenylist: (denyRows[0] as Record<string, unknown>) ?? null,
    feedback: feedbackRows as Array<Record<string, unknown>>,
  };
}
