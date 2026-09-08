-- Revert 133 (milestones).
--
-- ⚠️ THIS DESTROYS DATA - every milestone, its owner, its state, the reason any date was
-- missed, and every link from a milestone to the work delivering it. Dump first if the record
-- matters:
--
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only \
--     -t public.milestones -t public.milestone_tasks -Fc -f milestones.dump
--
-- The TASKS themselves are untouched: milestone_tasks holds only the link, so reverting takes
-- the plan away and leaves every work item exactly where it was.
--
-- ⚠️ Run scripts/rollback/134_revert.sql FIRST if 134 was applied. goal_links.milestone_id
-- has a foreign key onto this table, and 132's revert is the recorded lesson about ordering:
-- dropping a thing other objects depend on aborts the whole transaction.
--
-- Tables before functions, for the same reason: a POLICY depends on the function it calls.

BEGIN;

DROP TABLE IF EXISTS public.milestone_tasks;
DROP TABLE IF EXISTS public.milestones;

DROP FUNCTION IF EXISTS private.enforce_milestone_task_board();
DROP FUNCTION IF EXISTS private.enforce_milestone_state();
DROP FUNCTION IF EXISTS private.is_blank(TEXT);

DELETE FROM public.applied_migrations WHERE filename = '133_milestones.sql';

DO $$
BEGIN
  IF to_regclass('public.milestones') IS NOT NULL
     OR to_regclass('public.milestone_tasks') IS NOT NULL THEN
    RAISE EXCEPTION 'A milestone table survived the revert. Aborting.';
  END IF;
  RAISE NOTICE '133 reverted: both tables and both trigger functions dropped.';
END $$;

COMMIT;
