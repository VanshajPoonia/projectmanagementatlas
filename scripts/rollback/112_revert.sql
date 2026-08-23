-- Revert 112: drop the normalized status category.
--
-- DESTROYS: the categorisation itself (which status means started, which means cancelled) and
-- any icon a super admin chose. It destroys no task data - task_statuses rows, their keys,
-- labels, colours and positions are untouched, and nothing references the dropped columns by
-- foreign key.
--
-- After this runs, lib/task-status.ts falls back to substring matching for every status, which
-- is the behaviour 112 was written to end. Only run it alongside reverting that code.

BEGIN;

ALTER TABLE public.task_statuses
  DROP COLUMN IF EXISTS is_closed,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS icon;

-- The CHECK constraint is dropped with its column; assert nothing survived it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_statuses'::regclass AND conname = 'task_statuses_category_check'
  ) THEN
    RAISE EXCEPTION 'task_statuses_category_check outlived its column. Aborting.';
  END IF;

  DELETE FROM public.applied_migrations WHERE filename = '112_status_categories.sql';
END $$;

COMMIT;
