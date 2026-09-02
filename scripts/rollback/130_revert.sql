-- Revert 130 (idea pipeline).
--
-- ⚠️ THIS DESTROYS DATA. Every idea, every research note and the entire pipeline history goes
-- with it. The history is the irreplaceable part - it is the only record of what was rejected
-- and why. Dump first if the intent is "roll the code back, keep the record":
--
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only \
--     -t public.ideas -t public.idea_events -t public.idea_notes -Fc -f ideas-backup.dump
--
-- The `strategy` app_modules row belongs to 129 and is deliberately left alone here.

BEGIN;

DROP TRIGGER IF EXISTS record_idea_event  ON public.ideas;
DROP TRIGGER IF EXISTS enforce_idea_state ON public.ideas;
DROP TRIGGER IF EXISTS touch_ideas        ON public.ideas;
DROP TRIGGER IF EXISTS touch_idea_notes   ON public.idea_notes;

DROP FUNCTION IF EXISTS private.record_idea_event();
DROP FUNCTION IF EXISTS private.enforce_idea_state();

DROP TABLE IF EXISTS public.idea_notes;
DROP TABLE IF EXISTS public.idea_events;
DROP TABLE IF EXISTS public.ideas;

DELETE FROM public.applied_migrations WHERE filename = '130_idea_pipeline.sql';

COMMIT;
