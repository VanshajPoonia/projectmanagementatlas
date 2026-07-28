-- Advisor follow-ups for the lifecycle/activity migration. These are deliberately
-- separate from 074 because 074 was already exercised in the dev database.

BEGIN;

-- The helper uses only pg_catalog built-ins; pinning its search path removes the
-- mutable-search-path warning without changing behavior.
ALTER FUNCTION private.normalized_task_status_key(TEXT)
  SET search_path TO pg_catalog;

-- Cover lifecycle-related foreign keys used by archive/audit/share queries.
CREATE INDEX IF NOT EXISTS idx_columns_status_key
  ON public.columns(status_key)
  WHERE status_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_share_links_created_by
  ON public.share_links(created_by);

CREATE INDEX IF NOT EXISTS idx_task_activity_actor_id
  ON public.task_activity(actor_id)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_archived_by
  ON public.tasks(archived_by)
  WHERE archived_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_boards_archived_by
  ON public.boards(archived_by)
  WHERE archived_by IS NOT NULL;

-- Evaluate auth.uid() once per statement rather than once per candidate row.
DROP POLICY IF EXISTS "Collaborators can log task activity" ON public.task_activity;
CREATE POLICY "Collaborators can log task activity"
  ON public.task_activity FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_activity.task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

COMMIT;
