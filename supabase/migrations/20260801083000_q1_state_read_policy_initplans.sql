-- Q1 follow-up: owner-read policies remain useful after browser writes are
-- revoked. Wrap auth.uid() in a scalar subquery so Postgres evaluates it once
-- per statement instead of once per row.

ALTER POLICY course_progress_own ON public.course_progress
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY lesson_progress_own ON public.lesson_progress
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER POLICY editor_project_own ON public.editor_project
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
