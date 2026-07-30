-- Phase A — A6 (memory v0): write-only learner concept-tag ledger.
--
-- Every time a learner completes a lesson, we write one row per concept
-- the lesson teaches/uses, keyed by user_id (authed) OR ip_hash (anon
-- pre-signup). This is the data substrate Phase B's read-side will use
-- (concept-mastery graph, retrieval-warmup beats, Socratic try-first
-- gate). Phase A is WRITE-ONLY — no read API, no UI surfacing.
--
-- Why ship the write side now: every day delayed is dataset never
-- recovered. Once Phase A traffic lands, the ledger captures concept-
-- tags from day 1 so Phase B has a real corpus to work against. Without
-- this, Phase B's memory work starts from zero data.
--
-- Dual-key pattern (user_id + ip_hash) mirrors ai_anon_usage_ledger:
-- one of them must be set, never both required. RLS deny-all-by-default
-- (service-role writes only); read-side policy ships in Phase B.
--
-- Idempotency: re-completing a lesson should NOT double-insert. UNIQUE
-- partial indexes (one for each key path) enforce this at the DB layer.

CREATE TABLE IF NOT EXISTS public.learner_concept_ledger (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid          REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash      text,
  concept_tag  text          NOT NULL,
  course_id    text          NOT NULL,
  lesson_id    text          NOT NULL,
  -- 'taught'   = lesson teaches this concept (from teachesConceptTags)
  -- 'used'     = lesson uses this concept (from usesConceptTags)
  -- 'practiced'= practice exercise of this concept completed
  event_type   text          NOT NULL,
  occurred_at  timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT learner_concept_ledger_event_type_val
    CHECK (event_type IN ('taught', 'used', 'practiced')),
  -- Exactly one of (user_id, ip_hash) must be set. NULL on both is
  -- ambiguous; both set is also invalid (we never stitch anon→authed
  -- via ip_hash — that's Phase B if at all).
  CONSTRAINT learner_concept_ledger_owner_ck
    CHECK (
      (user_id IS NOT NULL AND ip_hash IS NULL)
      OR
      (user_id IS NULL AND ip_hash IS NOT NULL)
    ),
  CONSTRAINT learner_concept_ledger_ip_hash_shape
    CHECK (ip_hash IS NULL OR length(ip_hash) BETWEEN 16 AND 128),
  CONSTRAINT learner_concept_ledger_concept_tag_size
    CHECK (length(concept_tag) BETWEEN 1 AND 64),
  CONSTRAINT learner_concept_ledger_course_id_size
    CHECK (length(course_id) BETWEEN 1 AND 64),
  CONSTRAINT learner_concept_ledger_lesson_id_size
    CHECK (length(lesson_id) BETWEEN 1 AND 64)
);

-- Read-side index for "all concepts this learner has touched, most-recent first."
-- Phase B will hit this for the mastery graph + retrieval-warmup picker.
CREATE INDEX IF NOT EXISTS idx_learner_concept_ledger_user_concept
  ON public.learner_concept_ledger (user_id, concept_tag, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learner_concept_ledger_ip_concept
  ON public.learner_concept_ledger (ip_hash, concept_tag, occurred_at DESC)
  WHERE ip_hash IS NOT NULL;

-- Idempotency guards: re-completing a lesson MUST NOT double-insert
-- the same (owner, course, lesson, concept, event) tuple.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learner_concept_ledger_user
  ON public.learner_concept_ledger (user_id, course_id, lesson_id, concept_tag, event_type)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_learner_concept_ledger_ip
  ON public.learner_concept_ledger (ip_hash, course_id, lesson_id, concept_tag, event_type)
  WHERE ip_hash IS NOT NULL;

ALTER TABLE public.learner_concept_ledger ENABLE ROW LEVEL SECURITY;
