-- Revert 115: remove work-item relations.
--
-- DESTROYS: every relation between work items (what blocks what, what precedes what). It
-- destroys no task. Dump first if the intent is "roll back the code, keep the graph":
--
--   \copy public.task_relations to 'task_relations.csv' csv header
--
-- task_links is a DIFFERENT table (external URL bookmarks) and is not touched.

BEGIN;

DROP VIEW IF EXISTS public.task_relations_expanded;
DROP TRIGGER IF EXISTS enforce_task_relation_integrity ON public.task_relations;
DROP FUNCTION IF EXISTS private.enforce_task_relation_integrity();
DROP TABLE IF EXISTS public.task_relations;

DO $$
DECLARE
  v_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'task_relations'
  ) THEN
    RAISE EXCEPTION 'task_relations survived the revert. Aborting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'task_links'
  ) THEN
    RAISE EXCEPTION 'task_links was dropped - that is the URL bookmark table, not relations. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks;
  RAISE NOTICE '115 reverted: relations removed, % tasks intact.', v_count;

  DELETE FROM public.applied_migrations WHERE filename = '115_task_relations.sql';
END $$;

COMMIT;
