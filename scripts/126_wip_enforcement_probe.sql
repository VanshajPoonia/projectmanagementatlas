-- 126: let the interface find out whether the WIP limit is actually enforced.
--
-- WHY THIS IS A MIGRATION OF ITS OWN
-- 125 is deliberately NOT --allow-prod eligible - it puts a trigger on `tasks` - so agile mode
-- will legitimately run on databases where the WIP limit warns and databases where it refuses.
-- The screen has to be able to tell which, or it ends up promising a refusal the database will
-- not make. A warning that turns out to be untrue is how people learn to ignore the next one,
-- and a control labelled working that does nothing is this repo's most-repeated defect.
--
-- It cannot live in 125 (a database without 125 could not call it) and it must not be edited
-- into 123 (already applied; rewriting an applied file makes the ledger's checksum disagree
-- with the file for no benefit). So: its own file, applied wherever 123 is.
--
-- It READS pg_trigger rather than returning a constant, so it stays correct whichever way 125
-- is later applied or reverted. There is nothing to keep in sync.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Purely additive: one function, no table, row, policy, grant or trigger touched. Eligible.
-- Rollback: scripts/rollback/126_revert.sql (drops the function; destroys nothing).

BEGIN;

/**
 * True when migration 125's trigger is installed, i.e. when a board set to `enforcement` will
 * really have a move into a full column refused.
 *
 * STABLE and reads only the catalog, so it discloses nothing about anyone's work. Callable by
 * any signed-in user, because every one of them sees WIP badges.
 */
CREATE OR REPLACE FUNCTION public.wip_enforcement_installed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'tasks'
       AND t.tgname = 'enforce_wip_limit'
       AND NOT t.tgisinternal
  );
$$;

-- ⚠️ 117's lesson: `postgres` carries a DEFAULT ACL granting EXECUTE on every new function in
-- public to `authenticated`, which REVOKE ... FROM PUBLIC leaves untouched. State the grants
-- explicitly and assert them.
REVOKE ALL ON FUNCTION public.wip_enforcement_installed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wip_enforcement_installed() TO authenticated;

DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.wip_enforcement_installed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot call wip_enforcement_installed - every WIP badge would claim enforcement is off. Aborting.';
  END IF;
  IF has_function_privilege('anon', 'public.wip_enforcement_installed()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can call wip_enforcement_installed. Aborting.';
  END IF;

  -- It must answer honestly about THIS database, whichever way 125 stands here.
  IF public.wip_enforcement_installed() <> EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'tasks' AND t.tgname = 'enforce_wip_limit' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'The probe disagrees with the catalog. Aborting.';
  END IF;

  RAISE NOTICE '126 verified: WIP enforcement probe installed; it currently reports %.',
    public.wip_enforcement_installed();
END $$;

COMMIT;
