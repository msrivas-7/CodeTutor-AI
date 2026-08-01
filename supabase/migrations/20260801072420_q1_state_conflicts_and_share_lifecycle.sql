-- Q1: durable conflict detection for editor and lesson drafts, plus a
-- one-active-share-per-lesson lifecycle. Browser writes remain routed through
-- the authenticated backend; RLS continues to protect direct table access.

ALTER TABLE public.editor_project
  ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN writer_id uuid;

ALTER TABLE public.lesson_progress
  ADD COLUMN draft_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN draft_writer_id uuid,
  ADD COLUMN draft_updated_at timestamptz;

ALTER TABLE public.shared_lesson_completions
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN rotated_at timestamptz;

-- Older builds allowed several active links for one authenticated learner and
-- lesson. Preserve the newest artifact and revoke the older duplicates before
-- enforcing the lifecycle invariant. Anonymous shares intentionally remain
-- independent because they have no account inventory.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, course_id, lesson_id
           ORDER BY created_at DESC, id DESC
         ) AS position
    FROM public.shared_lesson_completions
   WHERE user_id IS NOT NULL
     AND revoked_at IS NULL
)
UPDATE public.shared_lesson_completions AS share
   SET revoked_at = now(),
       updated_at = now(),
       revision = revision + 1
  FROM ranked
 WHERE share.id = ranked.id
   AND ranked.position > 1;

CREATE UNIQUE INDEX shared_lesson_completions_one_active_owner_lesson
  ON public.shared_lesson_completions (user_id, course_id, lesson_id)
  WHERE user_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX shared_lesson_completions_owner_active_created
  ON public.shared_lesson_completions (user_id, created_at DESC)
  WHERE user_id IS NOT NULL AND revoked_at IS NULL;

COMMENT ON COLUMN public.editor_project.revision IS
  'Monotonic compare-and-swap revision used to reject stale cross-tab or cross-device saves.';
COMMENT ON COLUMN public.lesson_progress.draft_revision IS
  'Monotonic compare-and-swap revision for last_code only; progress counters use monotonic merge semantics.';
COMMENT ON INDEX public.shared_lesson_completions_one_active_owner_lesson IS
  'Authenticated learners manage one current public artifact per lesson; rotate/update instead of accumulating hidden links.';
