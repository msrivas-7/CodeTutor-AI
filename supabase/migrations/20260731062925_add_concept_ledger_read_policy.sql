-- Phase B1 follow-up: Phase A intentionally made the concept ledger
-- service-write-only. The memory read model drops to the authenticated role,
-- so grant only SELECT and expose only rows owned by auth.uid(). Anonymous
-- ip_hash rows remain unreadable and no client role receives write access.

GRANT SELECT ON public.learner_concept_ledger TO authenticated;

CREATE POLICY learner_concept_ledger_select_own
  ON public.learner_concept_ledger
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
