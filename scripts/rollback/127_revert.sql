-- Rollback for 127_capacity_enforcement.sql.
--
-- Destroys NO data: one trigger and one function, no row touched. Every board falls back to
-- warning-only capacity behaviour, which is what 123 ships by default.
--
-- ⚠️ Sequence it with the code. `capacity_mode = 'enforcement'` stays selectable in the board's
-- agile settings after this runs and will silently stop being enforced - a control labelled
-- working that does nothing, which is the exact defect 127 exists to remove. Either revert the
-- code that offers the mode, or put every board back to warning:
--
--   UPDATE public.board_agile_settings SET capacity_mode = 'warning' WHERE capacity_mode = 'enforcement';
--
-- Revert this BEFORE 123 (its trigger lives on a table 123 creates).

BEGIN;

DROP TRIGGER IF EXISTS enforce_sprint_capacity ON public.sprint_items;
DROP FUNCTION IF EXISTS private.enforce_sprint_capacity();

DELETE FROM public.applied_migrations WHERE filename = '127_capacity_enforcement.sql';

COMMIT;
