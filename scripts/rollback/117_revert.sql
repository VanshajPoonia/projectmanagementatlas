-- Revert 117: remove per-user task reminders.
--
-- DESTROYS: every reminder anyone has set, including the record of which were already
-- delivered. It destroys NO task and NO notification - reminders that already fired left a row
-- in task_notifications, and those stay.
--
-- ⚠️ If 117 is ever re-applied after this, previously-delivered reminders are gone rather than
-- marked delivered, so nothing can re-fire - there is no double-delivery hazard here, unlike
-- 116's ledger. Losing them simply means people silently stop being reminded.

BEGIN;

DROP FUNCTION IF EXISTS public.deliver_my_due_reminders();
DROP FUNCTION IF EXISTS public.deliver_due_reminders(TIMESTAMPTZ);
DROP TABLE IF EXISTS public.task_reminders;

DO $$
DECLARE
  v_notifications BIGINT;
BEGIN
  SELECT count(*) INTO v_notifications FROM public.task_notifications;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'notify_email_due_soon'
  ) THEN
    RAISE EXCEPTION '045''s preference column was removed - this revert must not touch profiles. Aborting.';
  END IF;

  RAISE NOTICE '117 reverted: reminders dropped, % notification(s) intact.', v_notifications;

  DELETE FROM public.applied_migrations WHERE filename = '117_task_reminders.sql';
END $$;

COMMIT;
