-- Revert 137 (time tracking).
--
-- ⚠️ DESTROYS DATA: every logged hour goes with the table. Export first if the hours matter:
--   COPY (SELECT * FROM public.time_entries) TO STDOUT WITH CSV HEADER;

BEGIN;

DROP TABLE IF EXISTS public.time_entries;
DELETE FROM public.app_modules WHERE module_key = 'time_tracking';

COMMIT;
