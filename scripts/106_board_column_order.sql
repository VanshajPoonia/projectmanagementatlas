-- 106: let a board's columns be rearranged, and make every column that represents a status
-- actually say so, so a status rename reaches it.
--
-- ── PART 1: ordering ────────────────────────────────────────────────────────────────
-- `columns.position` has decided left-to-right order on every kanban board since 001, and
-- nothing has ever written it except the four-column seed in board-management.tsx and the
-- append in board-view.tsx's "Add column". A column added later is therefore pinned to the
-- far right forever: a board that grew a "Blocked" column has it sitting after "Cancelled",
-- with no way to move it. The marketing calendar got exactly this ability in 088; boards,
-- which are the main screen of the product, did not.
--
-- WHY AN RPC RATHER THAN N CLIENT UPDATES
-- Reordering is one intent spanning every column on the board. Sent as N separate PostgREST
-- UPDATEs it is N transactions: a failure partway leaves the board in an order nobody chose,
-- and under RLS a refusal is not an error — it is a zero-row response indistinguishable from
-- "nothing to change" (CLAUDE.md's board-membership lesson). One statement inside plpgsql is
-- atomic, and GET DIAGNOSTICS turns the refusal into a raised exception the UI can show.
--
-- SECURITY INVOKER on purpose. `columns` UPDATE is private.is_admin_user() and stays that
-- way; this function grants nobody anything. RLS remains the authority, exactly as 102's
-- move_task_to_board is written. Note the consequence, which is deliberate: a non-admin's
-- UPDATE matches no rows, the row count comes back short, and they get a refusal instead of
-- a silent no-op.
--
-- THE STALENESS GUARD is 088's, for 088's reason: the caller must send every column on the
-- board exactly once. Someone reordering against a list that is missing a column another
-- person just added would otherwise renumber a partial list and drop that column into an
-- arbitrary slot. A short list is rejected with an error the client recovers from by
-- reloading. Because the function is SECURITY INVOKER, the "every column on the board"
-- count is itself RLS-filtered — a user who cannot SELECT a private board's columns (099)
-- counts zero of them and is refused here rather than reordering a board they cannot see.
--
-- ── PART 2: linking drifted columns to their status ─────────────────────────────────
-- 063 added columns.status_key and backfilled it. Columns created since by "Add column"
-- with the status picker left on "None" have no key, and components/admin/status-management
-- renames columns by matching their TITLE against the status's old label — so a column that
-- represents "To Do" but has no status_key is renamed only while its title happens to still
-- read exactly "To Do", and silently stops tracking the status the moment either changes.
-- The client half of this fix switches that sweep to match on status_key; this half makes
-- sure the columns that already agree with a status by title carry the key, so the switch
-- does not quietly narrow what the sweep reaches.
--
-- Deliberately conservative: only where status_key IS NULL, only on an exact
-- (case-insensitive) match against an ACTIVE status's label, and only when that board has no
-- other column already claiming that status. Every row it touches would have been renamed by
-- the old title sweep anyway, so no column changes what it is called as a result of this.

BEGIN;

CREATE TEMP TABLE _106_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.columns)                          AS column_rows,
  (SELECT count(*) FROM public.columns WHERE status_key IS NULL) AS unlinked_rows;

-- ---------------------------------------------------------------------------
-- 1. Reorder.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reorder_board_columns(
  p_board_id   uuid,
  p_column_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_given   integer;
  v_matched integer;
  v_total   integer;
  v_updated integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_given := coalesce(array_length(p_column_ids, 1), 0);
  IF p_board_id IS NULL OR v_given = 0 THEN
    RAISE EXCEPTION 'A board and a column ordering are required.' USING ERRCODE = 'check_violation';
  END IF;

  IF array_position(p_column_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Column ordering contains a NULL id.' USING ERRCODE = 'check_violation';
  END IF;

  -- DISTINCT so a duplicated id fails the equality below rather than quietly winning the
  -- last slot it appears in. Both counts are scoped to the board, so an id belonging to a
  -- different board is simply not matched and the ordering is rejected as stale.
  SELECT count(DISTINCT id) INTO v_matched
  FROM public.columns
  WHERE board_id = p_board_id AND id = ANY(p_column_ids);

  SELECT count(*) INTO v_total
  FROM public.columns
  WHERE board_id = p_board_id;

  IF v_matched <> v_given OR v_given <> v_total THEN
    RAISE EXCEPTION
      'Column ordering is out of date: expected all % columns on this board exactly once, got %.',
      v_total, v_given
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.columns c
     SET position = ord.sort_index - 1
    FROM unnest(p_column_ids) WITH ORDINALITY AS ord(column_id, sort_index)
   WHERE c.id = ord.column_id
     AND c.board_id = p_board_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- The UPDATE is filtered by the columns UPDATE policy (private.is_admin_user). A refusal
  -- is silent there and would otherwise return "success, 0 changed".
  IF v_updated <> v_given THEN
    RAISE EXCEPTION 'You do not have permission to rearrange this board''s columns.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_board_columns(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_board_columns(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_board_columns(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.reorder_board_columns(uuid, uuid[]) IS
  'Renumbers columns.position on one board to match the given id order, atomically. '
  'SECURITY INVOKER — RLS still decides; this only makes a refusal loud instead of a no-op.';

-- ---------------------------------------------------------------------------
-- 2. Link the columns that already agree with a status by title.
-- ---------------------------------------------------------------------------

UPDATE public.columns c
   SET status_key = s.key
  FROM public.task_statuses s
 WHERE c.status_key IS NULL
   AND NOT s.is_archived
   AND lower(btrim(s.label)) = lower(btrim(c.title))
   -- idx_columns_board_status_key_unique: one column per status per board. Without this a
   -- board holding both "Completed" (linked) and a second, unlinked "Completed" would abort
   -- the whole migration on a duplicate key.
   AND NOT EXISTS (
     SELECT 1 FROM public.columns other
     WHERE other.board_id = c.board_id
       AND other.status_key = s.key
   );

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before_columns  bigint;
  v_before_unlinked bigint;
  v_after           bigint;
  v_broken          bigint;
BEGIN
  IF to_regprocedure('public.reorder_board_columns(uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'reorder_board_columns is missing. Aborting.';
  END IF;

  -- SECURITY INVOKER is load-bearing here: as DEFINER this function would hand every
  -- signed-in user the ability to rearrange any board, admin-only policy or not.
  IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'reorder_board_columns') THEN
    RAISE EXCEPTION 'reorder_board_columns must be SECURITY INVOKER. Aborting.';
  END IF;

  -- 095's lesson: CREATE FUNCTION grants EXECUTE to PUBLIC implicitly, and anon inherits it.
  IF has_function_privilege('anon', 'public.reorder_board_columns(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute reorder_board_columns. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.reorder_board_columns(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute reorder_board_columns. Aborting.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.columns'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.columns. Aborting.';
  END IF;

  -- The backfill links rows; it must never create or destroy one.
  SELECT column_rows, unlinked_rows INTO v_before_columns, v_before_unlinked FROM _106_precheck;
  SELECT count(*) INTO v_after FROM public.columns;
  IF v_after IS DISTINCT FROM v_before_columns THEN
    RAISE EXCEPTION 'columns row count changed (% -> %). Aborting.', v_before_columns, v_after;
  END IF;

  -- ...and it must only ever have reduced the unlinked set.
  SELECT count(*) INTO v_after FROM public.columns WHERE status_key IS NULL;
  IF v_after > v_before_unlinked THEN
    RAISE EXCEPTION 'the backfill unlinked columns instead of linking them (% -> %). Aborting.',
      v_before_unlinked, v_after;
  END IF;

  -- Every key it wrote must name a real status, and no board may hold two columns for one
  -- status (the unique index would have raised, but assert it rather than assume).
  SELECT count(*) INTO v_broken
  FROM public.columns c
  WHERE c.status_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.task_statuses s WHERE s.key = c.status_key);
  IF v_broken > 0 THEN
    RAISE EXCEPTION '% columns point at a status that does not exist. Aborting.', v_broken;
  END IF;

  SELECT count(*) INTO v_broken
  FROM (SELECT board_id, status_key FROM public.columns WHERE status_key IS NOT NULL
        GROUP BY board_id, status_key HAVING count(*) > 1) dupes;
  IF v_broken > 0 THEN
    RAISE EXCEPTION '% board/status pairs have more than one column. Aborting.', v_broken;
  END IF;

  RAISE NOTICE '106 verified: reorder RPC in place, % columns, % still unlinked (was %).',
    v_before_columns, v_after, v_before_unlinked;
END $$;

COMMIT;
