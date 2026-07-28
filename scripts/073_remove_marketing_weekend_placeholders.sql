-- Remove spreadsheet layout filler that was imported as hundreds of locked
-- marketing events. Keep real weekend posts (for example "Happy 4th") and any
-- user-created event; only exact imported Sat/Sun "wk" rows are deleted.

BEGIN;

DELETE FROM public.marketing_calendar_items
WHERE source_sheet IS NOT NULL
  AND upper(day_label) IN ('SAT', 'SUN')
  AND lower(btrim(content)) = 'wk';

COMMIT;
