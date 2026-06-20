-- Clear all workspace/project data before re-importing tasks from the sheet.
-- This intentionally preserves users, profiles, and allowed_emails.
-- Run this only against the intended Supabase project.

BEGIN;

DO $$
DECLARE
  tables_to_clear TEXT[];
BEGIN
  SELECT array_agg(table_name)
  INTO tables_to_clear
  FROM unnest(ARRAY[
    'task_comments',
    'task_attachments',
    'task_assignees',
    'task_tags',
    'tags',
    'tasks',
    'columns',
    'boards',
    'marketing_calendar_checks',
    'marketing_calendar_items',
    'chat_messages'
  ]) AS t(table_name)
  WHERE to_regclass(format('public.%I', table_name)) IS NOT NULL;

  IF tables_to_clear IS NOT NULL THEN
    EXECUTE format(
      'TRUNCATE TABLE %s RESTART IDENTITY CASCADE',
      array_to_string(
        ARRAY(SELECT format('public.%I', table_name) FROM unnest(tables_to_clear) AS t(table_name)),
        ', '
      )
    );
  END IF;
END $$;

COMMIT;
