-- 107: make a status rename actually reach every board column that represents it.
--
-- WHAT WAS ACTUALLY BROKEN
-- components/admin/status-management.tsx renames a status and then sweeps board columns so
-- the headers agree with it. 099 recorded, as a deliberate decision, that the columns write
-- policies stay private.is_admin_user() precisely "so an admin can still write columns on a
-- private board they cannot read... that sweep must still reach private boards."
--
-- That is not what Postgres does, and it never was. RLS applies SELECT policies to an UPDATE
-- whenever the command has to read the existing row to find it — which every `UPDATE ...
-- WHERE` does. 099 narrowed the columns SELECT policy with column_hidden_by_board_privacy,
-- so from that migration onward an admin who is not a member of a private board matches zero
-- rows there and the UPDATE quietly does nothing. Measured, not reasoned: with a throwaway
-- admin and two boards differing only in is_private, the same
-- `UPDATE columns SET title=... WHERE status_key='done'` renamed the public board's column
-- and left the private board's reading "Completed".
--
-- So renaming "Completed" to "Done" renamed it on the open boards and nowhere else. Nobody
-- would notice: the admin who did it cannot see the boards that were skipped, and the people
-- who can see them were not the ones renaming. The result is every board disagreeing about
-- the name of the same status, which is the thing this is supposed to prevent.
--
-- THE FIX, AND WHY IT DOES NOT REOPEN 061
-- One SECURITY DEFINER function that writes exactly one column of exactly one table —
-- columns.title, for rows already linked to the status by 063's FK — gated on
-- private.is_admin_user() (admin and super_admin, with 101's is_active folded in).
--
-- It reads nothing back. Not a title, not a board id, not a task. Its return value is an
-- integer: how many columns were renamed. An admin already knows every status and can already
-- count public boards, so the only thing that integer adds is a count of private boards
-- carrying a column for a given status — which is a far smaller disclosure than the column
-- titles 099 was closing off, and it is the number the UI needs to avoid claiming a success
-- that did not happen.
--
-- It cannot rename a column that is not linked to a status: a board's custom columns belong
-- to the board. It cannot touch status_key, color, position, or which board a column is on.

BEGIN;

CREATE TEMP TABLE _107_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.columns)                                    AS column_rows,
  (SELECT count(*) FROM public.columns WHERE status_key IS NOT NULL)       AS linked_rows,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'columns')                 AS policy_rows;

CREATE OR REPLACE FUNCTION public.rename_columns_for_status(
  p_status_key text,
  p_title      text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text := btrim(coalesce(p_title, ''));
  v_rows  integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same set as the columns write policies this stands in for. Nothing is widened: an
  -- admin could already rename these columns on every board they can see.
  IF NOT private.is_admin_user() THEN
    RAISE EXCEPTION 'Only admins can rename board columns.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_status_key IS NULL OR btrim(p_status_key) = '' THEN
    RAISE EXCEPTION 'A status is required.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_title = '' THEN
    RAISE EXCEPTION 'A column needs a name.' USING ERRCODE = 'check_violation';
  END IF;

  -- The status has to exist. Without this a typo'd key silently renames nothing and reports
  -- a truthful-looking zero.
  IF NOT EXISTS (SELECT 1 FROM public.task_statuses WHERE key = p_status_key) THEN
    RAISE EXCEPTION 'No such status: %', p_status_key USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.columns
     SET title = v_title
   WHERE status_key = p_status_key
     AND title IS DISTINCT FROM v_title;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_columns_for_status(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_columns_for_status(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_columns_for_status(text, text) TO authenticated;

COMMENT ON FUNCTION public.rename_columns_for_status(text, text) IS
  'Renames every board column linked to a status, private boards included, and returns how '
  'many changed. Admin-only. Writes columns.title and nothing else; reads nothing back.';

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before_columns bigint;
  v_before_linked  bigint;
  v_before_policy  bigint;
  v_after          bigint;
BEGIN
  IF to_regprocedure('public.rename_columns_for_status(text, text)') IS NULL THEN
    RAISE EXCEPTION 'rename_columns_for_status is missing. Aborting.';
  END IF;

  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'rename_columns_for_status') THEN
    RAISE EXCEPTION 'rename_columns_for_status must be SECURITY DEFINER — that is its whole '
                    'reason to exist. Aborting.';
  END IF;

  -- 095's lesson: CREATE FUNCTION grants EXECUTE to PUBLIC implicitly, and anon inherits it.
  -- Load-bearing on a SECURITY DEFINER function that writes across every board.
  IF has_function_privilege('anon', 'public.rename_columns_for_status(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute rename_columns_for_status. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rename_columns_for_status(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute rename_columns_for_status. Aborting.';
  END IF;

  -- This migration must not relax the table's own protection; the function is the only
  -- thing that steps around it, and only for one column.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.columns'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.columns. Aborting.';
  END IF;

  SELECT column_rows, linked_rows, policy_rows
    INTO v_before_columns, v_before_linked, v_before_policy
  FROM _107_precheck;

  SELECT count(*) INTO v_after FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'columns';
  IF v_after IS DISTINCT FROM v_before_policy THEN
    RAISE EXCEPTION 'columns policy count changed (% -> %). Aborting.', v_before_policy, v_after;
  END IF;

  -- A function-only migration must not move a row or unlink a column.
  SELECT count(*) INTO v_after FROM public.columns;
  IF v_after IS DISTINCT FROM v_before_columns THEN
    RAISE EXCEPTION 'columns row count changed (% -> %). Aborting.', v_before_columns, v_after;
  END IF;

  SELECT count(*) INTO v_after FROM public.columns WHERE status_key IS NOT NULL;
  IF v_after IS DISTINCT FROM v_before_linked THEN
    RAISE EXCEPTION 'linked column count changed (% -> %). Aborting.', v_before_linked, v_after;
  END IF;

  RAISE NOTICE '107 verified: rename cascade in place, % columns (% linked) untouched.',
    v_before_columns, v_before_linked;
END $$;

COMMIT;
