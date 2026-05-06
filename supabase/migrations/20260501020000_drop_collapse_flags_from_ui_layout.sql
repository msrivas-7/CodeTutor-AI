-- Phase 27 follow-up: panel collapse flags moved from server-stored
-- user_preferences.ui_layout to localStorage (frontend commit
-- c686fdc — fix(phase-27): panel collapse flags are device-local).
--
-- The four boolean keys that previously lived inside ui_layout JSON
-- are now read-from / written-to localStorage on each device, so
-- the server copies are dormant data after the frontend deploy.
-- This migration strips them from the JSON column so a future
-- DB dump / audit / dashboard pull doesn't surface stale values
-- that the application no longer respects.
--
-- Keys removed:
--   ui:lesson:tutorCollapsed     (LessonPage tutor rail)
--   ui:lesson:instrCollapsed     (LessonPage instructions rail)
--   ui:editor:tutorCollapsed     (EditorPage tutor rail)
--   ui:editor:filesCollapsed     (EditorPage files rail)
--
-- Panel WIDTHS (ui:lesson:instrW, ui:lesson:tutorW, ui:lesson:outputH,
-- ui:editor:leftW, ui:editor:rightW, ui:editor:outputH) STAY in
-- ui_layout — splitter geometry should travel cross-device for power
-- users who tune their layout on a primary monitor.
--
-- Idempotent: the `?|` array test only matches rows that still have
-- one of the keys; running this twice is a no-op the second time.
-- The `-` operator on jsonb returns the same row when the key is
-- absent, so per-row writes only happen once per user (until a
-- future bug re-introduces the key).
--
-- Storage win is trivial (~40 bytes / user) — this is cosmetic, not
-- correctness-critical. Run as part of the regular Phase 27 dev/prod
-- deploy alongside the other 20260501* migrations.

UPDATE public.user_preferences
   SET ui_layout = ui_layout
       - 'ui:lesson:tutorCollapsed'
       - 'ui:lesson:instrCollapsed'
       - 'ui:editor:tutorCollapsed'
       - 'ui:editor:filesCollapsed',
       updated_at = now()
 WHERE ui_layout ?| ARRAY[
       'ui:lesson:tutorCollapsed',
       'ui:lesson:instrCollapsed',
       'ui:editor:tutorCollapsed',
       'ui:editor:filesCollapsed'
   ];
