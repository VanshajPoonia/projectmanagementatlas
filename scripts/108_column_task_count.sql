-- 108: let the board tell the truth about whether a column is empty.
--
-- WHAT IS WRONG
-- board-view.tsx guards column deletion with `column.tasks.length > 0`, where `tasks` came
-- from the board query and is therefore RLS-filtered. private.can_view_task hides ARCHIVED
-- tasks from everyone except a super_admin:
--
--     private.is_super_admin_user()
--     OR NOT EXISTS (SELECT 1 FROM tasks WHERE id = p_task_id AND archived_at IS NOT NULL)
--
-- while the `columns` DELETE policy is private.is_admin_user(), which includes PLAIN admins.
-- So a plain admin looking at a column that holds nothing but archived work sees an empty
-- column, the client guard waves them through, they confirm a prompt that says "Remove this
-- empty column?", and only then does 074's prevent_nonempty_column_delete trigger refuse
-- with "Move or archive every task before deleting this column" — a sentence that flatly
-- contradicts the empty column they are looking at.
--
-- Measured before writing this, with a plain admin and a super_admin against the same
-- column of three archived tasks: the admin's board query returned 0 tasks, the
-- super_admin's returned 3, and the DELETE was refused. **No data is lost** — 074 holds the
-- line, and that is the only reason this is a clarity bug rather than a destructive one.
--
-- THE FIX
-- Stop asking the client. It cannot answer: it can only report what it was allowed to see,
-- and "hidden from you" and "does not exist" arrive looking identical. This function counts
-- every task row in the column regardless of RLS and returns a breakdown, so the UI can say
-- what is actually in the way before anyone confirms anything.
--
-- WHAT IT DISCLOSES, AND WHY THAT IS FINE
-- Three integers, to admins only — the same set the columns DELETE policy already trusts to
-- remove columns. An admin can already see every non-archived task; the only thing this adds
-- is that some archived ones exist. That is precisely the fact the refusal is about, and
-- withholding it is what makes the current message unreadable. No title, no assignee, no id.

BEGIN;

CREATE TEMP TABLE _108_precheck ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.tasks)   AS task_rows,
       (SELECT count(*) FROM public.columns) AS column_rows;

CREATE OR REPLACE FUNCTION public.board_column_task_count(p_column_id uuid)
RETURNS TABLE (total integer, active integer, archived integer, deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same set the columns DELETE policy trusts. A non-admin cannot delete a column, so it has
  -- no reason to learn what is inside one it cannot see.
  IF NOT private.is_admin_user() THEN
    RAISE EXCEPTION 'Only admins can inspect a board column.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE t.deleted_at IS NULL AND t.archived_at IS NULL)::integer,
    count(*) FILTER (WHERE t.deleted_at IS NULL AND t.archived_at IS NOT NULL)::integer,
    count(*) FILTER (WHERE t.deleted_at IS NOT NULL)::integer
  FROM public.tasks t
  WHERE t.column_id = p_column_id;
END;
$$;

REVOKE ALL ON FUNCTION public.board_column_task_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_column_task_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.board_column_task_count(uuid) TO authenticated;

COMMENT ON FUNCTION public.board_column_task_count(uuid) IS
  'True count of every task row in a board column, RLS included, so the UI can say what is '
  'blocking a column delete instead of inferring emptiness from rows it was allowed to see. '
  'Admin-only. Returns counts and nothing identifying.';

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks   bigint;
  v_before_columns bigint;
  v_after          bigint;
BEGIN
  IF to_regprocedure('public.board_column_task_count(uuid)') IS NULL THEN
    RAISE EXCEPTION 'board_column_task_count is missing. Aborting.';
  END IF;

  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'board_column_task_count') THEN
    RAISE EXCEPTION 'board_column_task_count must be SECURITY DEFINER — seeing past RLS is '
                    'its entire purpose. Aborting.';
  END IF;

  -- 095's lesson: CREATE FUNCTION grants EXECUTE to PUBLIC implicitly, and anon inherits it.
  IF has_function_privilege('anon', 'public.board_column_task_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute board_column_task_count. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.board_column_task_count(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute board_column_task_count. Aborting.';
  END IF;

  -- The trigger this function explains must still be in place; without it the honest count
  -- would be advice rather than a guarantee, and a cascade really could destroy work.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'prevent_nonempty_column_delete'
      AND tgrelid = 'public.columns'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '074''s prevent_nonempty_column_delete trigger is missing — a column '
                    'delete would cascade into its tasks. Aborting.';
  END IF;

  SELECT task_rows, column_rows INTO v_before_tasks, v_before_columns FROM _108_precheck;

  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_after IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed during a function-only migration (% -> %). Aborting.',
      v_before_tasks, v_after;
  END IF;

  SELECT count(*) INTO v_after FROM public.columns;
  IF v_after IS DISTINCT FROM v_before_columns THEN
    RAISE EXCEPTION 'columns row count changed during a function-only migration (% -> %). Aborting.',
      v_before_columns, v_after;
  END IF;

  RAISE NOTICE '108 verified: honest column task count in place, % tasks untouched.', v_after;
END $$;

COMMIT;
