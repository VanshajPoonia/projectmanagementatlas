-- Task activity log: who touched a task, when, and what they did (e.g. "changed status
-- from To Do to Done"). Read-only audit trail surfaced via an "Activity" tab/button on
-- tasks. Rows are written by the app on every tracked mutation; there is no UPDATE/DELETE
-- policy since the log is meant to be immutable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_activity_task_id_idx ON public.task_activity(task_id);

ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.task_activity TO authenticated;

DROP POLICY IF EXISTS "Collaborators can view task activity" ON public.task_activity;
CREATE POLICY "Collaborators can view task activity"
  ON public.task_activity FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can log task activity" ON public.task_activity;
CREATE POLICY "Collaborators can log task activity"
  ON public.task_activity FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

COMMIT;
