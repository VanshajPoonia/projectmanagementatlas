-- board_members gets a role (PROMPT 3 slice 1, single-org reinterpretation). A board can now
-- have restricted members alongside full members, without a second membership system.
--
-- 'member' - today's behavior, unchanged (full access per existing task-visibility rules).
-- 'guest'  - can view the board/tasks they're an explicit board_members row for; cannot
--            create/edit/delete tasks on it.
-- 'client' - same restriction as guest for now. Kept as a distinct value (not reused 'guest')
--            because the client portal (FEATURES.md Phase 7) will restrict further later
--            (e.g. hide internal comments) — that hiding isn't built yet, task_comments has no
--            visibility concept at all today, so guest and client behave identically until then.
--
-- Existing rows get the DEFAULT 'member' — no behavior change for anyone today. Absence of a
-- board_members row (the common case — it only exists for the private-board exception, see
-- 049/061) still means unrestricted default access; this column only ever narrows.

BEGIN;

ALTER TABLE public.board_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_members_role_check') THEN
    ALTER TABLE public.board_members
      ADD CONSTRAINT board_members_role_check CHECK (role IN ('member', 'guest', 'client'));
  END IF;
END $$;

-- No UPDATE policy existed on board_members before now (049/061 only defined SELECT/INSERT/
-- DELETE). Board creators can update a membership's role — same "creator owns membership, no
-- admin bypass" model 061 established for insert/delete, and for the same reason (061 removed
-- the admin bypass because it let an admin re-add themselves to a private board).
DROP POLICY IF EXISTS "Manage board memberships update" ON public.board_members;
CREATE POLICY "Manage board memberships update" ON public.board_members FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_members.board_id AND b.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_members.board_id AND b.created_by = auth.uid())
  );

-- Restricted members (guest/client) can view but not manage. ANDed on top of can_manage_task,
-- same pattern as private.task_hidden_by_board_privacy (061): this can only ever REMOVE access,
-- including from admins — same precedent 061 set (private boards hide from admins too).
CREATE OR REPLACE FUNCTION private.task_restricted_by_board_role(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks         t
    JOIN public.columns       c  ON c.id = t.column_id
    JOIN public.board_members bm ON bm.board_id = c.board_id
    WHERE t.id = p_task_id
      AND bm.user_id = auth.uid()
      AND bm.role IN ('guest', 'client')
  );
$$;

REVOKE ALL ON FUNCTION private.task_restricted_by_board_role(uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.task_restricted_by_board_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_manage_task(
  p_task_id UUID,
  p_created_by UUID,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT private.task_hidden_by_board_privacy(p_task_id)
    AND NOT private.task_restricted_by_board_role(p_task_id)
    AND (
      private.is_admin_user()
      OR p_created_by = auth.uid()
      OR p_assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.task_assignees ta
        WHERE ta.task_id = p_task_id
          AND ta.user_id = auth.uid()
      )
    );
$$;

-- Hard-delete path: same AND-on-top treatment board privacy got in 061.
DROP POLICY IF EXISTS "Creators and admins can delete tasks" ON public.tasks;
CREATE POLICY "Creators and admins can delete tasks"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (
    private.can_delete_task(created_by)
    AND NOT private.task_hidden_by_board_privacy(id)
    AND NOT private.task_restricted_by_board_role(id)
  );

COMMIT;
