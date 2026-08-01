-- Release B4 — privacy-bounded distribution attribution.
--
-- The existing anonymous funnel could answer "did the trial progress?" but
-- not "which discovery surface started it?". Keep the answer deliberately
-- coarse: three first-touch channels, a small medium vocabulary, bounded
-- content slugs, and a one-way digest for a referring public share. Raw
-- referrer URLs, query strings, learner code, emails, and share tokens never
-- land in this table.

ALTER TABLE public.phase27_funnel_events
  ADD COLUMN acquisition_source text NOT NULL DEFAULT 'direct',
  ADD COLUMN acquisition_medium text,
  ADD COLUMN acquisition_campaign text,
  ADD COLUMN acquisition_content text,
  ADD COLUMN referring_share_hash text;

ALTER TABLE public.phase27_funnel_events
  DROP CONSTRAINT phase27_funnel_events_event_val,
  ADD CONSTRAINT phase27_funnel_events_event_val
    CHECK (event IN (
      'anon_page_view',
      'anon_first_run',
      'anon_lesson_completed',
      'anon_wall_opened',
      'anon_signup_completed',
      'anon_lesson2_reached'
    )),
  ADD CONSTRAINT phase27_funnel_events_acquisition_source_val
    CHECK (acquisition_source IN ('direct', 'organic', 'share')),
  ADD CONSTRAINT phase27_funnel_events_acquisition_medium_val
    CHECK (
      acquisition_medium IS NULL OR
      acquisition_medium IN ('lesson_page', 'category_page', 'lesson_share')
    ),
  ADD CONSTRAINT phase27_funnel_events_acquisition_campaign_shape
    CHECK (
      acquisition_campaign IS NULL OR
      acquisition_campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ),
  ADD CONSTRAINT phase27_funnel_events_acquisition_content_shape
    CHECK (
      acquisition_content IS NULL OR
      acquisition_content ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ),
  ADD CONSTRAINT phase27_funnel_events_referring_share_hash_shape
    CHECK (
      referring_share_hash IS NULL OR
      referring_share_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT phase27_funnel_events_acquisition_coherence
    CHECK (
      (
        acquisition_source = 'direct' AND
        acquisition_medium IS NULL AND
        acquisition_campaign IS NULL AND
        acquisition_content IS NULL AND
        referring_share_hash IS NULL
      ) OR
      (
        acquisition_source = 'organic' AND
        acquisition_medium IN ('lesson_page', 'category_page') AND
        acquisition_campaign IS NOT NULL AND
        referring_share_hash IS NULL
      ) OR
      (
        acquisition_source = 'share' AND
        acquisition_medium = 'lesson_share' AND
        acquisition_campaign IS NOT NULL AND
        acquisition_content IS NOT NULL AND
        referring_share_hash IS NOT NULL
      )
    );

-- The admin distribution report is a bounded UTC-window GROUP BY over
-- source + event. Put equality columns first and time last so both the
-- source cohort and date range are indexable as traffic grows.
CREATE INDEX idx_phase27_funnel_events_source_event_today
  ON public.phase27_funnel_events (
    acquisition_source,
    event,
    occurred_at
  );

COMMENT ON COLUMN public.phase27_funnel_events.referring_share_hash IS
  'SHA-256 labeled digest of the public share token; raw token is never stored.';
