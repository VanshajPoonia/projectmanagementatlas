-- Closes two gaps in the tasks INSERT policy ("Collaborators can create tasks"), found while
-- verifying migration 065 with scripts/check-board-roles.mjs:
--
-- 1. NEW (this slice): board_members.role IN ('guest','client') restricted UPDATE/DELETE (065)
--    but never INSERT — a guest/client could still create new tasks on a board they can only
--    view. can_manage_task/task_hidden_by_board_privacy take a task id, which doesn't exist yet
--    at INSERT time, so this needs column-id-keyed equivalents.
-- 2. PRE-EXISTING (061, unrelated to single-org/roles): board privacy (is_private + board_members
--    membership) was applied to task SELECT/UPDATE/DELETE but never to INSERT — a private board's
--    non-member could still create a task in its columns if they had a column id. 061's own intent
--    ("privacy applies to everyone") clearly meant to cover this; fixing it here since it's the
--    same policy already being edited for gap 1.

BEGIN;

CREATE OR REPLACE FUNCTION private.column_hidden_by_board_privacy(p_column_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.columns c
    JOIN public.boards  b ON b.id = c.board_id
    WHERE c.id = p_column_id
      AND b.is_private
      AND (b.created_by IS DISTINCT FROM auth.uid())
      AND NOT public.is_board_member(b.id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION private.column_hidden_by_board_privacy(uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.column_hidden_by_board_privacy(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.column_restricted_by_board_role(p_column_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.columns       c
    JOIN public.board_members bm ON bm.board_id = c.board_id
    WHERE c.id = p_column_id
      AND bm.user_id = auth.uid()
      AND bm.role IN ('guest', 'client')
  );
$$;

REVOKE ALL ON FUNCTION private.column_restricted_by_board_role(uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.column_restricted_by_board_role(uuid) TO authenticated;

DROP POLICY IF EXISTS "Collaborators can create tasks" ON public.tasks;
CREATE POLICY "Collaborators can create tasks"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND NOT private.column_hidden_by_board_privacy(column_id)
    AND NOT private.column_restricted_by_board_role(column_id)
  );

COMMIT;
