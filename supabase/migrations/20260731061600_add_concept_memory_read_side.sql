-- Phase B1: honest concept-memory evidence and server-checked retrieval.
--
-- The Phase A learner_concept_ledger remains exposure history. These tables
-- add bounded evidence that can support a read-side without pretending that a
-- fast completion proves mastery. Practice evidence is explicitly marked as
-- client-observed; retrieval evidence is produced only after the backend
-- checks an answer against canonical course content.

CREATE TABLE public.learner_concept_evidence (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  concept_tag        text        NOT NULL,
  course_id          text        NOT NULL,
  lesson_id          text        NOT NULL,
  activity_id        text        NOT NULL,
  evidence_type      text        NOT NULL,
  evidence_source    text        NOT NULL,
  attempt_count      integer     NOT NULL DEFAULT 1,
  hint_count         integer     NOT NULL DEFAULT 0,
  time_spent_ms      integer     NOT NULL DEFAULT 0,
  model_assisted     boolean     NOT NULL DEFAULT false,
  request_id         uuid        NOT NULL,
  evidence_day       date        NOT NULL DEFAULT (timezone('utc', now())::date),
  occurred_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT learner_concept_evidence_type_ck CHECK (
    evidence_type IN (
      'practice_completed',
      'retrieval_first_attempt',
      'retrieval_after_feedback'
    )
  ),
  CONSTRAINT learner_concept_evidence_source_ck CHECK (
    evidence_source IN ('client_observed', 'server_verified')
  ),
  CONSTRAINT learner_concept_evidence_source_type_ck CHECK (
    (evidence_type = 'practice_completed' AND evidence_source = 'client_observed')
    OR
    (evidence_type IN ('retrieval_first_attempt', 'retrieval_after_feedback')
      AND evidence_source = 'server_verified')
  ),
  CONSTRAINT learner_concept_evidence_sizes_ck CHECK (
    length(concept_tag) BETWEEN 1 AND 64
    AND length(course_id) BETWEEN 1 AND 64
    AND length(lesson_id) BETWEEN 1 AND 64
    AND length(activity_id) BETWEEN 1 AND 64
  ),
  CONSTRAINT learner_concept_evidence_counts_ck CHECK (
    attempt_count BETWEEN 1 AND 100
    AND hint_count BETWEEN 0 AND 100
    AND time_spent_ms BETWEEN 0 AND 86400000
  )
);

-- A network retry is a no-op for every concept attached to the activity.
CREATE UNIQUE INDEX uq_learner_concept_evidence_request
  ON public.learner_concept_evidence (user_id, request_id, concept_tag);

-- Repeating the same practice rapidly cannot manufacture stronger evidence.
-- A later-day repetition remains available to the read model as a distinct
-- observation, while only server-verified retrieval may reach retained state.
CREATE UNIQUE INDEX uq_learner_concept_evidence_daily_activity
  ON public.learner_concept_evidence (
    user_id, course_id, lesson_id, activity_id, concept_tag,
    evidence_type, evidence_day
  );

CREATE INDEX idx_learner_concept_evidence_user_concept
  ON public.learner_concept_evidence (user_id, concept_tag, occurred_at DESC);

CREATE TABLE public.learner_retrieval_episodes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id             text        NOT NULL,
  lesson_id             text        NOT NULL,
  warmup_id             text        NOT NULL,
  warmup_version        integer     NOT NULL,
  concept_tags          text[]      NOT NULL,
  status                text        NOT NULL DEFAULT 'active',
  attempt_count         integer     NOT NULL DEFAULT 0,
  first_attempt_correct boolean,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,

  CONSTRAINT learner_retrieval_episodes_status_ck CHECK (
    status IN ('active', 'completed', 'superseded')
  ),
  CONSTRAINT learner_retrieval_episodes_sizes_ck CHECK (
    length(course_id) BETWEEN 1 AND 64
    AND length(lesson_id) BETWEEN 1 AND 64
    AND length(warmup_id) BETWEEN 1 AND 64
    AND cardinality(concept_tags) BETWEEN 1 AND 12
    AND warmup_version BETWEEN 1 AND 1000000
    AND attempt_count BETWEEN 0 AND 100
  ),
  CONSTRAINT learner_retrieval_episodes_completion_ck CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND first_attempt_correct IS NOT NULL)
    OR
    (status <> 'completed' AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX uq_learner_retrieval_active_episode
  ON public.learner_retrieval_episodes (
    user_id, course_id, lesson_id, warmup_id, warmup_version
  )
  WHERE status = 'active';

CREATE INDEX idx_learner_retrieval_user_lesson
  ON public.learner_retrieval_episodes (
    user_id, course_id, lesson_id, completed_at DESC
  );

CREATE TABLE public.learner_retrieval_answers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid        NOT NULL,
  episode_id      uuid        NOT NULL REFERENCES public.learner_retrieval_episodes(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  choice_index    integer     NOT NULL,
  is_correct      boolean     NOT NULL,
  attempt_number  integer     NOT NULL,
  answered_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT learner_retrieval_answers_choice_ck CHECK (choice_index BETWEEN 0 AND 7),
  CONSTRAINT learner_retrieval_answers_attempt_ck CHECK (attempt_number BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX uq_learner_retrieval_answers_user_request
  ON public.learner_retrieval_answers (user_id, request_id);

CREATE INDEX idx_learner_retrieval_answers_episode
  ON public.learner_retrieval_answers (episode_id, attempt_number);

ALTER TABLE public.learner_concept_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_retrieval_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learner_retrieval_answers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.learner_concept_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.learner_retrieval_episodes TO authenticated;
GRANT SELECT, INSERT ON public.learner_retrieval_answers TO authenticated;

CREATE POLICY learner_concept_evidence_select_own
  ON public.learner_concept_evidence
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY learner_concept_evidence_insert_own
  ON public.learner_concept_evidence
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY learner_retrieval_episodes_select_own
  ON public.learner_retrieval_episodes
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY learner_retrieval_episodes_insert_own
  ON public.learner_retrieval_episodes
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY learner_retrieval_episodes_update_own
  ON public.learner_retrieval_episodes
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY learner_retrieval_answers_select_own
  ON public.learner_retrieval_answers
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY learner_retrieval_answers_insert_own
  ON public.learner_retrieval_answers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.learner_concept_evidence IS
  'Phase B1 bounded concept evidence. Exposure remains in learner_concept_ledger; only server-verified retrieval can support retained state.';
COMMENT ON COLUMN public.learner_concept_evidence.evidence_source IS
  'client_observed practice is supporting evidence only; server_verified retrieval is checked against canonical authored content.';
