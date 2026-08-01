-- Phase B1 trust-boundary correction: retrieval/practice evidence is scored
-- and classified by the backend. An authenticated browser may read only its
-- own rows, but must not insert or update rows through the exposed Data API;
-- otherwise it could label arbitrary client data as server_verified.

REVOKE ALL PRIVILEGES ON TABLE public.learner_concept_evidence
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.learner_retrieval_episodes
  FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.learner_retrieval_answers
  FROM anon, authenticated;

GRANT SELECT ON TABLE public.learner_concept_evidence TO authenticated;
GRANT SELECT ON TABLE public.learner_retrieval_episodes TO authenticated;
GRANT SELECT ON TABLE public.learner_retrieval_answers TO authenticated;

DROP POLICY IF EXISTS learner_concept_evidence_insert_own
  ON public.learner_concept_evidence;
DROP POLICY IF EXISTS learner_retrieval_episodes_insert_own
  ON public.learner_retrieval_episodes;
DROP POLICY IF EXISTS learner_retrieval_episodes_update_own
  ON public.learner_retrieval_episodes;
DROP POLICY IF EXISTS learner_retrieval_answers_insert_own
  ON public.learner_retrieval_answers;

COMMENT ON TABLE public.learner_concept_evidence IS
  'Phase B1 bounded concept evidence. Authenticated users may read only their rows; all evidence writes are backend-owned and client writes are revoked.';
COMMENT ON TABLE public.learner_retrieval_episodes IS
  'Phase B1 server-owned retrieval episodes. Authenticated users have own-row read access only.';
COMMENT ON TABLE public.learner_retrieval_answers IS
  'Phase B1 server-checked retrieval answers. Authenticated users have own-row read access only.';
