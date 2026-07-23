-- Phase 1B — Status source-of-truth FK (platform rebuild).
--
-- Today a task's status is inferred by fuzzy-matching its board COLUMN TITLE
-- (lib/task-status.ts): "In Progress"/"Ongoing"/"Going" -> in_progress, "Done"/"Completed"
-- -> done, everything else -> to_do. A company that names a column "WIP" would have every
-- task on it silently classified to_do — wrong counts in My Tasks, overdue math, reports and
-- the AI assistant, with no error. This is the highest-risk existing code for multi-tenancy.
--
-- Make the link explicit: columns.status_key -> task_statuses(key). The normalizer will read
-- this FK first and keep title matching only as a legacy fallback for columns without a key.
--
-- Backfill mirrors getEffectiveStatusKey() in lib/task-status.ts: an exact (case-insensitive)
-- title==label match wins, else the normalized to_do/in_progress/done bucket from title
-- substrings. Nullable + ON DELETE SET NULL so archiving/removing a status can never break a
-- board — NULL status_key just degrades to the legacy title fallback.

BEGIN;

ALTER TABLE public.columns
  ADD COLUMN IF NOT EXISTS status_key TEXT;

-- FK to the admin-managed status list (task_statuses.key is UNIQUE). SET NULL on delete so a
-- removed status degrades to the legacy title fallback instead of blocking the delete.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'columns_status_key_fkey') THEN
    ALTER TABLE public.columns
      ADD CONSTRAINT columns_status_key_fkey
      FOREIGN KEY (status_key) REFERENCES public.task_statuses(key)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- One-time backfill of existing columns (mirrors lib/task-status.ts getEffectiveStatusKey).
UPDATE public.columns c
SET status_key = COALESCE(
  (SELECT s.key FROM public.task_statuses s WHERE lower(s.label) = lower(c.title) LIMIT 1),
  CASE
    WHEN lower(c.title) ~ '(done|complete|cancel)'  THEN 'done'
    WHEN lower(c.title) ~ '(progress|going|ongoing)' THEN 'in_progress'
    ELSE 'to_do'
  END
)
WHERE c.status_key IS NULL;

COMMIT;
