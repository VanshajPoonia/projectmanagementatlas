-- Rollback for 124_sprint_metrics.sql.
--
-- ⚠️ THIS DESTROYS THE RECORDED SPRINT HISTORY - every frozen snapshot and every burndown
-- point. That is the one thing in the agile module that cannot be reconstructed: the whole
-- reason 124 exists is that recomputing a finished sprint from today's rows gives a different
-- answer. If the intent is "roll back the code, keep the history", dump first:
--
--   \copy (SELECT * FROM public.sprint_metrics)          TO 'sprint_metrics.csv' CSV HEADER
--   \copy (SELECT * FROM public.sprint_burndown_samples) TO 'burndown.csv'       CSV HEADER
--
-- No sprint, task or board row is touched - both tables reference sprints, not the reverse.
--
-- Revert this BEFORE 123 (its tables reference public.sprints). Revert the CODE first if the
-- metrics tab is deployed, since it queries both tables on every visit.

BEGIN;

DROP TRIGGER IF EXISTS capture_sprint_metrics ON public.sprints;
DROP FUNCTION IF EXISTS private.capture_sprint_metrics();
DROP FUNCTION IF EXISTS public.sample_all_active_sprints();
DROP FUNCTION IF EXISTS public.sample_sprint_burndown(UUID);

DROP TABLE IF EXISTS public.sprint_burndown_samples;
DROP TABLE IF EXISTS public.sprint_metrics;

DELETE FROM public.applied_migrations WHERE filename = '124_sprint_metrics.sql';

COMMIT;
