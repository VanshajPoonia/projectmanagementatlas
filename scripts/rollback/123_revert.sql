-- Rollback for 123_agile_core.sql.
--
-- ⚠️ THIS DESTROYS EVERY SPRINT AND EVERY RECORD OF WHAT WAS COMMITTED TO ONE. sprint_items
-- is the only place that knows which work was in a sprint before it started, and a burndown
-- cannot be reconstructed from task rows afterwards. If the intent is "roll back the code,
-- keep the history", snapshot first:
--
--   \copy (SELECT * FROM public.sprints)      TO 'sprints.csv'      CSV HEADER
--   \copy (SELECT * FROM public.sprint_items) TO 'sprint_items.csv' CSV HEADER
--
-- ⚠️ IT ALSO DROPS tasks.estimate_value AND columns.wip_limit, which are real user input on
-- existing tables. Snapshot those too if they have been used:
--
--   \copy (SELECT id, estimate_value FROM public.tasks WHERE estimate_value IS NOT NULL) TO 'estimates.csv' CSV HEADER
--   \copy (SELECT id, wip_limit FROM public.columns WHERE wip_limit IS NOT NULL) TO 'wip.csv' CSV HEADER
--
-- No task, board or column ROW is deleted - only those two columns are removed from them.
--
-- ── Order ───────────────────────────────────────────────────────────────────────────
-- Revert 125 and 124 FIRST if they are applied: 125's trigger reads columns.wip_limit and
-- board_agile_settings, and 124's tables reference sprints. Then revert the CODE (the /agile
-- route and the estimate field query these tables), confirm the deploy, then run this.

BEGIN;

DROP TRIGGER IF EXISTS enforce_sprint_item_integrity ON public.sprint_items;
DROP TRIGGER IF EXISTS enforce_sprint_state          ON public.sprints;
DROP TRIGGER IF EXISTS touch_sprints                 ON public.sprints;
DROP TRIGGER IF EXISTS touch_board_agile_settings    ON public.board_agile_settings;

DROP FUNCTION IF EXISTS private.enforce_sprint_item_integrity();
DROP FUNCTION IF EXISTS private.enforce_sprint_state();

DROP TABLE IF EXISTS public.sprint_items;
DROP TABLE IF EXISTS public.sprints;
DROP TABLE IF EXISTS public.board_agile_settings;

ALTER TABLE public.tasks   DROP COLUMN IF EXISTS estimate_value;
ALTER TABLE public.columns DROP COLUMN IF EXISTS wip_limit;

DELETE FROM public.app_modules WHERE module_key = 'agile';

DELETE FROM public.applied_migrations WHERE filename = '123_agile_core.sql';

COMMIT;
