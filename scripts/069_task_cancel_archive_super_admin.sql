-- Cancel-status auto-archive + super-admin-only restore (V's PM Portal, "New 'Cancel' status
-- and how it will behave" / "Super Admin Menu Ite,"): "rather than manually deleting a task,
-- put it in the 'cancel' status and the system will automatically archive it... if a board or
-- task needs to be restored only someone with super admin privileges can see that and also
-- restore it."
--
-- Part A — tasks: a task moved into a column linked to the 'cancelled' status (via the new
-- "Link Status" column menu, board-view.tsx) is auto-stamped archived_at/archived_by. Moving it
-- back OUT of that status (by drag-and-drop or the status dropdown) is blocked unless the actor
-- is a super_admin — cancelling stays open to anyone who can already manage the task (existing
-- tasks UPDATE policy already checks that before this trigger runs); only the "undo" direction
-- is gated, matching the ask.
--
-- Part B — boards: 036_board_archive.sql's own header said archived boards should be visible
-- "ONLY [to] the super admin", but 047_super_admin_role.sql later widened the shared
-- is_admin_user() chokepoint (admin OR super_admin) and re-pointed the boards UPDATE/SELECT
-- policies at it — silently regressing that original intent for any plain `admin`. This
-- reinstates it explicitly with its own function, without touching plain-admin's ability to
-- edit/archive non-archived boards (only the SELECT of archived rows, and the restore
-- transition specifically, move to super_admin-only).
--
-- Part C — task_statuses: "Only super admins have permission to create statuses" (today any
-- admin can). Tightened the same way.

BEGIN;

CREATE OR REPLACE FUNCTION private.is_super_admin_user()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  );
$function$;

GRANT EXECUTE ON FUNCTION private.is_super_admin_user() TO authenticated;

-- Part A: tasks.archived_at/archived_by, separate from the existing deleted_at/deleted_by
-- soft-delete (035) — a cancelled task stays visible/reportable, it isn't hidden like a delete.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON public.tasks(archived_at);

CREATE OR REPLACE FUNCTION private.enforce_task_cancel_archive()
 RETURNS TRIGGER
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_status_key TEXT;
  new_status_key TEXT;
BEGIN
  IF NEW.column_id IS DISTINCT FROM OLD.column_id THEN
    SELECT status_key INTO old_status_key FROM public.columns WHERE id = OLD.column_id;
    SELECT status_key INTO new_status_key FROM public.columns WHERE id = NEW.column_id;

    IF old_status_key = 'cancelled' AND new_status_key IS DISTINCT FROM 'cancelled' THEN
      IF NOT private.is_super_admin_user() THEN
        RAISE EXCEPTION 'Only a super admin can restore a cancelled task'
          USING ERRCODE = '42501';
      END IF;
      NEW.archived_at := NULL;
      NEW.archived_by := NULL;
    ELSIF new_status_key = 'cancelled' AND old_status_key IS DISTINCT FROM 'cancelled' THEN
      NEW.archived_at := now();
      NEW.archived_by := auth.uid();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.enforce_task_cancel_archive() TO authenticated;

DROP TRIGGER IF EXISTS enforce_task_cancel_archive ON public.tasks;
CREATE TRIGGER enforce_task_cancel_archive
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_task_cancel_archive();

-- Part B: boards — restore (archived_at: NOT NULL -> NULL) requires super_admin. Archiving
-- itself (NULL -> NOT NULL) is unchanged, still open to any admin via the existing UPDATE policy.
CREATE OR REPLACE FUNCTION private.enforce_board_restore_super_admin()
 RETURNS TRIGGER
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL AND NOT private.is_super_admin_user() THEN
    RAISE EXCEPTION 'Only a super admin can restore an archived board'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.enforce_board_restore_super_admin() TO authenticated;

DROP TRIGGER IF EXISTS enforce_board_restore_super_admin ON public.boards;
CREATE TRIGGER enforce_board_restore_super_admin
  BEFORE UPDATE ON public.boards
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_board_restore_super_admin();

-- Visibility of archived boards (reinstating 036's "only the super admin" intent) is handled
-- SOLELY by migration 070, which folds archived-visibility INTO the single existing
-- "Users can view boards" policy (061). An earlier version of THIS migration created a separate
-- "View active boards, super admins see archived too" SELECT policy right here — but Postgres ORs
-- multiple permissive SELECT policies together, and that privacy-blind second policy silently
-- defeated 061's privacy check for every non-archived board (the exact overlap bug 051 already
-- retired once). Removed from 069 so no overlapping-policy window ever exists, on prod or dev;
-- 070 does the tightening correctly in one policy. See the private-board-rls self-correction notes.

-- Part C: only super admins manage statuses (create/edit/archive) — using them on a task
-- (any authenticated user, via the pre-existing "Everyone can view statuses" policy) is untouched.
DROP POLICY IF EXISTS "Admins can manage statuses" ON public.task_statuses;
CREATE POLICY "Super admins can manage statuses"
  ON public.task_statuses FOR ALL
  TO authenticated
  USING (private.is_super_admin_user())
  WITH CHECK (private.is_super_admin_user());

COMMIT;
