-- Hard-enforce Vs PM Portal #15: "the due date cannot be edited by anyone other than
-- the person who created it." UI already hides the control from non-creators; this makes
-- it a database guarantee too (same trigger pattern as the soft-delete guard in 035).
--
-- Only fires for real user sessions (auth.uid() not null), so cron/service-role jobs that
-- roll recurring due dates forward are unaffected.

BEGIN;

CREATE OR REPLACE FUNCTION private.enforce_task_due_date_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND NEW.due_date IS DISTINCT FROM OLD.due_date
    AND NOT (
      private.is_admin_user()
      OR OLD.created_by = auth.uid()
    )
  THEN
    RAISE EXCEPTION 'Only the task creator or an admin can change the due date'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_task_due_date_permission ON public.tasks;
CREATE TRIGGER enforce_task_due_date_permission
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_task_due_date_permission();

COMMIT;
