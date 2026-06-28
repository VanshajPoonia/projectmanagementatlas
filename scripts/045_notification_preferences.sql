-- 045_notification_preferences.sql
-- Lets each user choose which categories of email notification they receive
-- (Account settings dialog). Defaults preserve the current always-on behavior
-- for every existing user.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/045_notification_preferences.sql

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_email_assignment BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email_update BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email_comment BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email_due_soon BOOLEAN NOT NULL DEFAULT true;

COMMIT;
