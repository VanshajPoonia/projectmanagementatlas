-- Remove admin / super_admin blanket access to PRIVATE boards.
--
-- Before this migration, a private board only *looked* private: admins and
-- super_admins could still see and manage it and everything in it, through three
-- independent mechanisms:
--
--   1. boards SELECT policy (051) had an is_admin_user() bypass — admins saw every
--      board regardless of is_private.
--   2. can_view_task / can_manage_task (035, 047) short-circuit on is_admin_user()
--      (and can_view_task also on visibility='board'), so a private board's TASKS
--      were visible/manageable to any admin — and board-visibility tasks to EVERY
--      user — even though the board was flagged private. Hiding the board container
--      alone leaks its contents through the dashboards, calendars and the AI tools,
--      all of which read tasks directly.
--   3. board_members INSERT (049) was open to any admin, so removing an admin's view
--      would be pointless — they could just insert themselves as a member.
--
-- After this migration a PRIVATE board, and every task/comment/attachment/link/tag
-- inside it, is visible and manageable ONLY to the board's creator and to users
-- explicitly listed in board_members. Role alone (admin or super_admin) grants
-- nothing. Non-private boards are completely unaffected: admins keep full
-- create/update/delete/archive powers and still see archived boards.
--
-- Trade-off (see KNOWN-ISSUES.md): there is deliberately no break-glass. If the
-- creator of a private board is deprovisioned, the board is only reachable by its
-- remaining members or via direct DB access.
--
-- Requires 035 (task RLS helpers), 047 (super_admin), 049 (is_private, board_members),
-- 051 (public.is_board_member, consolidated boards SELECT policy).

BEGIN;

-- ── 1. Board-privacy gate for tasks ───────────────────────────────────────────
-- Is this task inside a private board that the current user is NOT allowed into?
-- SECURITY DEFINER so it reads boards/columns/board_members as the owner and does
-- not recurse back through the tasks policy that calls it. IS DISTINCT FROM makes a
-- NULL board creator fail safe (treated as "not me" → hidden), though created_by is
-- NOT NULL in practice.
CREATE OR REPLACE FUNCTION private.task_hidden_by_board_privacy(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks   t
    JOIN public.columns c ON c.id = t.column_id
    JOIN public.boards  b ON b.id = c.board_id
    WHERE t.id = p_task_id
      AND b.is_private
      AND (b.created_by IS DISTINCT FROM auth.uid())
      AND NOT public.is_board_member(b.id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION private.task_hidden_by_board_privacy(uuid) FROM public;
GRANT EXECUTE ON FUNCTION private.task_hidden_by_board_privacy(uuid) TO authenticated;

-- ── 2. Task VIEW respects board privacy ───────────────────────────────────────
-- Board privacy is ANDed on top of the existing rule: it only ever *removes*
-- access, so a board member/creator still falls through to the normal per-task
-- visibility logic below.
CREATE OR REPLACE FUNCTION private.can_view_task(
  p_task_id UUID,
  p_created_by UUID,
  p_visibility TEXT,
  p_assigned_to UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT private.task_hidden_by_board_privacy(p_task_id)
    AND (
      private.is_admin_user()
      OR p_visibility = 'board'
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

-- ── 3. Task MANAGE respects board privacy ─────────────────────────────────────
-- Covers update, assignees, comments, attachments, links, tags and the soft-delete
-- UPDATE path — all of which route through can_manage_task.
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

-- Hard-delete path (rarely used; the app soft-deletes via UPDATE). Keep the
-- can_delete_task signature stable (060's trigger depends on it) and add the board
-- gate at the policy instead.
DROP POLICY IF EXISTS "Creators and admins can delete tasks" ON public.tasks;
CREATE POLICY "Creators and admins can delete tasks"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (
    private.can_delete_task(created_by)
    AND NOT private.task_hidden_by_board_privacy(id)
  );

-- ── 4. Board SELECT: privacy applies to everyone, admins included ─────────────
-- Replaces 051's version, which let admins see every private board. The archive
-- rule (036: archived boards are admin-only) is preserved and ANDed with privacy.
DROP POLICY IF EXISTS "Users can view boards" ON public.boards;
CREATE POLICY "Users can view boards" ON public.boards FOR SELECT
  TO authenticated
  USING (
    (
      NOT is_private
      OR auth.uid() = created_by
      OR public.is_board_member(id, auth.uid())
    )
    AND (
      archived_at IS NULL
      OR private.is_admin_user()
    )
  );

-- ── 5. Board UPDATE / DELETE: private boards are the creator's alone ──────────
-- Prevents another admin from un-privating, editing, archiving or deleting a
-- private board they aren't the creator of. Non-private boards stay open to all
-- admins as before.
DROP POLICY IF EXISTS "Only admins can update boards" ON public.boards;
CREATE POLICY "Only admins can update boards" ON public.boards FOR UPDATE
  TO authenticated
  USING (
    private.is_admin_user()
    AND (NOT is_private OR auth.uid() = created_by)
  )
  WITH CHECK (
    private.is_admin_user()
    AND (NOT is_private OR auth.uid() = created_by)
  );

DROP POLICY IF EXISTS "Only admins can delete boards" ON public.boards;
CREATE POLICY "Only admins can delete boards" ON public.boards FOR DELETE
  TO authenticated
  USING (
    private.is_admin_user()
    AND (NOT is_private OR auth.uid() = created_by)
  );

-- ── 6. board_members: only the board creator controls membership ──────────────
-- Drops the admin bypass from 049 (which made "remove admin access" bypassable —
-- an admin could add themselves). The board's creator is the sole owner of its
-- membership list; members can still see their own row.
DROP POLICY IF EXISTS "View board memberships" ON public.board_members;
CREATE POLICY "View board memberships" ON public.board_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_id AND b.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Manage board memberships insert" ON public.board_members;
CREATE POLICY "Manage board memberships insert" ON public.board_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_id AND b.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Manage board memberships delete" ON public.board_members;
CREATE POLICY "Manage board memberships delete" ON public.board_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_id AND b.created_by = auth.uid()
    )
  );

COMMIT;
