-- Rollback for 120_notification_inbox.sql.
--
-- ⚠️ THIS DESTROYS every follow, every mute, and every snooze. They are small preferences
-- rather than content, but they are not reconstructible - "I muted that noisy board three
-- weeks ago" exists nowhere else - so snapshot them first if the intent is "roll back the
-- code, keep the preferences":
--
--   \copy (SELECT * FROM public.task_follows) TO 'task_follows.csv' CSV HEADER
--   \copy (SELECT * FROM public.board_mutes)  TO 'board_mutes.csv'  CSV HEADER
--   \copy (SELECT id, snoozed_until FROM public.task_notifications WHERE snoozed_until IS NOT NULL) TO 'snoozes.csv' CSV HEADER
--
-- NO NOTIFICATION IS DELETED and no read_at is touched. Dropping the three columns loses the
-- deep-link context on rows that had it, which degrades those notifications to task-level
-- links; it does not lose the notifications themselves.
--
-- ── Sequence this with a client change ──────────────────────────────────────────────
-- /inbox reads these columns and tables on every visit, and Inbox is in the nav for every
-- role. Reverting under the current code leaves every user a link to a page that errors, and
-- the toast query would fail too - which would break notifications everywhere, not just on the
-- inbox screen. Revert the CODE first (git revert, push - `main` auto-deploys), confirm the
-- deploy, then run this.
--
-- 121 does not depend on 120, and 120 does not depend on 121. Either can be reverted alone.

BEGIN;

DROP TABLE IF EXISTS public.task_follows;
DROP TABLE IF EXISTS public.board_mutes;

DROP INDEX IF EXISTS public.idx_task_notifications_inbox;

ALTER TABLE public.task_notifications
  DROP CONSTRAINT IF EXISTS task_notifications_entity_pair_check,
  DROP CONSTRAINT IF EXISTS task_notifications_entity_type_check;

ALTER TABLE public.task_notifications
  DROP COLUMN IF EXISTS snoozed_until,
  DROP COLUMN IF EXISTS entity_type,
  DROP COLUMN IF EXISTS entity_id;

DELETE FROM public.applied_migrations WHERE filename = '120_notification_inbox.sql';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('task_follows', 'board_mutes')
  ) THEN
    RAISE EXCEPTION 'A follow/mute table survived the revert. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_notifications'
      AND column_name IN ('snoozed_until', 'entity_type', 'entity_id')
  ) THEN
    RAISE EXCEPTION 'An inbox column survived the revert. Aborting.';
  END IF;

  -- The whole point: the mail is still there.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_notifications' AND column_name = 'read_at'
  ) THEN
    RAISE EXCEPTION 'task_notifications lost read_at. Aborting.';
  END IF;

  RAISE NOTICE '120 reverted: follows, mutes and inbox columns are gone; % notification(s) kept.',
    (SELECT count(*) FROM public.task_notifications);
END $$;

COMMIT;
