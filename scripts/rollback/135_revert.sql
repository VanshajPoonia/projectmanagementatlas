-- Revert 135 (tasks.start_date).
--
-- ⚠️ THIS DESTROYS DATA - every planned start date anyone has set on the timeline. Due dates
-- are untouched, so work stays scheduled; it just loses its duration and every bar becomes a
-- single-day tick again. Dump first if it matters:
--
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only -t public.tasks -Fc -f tasks.dump
--
-- The constraint goes with the column, because it names it. Nothing else on `tasks` is
-- touched: no trigger, no policy and no other column, which is the same claim 135's own
-- post-conditions made on the way in.

BEGIN;

DROP INDEX IF EXISTS idx_tasks_start_date;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_start_before_due;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS start_date;

DELETE FROM public.applied_migrations WHERE filename = '135_task_start_date.sql';

DO $$
DECLARE v_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'start_date'
  ) THEN
    RAISE EXCEPTION 'tasks.start_date survived the revert. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal;
  RAISE NOTICE '135 reverted: start_date and its constraint gone, % triggers on tasks intact.',
    v_count;
END $$;

COMMIT;
