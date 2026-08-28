-- Rollback for 125_wip_enforcement.sql.
--
-- Destroys NO data: it drops one trigger and one function and touches no row. Every board
-- returns to warning-only behaviour, which is what 123 ships by default.
--
-- ⚠️ Sequence it with the code. board_agile_settings.wip_mode = 'enforcement' will still be
-- selectable in the board's agile settings after this runs, and it will silently stop being
-- enforced - a control labelled working that does nothing, which is this repo's most-repeated
-- defect. Either revert the code that offers the mode, or set every board back to warning:
--
--   UPDATE public.board_agile_settings SET wip_mode = 'warning' WHERE wip_mode = 'enforcement';

BEGIN;

DROP TRIGGER IF EXISTS enforce_wip_limit ON public.tasks;
DROP FUNCTION IF EXISTS private.enforce_wip_limit();

DELETE FROM public.applied_migrations WHERE filename = '125_wip_enforcement.sql';

COMMIT;
