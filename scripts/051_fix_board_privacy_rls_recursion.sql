-- Fix: project boards became invisible to ALL users after the board-privacy
-- migration (049). Two separate problems on public.boards' SELECT policies:
--
--   1) INFINITE RECURSION
--      049's "Users can view boards" policy subqueries public.board_members,
--      whose own SELECT policy ("View board memberships") subqueries
--      public.boards. That mutual reference is a cycle; Postgres aborts every
--      boards read with:
--        ERROR: infinite recursion detected in policy for relation "boards"
--      The Supabase JS client turns that error into data = null, so the app's
--      `boards || []` renders as zero boards -- for every non-service-role
--      user at once (this is a policy-level failure, not per-user data).
--
--   2) TWO OVERLAPPING PERMISSIVE SELECT POLICIES
--      049 tried to DROP "Users can view all boards", but migration 036 had
--      already replaced that policy with "View active boards, admins see
--      archived too". So 049's DROP was a no-op and BOTH SELECT policies stayed
--      active. Multiple PERMISSIVE policies are OR'd together, which quietly
--      defeats both features: any active board satisfied 036's policy (breaking
--      049's privacy), and any non-private board satisfied 049's policy
--      (breaking 036's archive-hiding).
--
-- This migration replaces BOTH policies with a single consolidated SELECT
-- policy that ANDs the archive rule with the privacy rule, and checks board
-- membership through a SECURITY DEFINER helper so the boards policy never
-- recurses back through board_members' policy.
--
-- Requires 036 (archived_at) and 049 (is_private, board_members) to be applied.

BEGIN;

-- Membership check that runs as the function owner (postgres), which is exempt
-- from RLS on tables it owns. Reading board_members here therefore does NOT
-- invoke board_members' policy, so the boards policy below cannot recurse.
CREATE OR REPLACE FUNCTION public.is_board_member(p_board_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.board_members
    WHERE board_id = p_board_id AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_board_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_board_member(uuid, uuid) TO authenticated;

-- Remove BOTH overlapping SELECT policies left behind by 036 and 049.
DROP POLICY IF EXISTS "View active boards, admins see archived too" ON public.boards;
DROP POLICY IF EXISTS "Users can view boards" ON public.boards;

-- One policy that enforces archive-hiding AND privacy together.
CREATE POLICY "Users can view boards" ON public.boards FOR SELECT
  TO authenticated
  USING (
    -- Admins and super admins see every board (archived and private included).
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin','super_admin')
    )
    -- Everyone else: the board must be active AND visible to them.
    OR (
      archived_at IS NULL
      AND (
        NOT is_private
        OR auth.uid() = created_by
        OR public.is_board_member(id, auth.uid())
      )
    )
  );

COMMIT;
