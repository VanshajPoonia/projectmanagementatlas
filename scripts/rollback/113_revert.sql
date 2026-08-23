-- Revert 113: remove work-item types.
--
-- DESTROYS: the type registry and every task's type. It destroys no task - tasks keep their
-- id, title, status, assignees, comments and hierarchy; they simply stop being typed, which is
-- the state the app was in before 113.
--
-- Order matters: the trigger goes first, because dropping tasks.type_key while the trigger
-- still references it would fail, and the FK goes with the column.

BEGIN;

DROP TRIGGER IF EXISTS enforce_work_item_type_hierarchy ON public.tasks;
DROP FUNCTION IF EXISTS private.enforce_work_item_type_hierarchy();

ALTER TABLE public.tasks DROP COLUMN IF EXISTS type_key;

DROP TRIGGER IF EXISTS protect_system_work_item_types ON public.work_item_types;
DROP FUNCTION IF EXISTS private.protect_system_work_item_types();
DROP TRIGGER IF EXISTS set_work_item_types_updated_at ON public.work_item_types;

DROP TABLE IF EXISTS public.work_item_types;

DO $$
DECLARE
  v_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'type_key'
  ) THEN
    RAISE EXCEPTION 'tasks.type_key survived the revert. Aborting.';
  END IF;

  -- 060's shape rules must be exactly as they were; this revert must not have touched them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_single_level_subtasks'
      AND tgrelid = 'public.tasks'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '060''s enforce_single_level_subtasks trigger was removed. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks;
  RAISE NOTICE '113 reverted: types removed, % tasks intact.', v_count;

  DELETE FROM public.applied_migrations WHERE filename = '113_work_item_types.sql';
END $$;

COMMIT;
