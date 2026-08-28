-- Rollback for 121_status_awaiting_approval.sql.
--
-- Destroys which statuses were marked as awaiting approval. That is a handful of booleans a
-- super admin can re-tick in Super Admin -> Statuses, so this is the cheapest revert in the
-- repo - but it is still a decision somebody made, so if there are several:
--
--   \copy (SELECT key, is_approval FROM public.task_statuses WHERE is_approval) TO 'approval_statuses.csv' CSV HEADER
--
-- No task moves, no status is renamed, archived or recategorised, and nothing that decides
-- open-vs-closed is touched.
--
-- ── Sequence this with a client change ──────────────────────────────────────────────
-- My Work, WorkNext and the status admin screen all select this column. Revert the CODE
-- first, confirm the deploy, then run this.

BEGIN;

ALTER TABLE public.task_statuses DROP COLUMN IF EXISTS is_approval;

DELETE FROM public.applied_migrations WHERE filename = '121_status_awaiting_approval.sql';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_statuses' AND column_name = 'is_approval'
  ) THEN
    RAISE EXCEPTION 'is_approval survived the revert. Aborting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_statuses' AND column_name = 'category'
  ) THEN
    RAISE EXCEPTION 'task_statuses lost its category column. Aborting.';
  END IF;

  RAISE NOTICE '121 reverted: task_statuses.is_approval is gone; % status(es) intact.',
    (SELECT count(*) FROM public.task_statuses);
END $$;

COMMIT;
