-- Fixes a real, pre-existing privacy bug found while verifying migration 069, NOT introduced by
-- it: `boards` has had TWO permissive SELECT policies since 061_private_board_access.sql —
--   "Users can view boards" (061): (privacy check) AND (archived_at IS NULL OR is_admin_user())
--   "View active boards, ... see archived too" (036/047, renamed by 069): archived_at IS NULL OR ...
-- Postgres OR's multiple permissive policies for the same command together. The second policy's
-- clause is true for ANY non-archived board regardless of privacy, so it silently defeated the
-- first policy's privacy check for every non-archived board — confirmed live: a plain
-- authenticated user with no board membership, not the creator, not an admin, could read a
-- private board's row directly. This predates this migration; 069 only renamed/re-scoped the
-- second policy without noticing it overlapped with 061's, so it didn't introduce the leak but
-- also didn't close it.
--
-- Fix: drop the redundant second policy entirely and fold its archived-visibility intent into
-- 061's policy (already the correct, privacy-aware one) — one policy, one condition, no OR-leak.

BEGIN;

DROP POLICY IF EXISTS "View active boards, super admins see archived too" ON public.boards;
DROP POLICY IF EXISTS "View active boards, admins see archived too" ON public.boards;

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
      OR private.is_super_admin_user()
    )
  );

COMMIT;
