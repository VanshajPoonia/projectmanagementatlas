-- Subtasks: break a task into smaller pieces that can be checked off independently.
--
-- Subtasks are real rows in `tasks`, not a separate lightweight table. That means they
-- inherit comments, attachments, assignees, tags, activity logging, soft delete, and —
-- most importantly — every existing RLS policy, with no new policies to write or keep
-- in sync. The cost is that every query listing "all tasks" now has to say it wants
-- top-level ones (`parent_task_id IS NULL`); those call sites are updated alongside
-- this migration.
--
-- Nesting is capped at one level (see the trigger below). The UI renders exactly one
-- level, so a sub-subtask would be invisible in the app while still counting toward its
-- parent's progress — a silent wrong number, which is worse than a rejected insert.

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE;

-- Every subtask read is "children of this parent", and the top-level filter added to
-- the list queries is a NULL check, so index both shapes.
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id
  ON public.tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_top_level
  ON public.tasks(column_id) WHERE parent_task_id IS NULL;

-- A task cannot be its own parent.
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_parent_not_self;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_parent_not_self CHECK (parent_task_id IS NULL OR parent_task_id <> id);

-- Enforce the single-level rule: the row named as a parent must itself be top-level.
-- A CHECK constraint cannot look at another row, so this needs a trigger.
CREATE OR REPLACE FUNCTION private.enforce_single_level_subtasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Checked first so self-parenting reports its own cause; the CHECK constraint
  -- below is a backstop, but constraints are evaluated after triggers, so without
  -- this the error would surface as the less obvious "has subtasks" message.
  IF NEW.parent_task_id IS NOT NULL AND NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'A task cannot be its own parent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_task_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = NEW.parent_task_id
        AND t.parent_task_id IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Subtasks cannot be nested more than one level deep'
      USING ERRCODE = '23514';
  END IF;

  -- A task that already has children cannot itself become someone else's subtask,
  -- which would create a second level from the other direction.
  IF NEW.parent_task_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.parent_task_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'A task with subtasks cannot become a subtask itself'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_level_subtasks ON public.tasks;
CREATE TRIGGER enforce_single_level_subtasks
  BEFORE INSERT OR UPDATE OF parent_task_id ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_single_level_subtasks();

-- Deleting a parent has to be allowed to delete subtasks somebody else created.
-- The existing permission trigger (035) only asks whether the current user can delete
-- the row's own creator's task, so a cascade over a colleague's subtask would raise and
-- abort the parent's delete entirely. Widen it: authority over the parent carries down.
CREATE OR REPLACE FUNCTION private.enforce_task_soft_delete_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_created_by UUID;
BEGIN
  IF auth.uid() IS NOT NULL
    AND (
      NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
    )
    AND NOT private.can_delete_task(OLD.created_by)
  THEN
    -- Fall back to the parent's permissions before refusing, so deleting a task also
    -- clears subtasks contributed by other people.
    IF OLD.parent_task_id IS NOT NULL THEN
      SELECT created_by INTO v_parent_created_by
      FROM public.tasks WHERE id = OLD.parent_task_id;

      IF v_parent_created_by IS NOT NULL AND private.can_delete_task(v_parent_created_by) THEN
        RETURN NEW;
      END IF;
    END IF;

    RAISE EXCEPTION 'Only task creators and admins can delete or restore tasks'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Soft delete is the app's normal delete path (tasks.deleted_at), and it does not
-- cascade the way the FK does. Without this, deleting a parent leaves its subtasks
-- alive but unreachable — they'd vanish from the board (filtered as non-top-level)
-- while still counting in any query that doesn't exclude them.
CREATE OR REPLACE FUNCTION private.cascade_task_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at OR NEW.parent_task_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    -- Deleting: take down every subtask that is currently live. Stamping them with
    -- the parent's exact timestamp is what makes the restore below precise.
    UPDATE public.tasks
    SET deleted_at = NEW.deleted_at,
        deleted_by = NEW.deleted_by
    WHERE parent_task_id = NEW.id
      AND deleted_at IS NULL;
  ELSE
    -- Restoring (the Undo toast): bring back only the subtasks this parent's own
    -- delete took down, identified by that shared timestamp. Matching on it instead
    -- of restoring every child means a subtask deleted on its own beforehand stays
    -- deleted, rather than silently reappearing.
    UPDATE public.tasks
    SET deleted_at = NULL,
        deleted_by = NULL
    WHERE parent_task_id = NEW.id
      AND deleted_at IS NOT DISTINCT FROM OLD.deleted_at;
  END IF;

  RETURN NEW;
END;
$$;

-- Runs AFTER so it sees the committed parent state, and only for top-level rows, so
-- the recursive UPDATE terminates immediately (children have a non-null parent).
DROP TRIGGER IF EXISTS cascade_task_soft_delete ON public.tasks;
CREATE TRIGGER cascade_task_soft_delete
  AFTER UPDATE OF deleted_at ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.cascade_task_soft_delete();

GRANT EXECUTE ON FUNCTION private.enforce_single_level_subtasks() TO authenticated;
GRANT EXECUTE ON FUNCTION private.cascade_task_soft_delete() TO authenticated;

COMMIT;
