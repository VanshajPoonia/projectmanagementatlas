-- Add an explicit "missed" state (with an optional reason) to marketing calendar
-- completion, alongside the existing "posted" check.
--
-- Today a row in marketing_calendar_checks means "this item was posted". There is
-- no way to record that a scheduled item was NOT done — an unposted past item looks
-- identical to a future not-yet-due one. This adds:
--
--   status : 'posted' | 'missed'   (existing rows are all 'posted')
--   note   : optional free-text reason, only meaningful for 'missed'
--
-- The UI additionally treats any PAST item with no row at all as "missed"
-- automatically (no storage needed); a stored 'missed' row is only created when the
-- user wants to attach a reason to it or explicitly acknowledge a miss. Marking an
-- item posted overwrites any missed row via the existing (item_id, user_id) upsert.
--
-- Requires 033 (marketing_calendar_checks) and 047 (is_admin_user re-point).

BEGIN;

ALTER TABLE public.marketing_calendar_checks
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS note   TEXT;

ALTER TABLE public.marketing_calendar_checks
  DROP CONSTRAINT IF EXISTS marketing_calendar_checks_status_check;
ALTER TABLE public.marketing_calendar_checks
  ADD CONSTRAINT marketing_calendar_checks_status_check
  CHECK (status IN ('posted', 'missed'));

-- Partial index for the "how many did we miss" style lookups.
CREATE INDEX IF NOT EXISTS idx_marketing_calendar_checks_missed
  ON public.marketing_calendar_checks(item_id)
  WHERE status = 'missed';

COMMIT;
