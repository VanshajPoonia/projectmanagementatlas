-- Private boards were leaking their column structure. Found by scripts/check-access-matrix.mjs.
--
-- Migration 061 states its guarantee explicitly: "a PRIVATE board, and every
-- task/comment/attachment/link/tag inside it, is visible and manageable ONLY to the board's
-- creator and to users explicitly listed in board_members." `columns` is not in that list,
-- and it was never added — it still carried the original policy from 001:
--
--     CREATE POLICY "Users can view all columns" ON public.columns
--       FOR SELECT USING (auth.uid() IS NOT NULL);
--
-- So any signed-in user could read the columns of any private board by board id: their
-- titles, order and status keys. The tasks inside stayed hidden (061 did cover those), so
-- this leaked the shape and naming of private work rather than its content — a column named
-- "Legal review — Henderson dispute" being the obvious way that matters.
--
-- 067 already built exactly the helper this needs, for the tasks INSERT policy. Reusing it
-- keeps one definition of "is this column inside a private board I'm not in", rather than a
-- second copy to drift. It is SECURITY DEFINER, so reading public.columns from inside the
-- policy on public.columns does not recurse — the same pattern
-- private.task_hidden_by_board_privacy has used on tasks since 061.
--
-- ── Deliberately NOT changed: the write policies ─────────────────────────────────────
-- INSERT/UPDATE/DELETE on columns remain `private.is_admin_user()`, so an admin can still
-- write columns on a private board they cannot read. That asymmetry is odd, but narrowing it
-- would break status renaming: components/admin/status-management.tsx keeps board columns in
-- sync with a status label by updating every column with the old title across all boards at
-- once, and that sweep must still reach private boards. The disclosure is the security
-- problem; the write asymmetry is a consistency wart with a working dependency on it. Left
-- as a known, deliberate state rather than an oversight.

BEGIN;

DROP POLICY IF EXISTS "Users can view all columns" ON public.columns;
DROP POLICY IF EXISTS "Users can view visible columns" ON public.columns;

CREATE POLICY "Users can view visible columns" ON public.columns FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND NOT private.column_hidden_by_board_privacy(id)
  );

-- ── Post-conditions ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_select int;
  v_qual   text;
BEGIN
  SELECT count(*) INTO v_select
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'columns' AND cmd = 'SELECT';
  IF v_select <> 1 THEN
    RAISE EXCEPTION 'columns should have exactly 1 SELECT policy, found %', v_select;
  END IF;

  SELECT qual INTO v_qual
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'columns' AND cmd = 'SELECT';
  IF v_qual NOT LIKE '%column_hidden_by_board_privacy%' THEN
    RAISE EXCEPTION 'the columns SELECT policy does not apply the board-privacy check: %', v_qual;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.columns'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on columns';
  END IF;

  -- The helper this policy depends on must exist and be SECURITY DEFINER, or the policy
  -- would recurse into itself instead of failing loudly here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'column_hidden_by_board_privacy' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'private.column_hidden_by_board_privacy is missing or not SECURITY DEFINER';
  END IF;

  -- Writes are intentionally untouched; assert that so a future edit here is a decision.
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'columns' AND cmd <> 'SELECT') <> 3 THEN
    RAISE EXCEPTION 'expected the 3 admin write policies on columns to be unchanged';
  END IF;
END $$;

COMMIT;
