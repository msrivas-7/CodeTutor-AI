-- Q1: progress, editor conflict state, and public-share lifecycle are
-- server-authoritative. RLS ownership is not sufficient when the browser role
-- can still forge its own completion, overwrite CAS revisions, or mutate a
-- public artifact without the backend validation and cleanup path.

REVOKE ALL PRIVILEGES ON TABLE public.course_progress FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.lesson_progress FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.editor_project FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.shared_lesson_completions FROM anon, authenticated;

-- Authenticated direct reads remain owner-scoped by the existing RLS policies.
-- The share artifact is intentionally readable by either browser role while
-- non-revoked; lifecycle mutations still go through the authenticated API.
GRANT SELECT ON TABLE public.course_progress TO authenticated;
GRANT SELECT ON TABLE public.lesson_progress TO authenticated;
GRANT SELECT ON TABLE public.editor_project TO authenticated;
GRANT SELECT ON TABLE public.shared_lesson_completions TO anon, authenticated;

DROP POLICY IF EXISTS shared_completions_owner_insert
  ON public.shared_lesson_completions;
DROP POLICY IF EXISTS shared_completions_owner_update
  ON public.shared_lesson_completions;
DROP POLICY IF EXISTS shared_completions_owner_delete
  ON public.shared_lesson_completions;

COMMENT ON TABLE public.lesson_progress IS
  'Learner-visible progress with authenticated owner reads; all mutations are validated by the backend.';
COMMENT ON TABLE public.editor_project IS
  'Authenticated owner-readable editor state; writes use backend compare-and-swap revisions.';
COMMENT ON TABLE public.shared_lesson_completions IS
  'Public non-revoked artifacts; create, edit, rotate, and revoke operations are backend-only.';
