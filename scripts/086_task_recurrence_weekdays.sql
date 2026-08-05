-- Adds a 'custom' recurrence pattern option for tasks, alongside the existing
-- daily/weekly/monthly (025). recurrence_pattern is a free-text VARCHAR with no
-- CHECK constraint, so 'custom' needs no schema change there — only a place to
-- store which weekdays it applies to. Mirrors the marketing calendar's custom
-- weekday picker (084) and the booking restriction dialog's weekday row: an
-- array of 0=Sun..6=Sat. Nullable/unused for the existing daily/weekly/monthly
-- patterns, so nothing changes for existing recurring tasks.

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS recurrence_weekdays INTEGER[] NULL;

COMMENT ON COLUMN public.tasks.recurrence_weekdays IS
  'Only meaningful when recurrence_pattern = ''custom''. Array of weekday numbers '
  '(0=Sunday..6=Saturday) this task recurs on. Descriptive only, like the other '
  'recurrence_* columns (025) — nothing currently spawns task instances from it.';

COMMIT;
