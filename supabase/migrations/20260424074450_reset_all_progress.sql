-- Wipe all learner progress + reset onboarding flags so every existing
-- account sees the first-run cinematic on next login, identical to a
-- brand-new signup. Pre-launch data reset — not a repeatable
-- migration in spirit, but lives in the migrations folder so the
-- state on dev + prod is tracked.
--
-- What gets wiped:
--   * lesson_progress — status, attempts, saved code per lesson,
--     practice-exercise completion.
--   * course_progress — course-level aggregate, completed-lesson lists.
--   * editor_project (singular) — the free-form editor's saved buffers.
--
-- What gets reset (user_preferences row UPDATEs, schema untouched):
--   * welcome_done → false
--   * workspace_coach_done → false
--   * editor_coach_done → false
--   * last_welcome_back_at → NULL
--
-- What's explicitly preserved:
--   * auth.users row (identity)
--   * persona / theme / openai_model / ui_layout — real preferences
--   * openai_api_key_cipher + nonce — BYOK key survives
--   * paid_access_shown_at — paid-interest flag
--   * ai_usage_ledger, ai_user_costs_denorm, feedback, denylist — all
--     untouched. They track history and cost, not learner state.
--
-- The frontend's StartPage backfill (the FIRST_RUN_SHIP_DATE gate that
-- silently flipped welcome_done=true for accounts predating the feature
-- ship) was removed in the same PR as this migration. Without that
-- removal, this wipe would self-cancel within seconds of the first
-- post-migration login. Deploy the frontend change BEFORE pushing this
-- SQL.

TRUNCATE public.lesson_progress, public.course_progress, public.editor_project;

UPDATE public.user_preferences
   SET welcome_done = false,
       workspace_coach_done = false,
       editor_coach_done = false,
       last_welcome_back_at = NULL,
       updated_at = now();
