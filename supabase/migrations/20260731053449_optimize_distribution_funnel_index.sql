-- The admin reports constrain occurred_at to the current UTC day, then group
-- by source/event. Lead with the range column so Postgres can discard older
-- telemetry before reading the low-cardinality cohort fields.
DROP INDEX IF EXISTS public.idx_phase27_funnel_events_source_event_today;

CREATE INDEX idx_phase27_funnel_events_today_source_event
  ON public.phase27_funnel_events (
    occurred_at,
    acquisition_source,
    event
  );
