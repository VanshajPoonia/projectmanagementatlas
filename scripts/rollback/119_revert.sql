-- Rollback for 119_saved_views.sql.
--
-- ⚠️ THIS DESTROYS EVERY SAVED VIEW, personal and shared alike. They are real user data -
-- "the work I look at every Monday" is not reconstructible from anything else - so if the
-- intent is "roll back the code, keep the views", snapshot the table first:
--
--   \copy (SELECT * FROM public.saved_views) TO 'saved_views.csv' CSV HEADER
--
-- No board, task or membership row is touched. saved_views references boards and profiles, not
-- the other way round, so dropping it cannot cascade into anything.
--
-- ── Sequence this with a client change ──────────────────────────────────────────────
-- `/views` reads and writes this table on every visit, and it is in the nav for every role.
-- Reverting under the current code leaves every user a link to a page that errors. Revert the
-- CODE first (git revert, push - `main` auto-deploys), confirm the deploy, then run this.
--
-- 118 does NOT depend on 119, and 119 does not depend on 118. Either can be reverted alone.

BEGIN;

DROP TRIGGER IF EXISTS validate_saved_view_config ON public.saved_views;
DROP FUNCTION IF EXISTS private.validate_saved_view_config();
DROP TABLE IF EXISTS public.saved_views;

DELETE FROM public.applied_migrations WHERE filename = '119_saved_views.sql';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'saved_views'
  ) THEN
    RAISE EXCEPTION 'saved_views survived the revert. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'validate_saved_view_config'
  ) THEN
    RAISE EXCEPTION 'The config validator survived the revert. Aborting.';
  END IF;

  RAISE NOTICE '119 reverted: saved_views is gone.';
END $$;

COMMIT;
