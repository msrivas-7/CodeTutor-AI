import { db } from "./client.js";
import { listUserEvalSamples } from "./aiEvalSamples.js";

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
//   * concept exposure/evidence + retrieval episodes/answers — full learner-
//     owned evidence history. Canonical correct answers are not stored in
//     these tables, so the export contains only the learner's choice and the
//     server-checked outcome.
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
  conceptExposure: Array<Record<string, unknown>>;
  conceptEvidence: Array<Record<string, unknown>>;
  retrievalEpisodes: Array<Record<string, unknown>>;
  retrievalAnswers: Array<Record<string, unknown>>;
  aiEvalSamples: Array<Record<string, unknown>>;
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
    conceptExposureRows,
    conceptEvidenceRows,
    retrievalEpisodeRows,
    retrievalAnswerRows,
    aiEvalSampleRows,
  ] = await Promise.all([
    sql`
      SELECT persona, openai_model, theme, welcome_done, workspace_coach_done,
             editor_coach_done, ui_layout,
             (openai_api_key_cipher IS NOT NULL) AS has_openai_key,
             updated_at, paid_access_shown_at
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
    sql`
      SELECT concept_tag, course_id, lesson_id, event_type, occurred_at
        FROM public.learner_concept_ledger
       WHERE user_id = ${userId}
       ORDER BY occurred_at DESC
    `,
    sql`
      SELECT concept_tag, course_id, lesson_id, activity_id, evidence_type,
             evidence_source, attempt_count, hint_count, time_spent_ms,
             model_assisted, evidence_day, occurred_at
        FROM public.learner_concept_evidence
       WHERE user_id = ${userId}
       ORDER BY occurred_at DESC
    `,
    sql`
      SELECT id, course_id, lesson_id, warmup_id, warmup_version,
             concept_tags, status, attempt_count, first_attempt_correct,
             created_at, updated_at, completed_at
        FROM public.learner_retrieval_episodes
       WHERE user_id = ${userId}
       ORDER BY created_at DESC
    `,
    sql`
      SELECT request_id, episode_id, choice_index, is_correct,
             attempt_number, answered_at
        FROM public.learner_retrieval_answers
       WHERE user_id = ${userId}
       ORDER BY answered_at DESC
    `,
    listUserEvalSamples(userId),
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
    conceptExposure: conceptExposureRows as Array<Record<string, unknown>>,
    conceptEvidence: conceptEvidenceRows as Array<Record<string, unknown>>,
    retrievalEpisodes: retrievalEpisodeRows as Array<Record<string, unknown>>,
    retrievalAnswers: retrievalAnswerRows as Array<Record<string, unknown>>,
    aiEvalSamples: aiEvalSampleRows,
  };
}
