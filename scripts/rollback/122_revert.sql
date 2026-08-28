-- Rollback for 122_notify_task_watchers.sql.
--
-- Destroys nothing. The function creates notifications; dropping it stops new ones being
-- created and leaves every notification it already made exactly where it is.
--
-- ── Sequence this with a client change ──────────────────────────────────────────────
-- The comment box and the task-update path call this RPC. Reverting under the current code
-- makes commenting raise instead of notifying. Revert the CODE first, confirm the deploy,
-- then run this.

BEGIN;

DROP FUNCTION IF EXISTS public.notify_task_watchers(UUID, TEXT, TEXT, TEXT, UUID);

DELETE FROM public.applied_migrations WHERE filename = '122_notify_task_watchers.sql';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notify_task_watchers'
  ) THEN
    RAISE EXCEPTION 'notify_task_watchers survived the revert. Aborting.';
  END IF;

  RAISE NOTICE '122 reverted: % notification(s) kept.', (SELECT count(*) FROM public.task_notifications);
END $$;

COMMIT;
