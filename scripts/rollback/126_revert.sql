-- Rollback for 126_wip_enforcement_probe.sql. Destroys nothing - one function, no rows.
--
-- ⚠️ Sequence it with the code. The agile screen calls this function to decide what its WIP
-- badges promise; without it the call errors and the screen falls back to "warning only",
-- which is the SAFE direction (it never claims a refusal that will not happen) but is wrong
-- wherever 125 is applied. Revert the code, or revert 125 too.

BEGIN;

DROP FUNCTION IF EXISTS public.wip_enforcement_installed();

DELETE FROM public.applied_migrations WHERE filename = '126_wip_enforcement_probe.sql';

COMMIT;
