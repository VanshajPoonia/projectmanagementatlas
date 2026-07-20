-- Align the managed task statuses with the default board columns
-- (To Do, In Progress, Completed, Cancelled).
--
-- The built-in "Done" status keeps its key ('done') so existing tasks keep
-- working, but is relabelled "Completed" so it matches the "Completed" column
-- title (the status-picker relocates a card into the column whose title equals
-- the status label). A new "Cancelled" status is added for the fourth column.

BEGIN;

-- Relabel the built-in done status so it reads "Completed" everywhere.
UPDATE public.task_statuses
  SET label = 'Completed'
  WHERE key = 'done';

-- Rename any existing board columns still titled "Done" to match.
UPDATE public.columns
  SET title = 'Completed'
  WHERE lower(trim(title)) = 'done';

-- Add the Cancelled status (idempotent).
INSERT INTO public.task_statuses (key, label, color, position)
  VALUES ('cancelled', 'Cancelled', '#dc2626', 3)
  ON CONFLICT (key) DO NOTHING;

-- Some environments backfilled a legacy 'cancel' status from existing task data.
-- Fold it into the canonical 'cancelled' status so the picker isn't duplicated.
UPDATE public.tasks SET status = 'cancelled' WHERE status = 'cancel';
DELETE FROM public.task_statuses WHERE key = 'cancel';

COMMIT;
