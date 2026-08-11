-- Rollback for 090_project_ids.sql.
--
-- ⚠️ DESTRUCTIVE. public.project_ids is a permanent ledger — dropping it discards every
-- claimed project number along with who took it, for which client, and when. Those numbers
-- are referenced outside this app (on jobs, files, invoices), so the data cannot be
-- reconstructed. Take a dump first, always, and never run this against production without
-- the owner explicitly asking for it.
--
-- The DROP TABLE is deliberately left commented out. Uncomment it only after deciding the
-- ledger itself should go; the default revert removes the write path and the nav entry while
-- keeping the record intact, which is what "back this feature out" almost always means.
--
-- This is not a numbered migration and the runner will not pick it up. Apply it deliberately,
-- then delete 090's row from public.applied_migrations so the ledger matches reality:
--     DELETE FROM public.applied_migrations WHERE filename = '090_project_ids.sql';

BEGIN;

DROP FUNCTION IF EXISTS public.claim_project_id(TEXT, UUID);

DELETE FROM public.app_modules WHERE module_key = 'project_ids';

-- DROP TABLE IF EXISTS public.project_ids;   -- see the warning above

COMMIT;
