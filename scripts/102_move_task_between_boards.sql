-- 102: let a task be moved to a different board, and stop an UPDATE from smuggling one
-- into a board the mover has no business writing to.
--
-- WHY THIS EXISTS
-- A task's board is not a column on `tasks` — it is derived, `tasks.column_id -> columns.board_id`.
-- So "move this task to another board" is just an UPDATE of column_id, and until now the app had
-- no UI for it: put a card on the wrong board and the only fix was to retype it somewhere else and
-- delete the original, losing its comments, attachments, activity and subtasks.
--
-- THE HOLE THAT OPENING THAT DOOR WOULD LEAVE
-- The tasks UPDATE policy reads, in full:
--     USING       private.can_manage_task(id, created_by, assigned_to)
--     WITH CHECK  private.can_manage_task(id, created_by, assigned_to)
-- Every gate inside can_manage_task (board privacy from 061, guest/client from 065, is_active from
-- 101) resolves the board by looking the task up in `public.tasks` BY ID. In a WITH CHECK that
-- lookup still sees the pre-UPDATE row, so all of them describe the board the task is LEAVING and
-- none of them describe the board it is ARRIVING at. Result: with only a column id, any user who
-- can manage a task could push it into a private board they are not a member of, or into a board
-- where their board_members role is guest/client and they may not write. Nothing in the policy set
-- looked at the destination at all.
--
-- 067 already hit this exact problem on INSERT — can_manage_task takes a task id, and at INSERT
-- time there is no task yet — and solved it with two column-id-keyed helpers,
-- private.column_hidden_by_board_privacy and private.column_restricted_by_board_role. Those take
-- the destination column directly, so in a WITH CHECK they read the NEW value. Reusing them here
-- makes UPDATE enforce on arrival exactly what INSERT already enforces, with no new rule invented
-- and no second definition of "may I write to this board" to keep in sync.
--
-- NOT A NARROWING FOR ANY EXISTING FLOW. For an UPDATE that leaves column_id alone, or moves a
-- card between columns of the same board, both new terms are already false for anyone the USING
-- clause let through: they can see the board (or can_manage_task would have failed on privacy) and
-- they are not a guest/client on it (same). The only UPDATE this rejects that previously succeeded
-- is one that moves a task onto a board the caller cannot write to — which never had a UI.
--
-- WHAT ELSE HAS TO MOVE
-- Subtasks inherit the parent's column_id (060, and components/board/subtask-list.tsx inserts them
-- that way). Left behind, a subtask keeps the SOURCE board's privacy and role rules while its
-- parent lives on another board — the row is invisible on both boards' kanban (board queries
-- filter parent_task_id IS NULL) yet still governed by a board its parent left. So the move takes
-- them along, and public.move_task_to_board() below does the parent and the children in one
-- transaction so a partial move cannot be left behind.
--
-- WHY AN RPC RATHER THAN TWO CLIENT UPDATES
-- Under RLS a refused UPDATE is not an error — PostgREST reports zero rows changed, which is
-- indistinguishable from "nothing needed changing". That is the exact trap recorded in CLAUDE.md
-- for board membership writes. Inside plpgsql, GET DIAGNOSTICS turns the refusal into a raised
-- exception, and the surrounding transaction rolls the whole move back. The function is SECURITY
-- INVOKER on purpose: every write inside it is still filtered by the policies above. It grants
-- nothing; it only makes an already-permitted change atomic and loud when it is refused.

BEGIN;

-- Snapshot for the post-conditions: a policy-and-function migration must not move a single row.
CREATE TEMP TABLE _102_precheck ON COMMIT DROP AS
SELECT count(*) AS task_rows FROM public.tasks;

-- ---------------------------------------------------------------------------
-- 1. The destination checks on UPDATE.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Collaborators can update tasks" ON public.tasks;
CREATE POLICY "Collaborators can update tasks"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (private.can_manage_task(id, created_by, assigned_to))
  WITH CHECK (
    private.can_manage_task(id, created_by, assigned_to)
    -- column_id here is the NEW value. These are 067's helpers, unchanged, so the board a
    -- task lands on is judged by the same rule as the board a task is created on.
    AND NOT private.column_hidden_by_board_privacy(column_id)
    AND NOT private.column_restricted_by_board_role(column_id)
  );

-- ---------------------------------------------------------------------------
-- 2. Planning helper. SECURITY DEFINER for one narrow reason: both numbers it
--    returns must count rows the CALLER may not be able to see.
--
--    The next position has to account for every card already in the destination
--    column, including ones hidden from this user by visibility='assigned', or
--    the moved card silently lands on top of one of them. The subtask count has
--    to be the true count for the same reason: the comparison in
--    move_task_to_board is what proves no subtask was quietly left behind, and
--    an RLS-filtered count would agree with an RLS-filtered UPDATE and prove
--    nothing.
--
--    It lives in `public`, not `private`, because `private` is deliberately
--    unreachable by `authenticated` — that schema has no USAGE grant, which is
--    why RLS can call private.can_manage_task (policy expressions are evaluated
--    as the table owner) while an ordinary function body called by a signed-in
--    user cannot. Being in `public` makes it callable over PostgREST, so it
--    gates itself on exactly the same private.can_manage_task the tasks UPDATE
--    policy uses: anyone who could not move the task gets no rows back and
--    learns nothing. What it returns even then is two integers — no title, no
--    assignee, no id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_move_plan(p_task_id uuid, p_column_id uuid)
RETURNS TABLE (next_position integer, subtasks_to_move integer)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_created_by  uuid;
  v_assigned_to uuid;
  v_found       boolean := false;
BEGIN
  SELECT t.created_by, t.assigned_to, true
    INTO v_created_by, v_assigned_to, v_found
  FROM public.tasks t
  WHERE t.id = p_task_id;

  -- No such task, or the caller may not manage it: return zero rows. The caller cannot
  -- distinguish the two, which is the point.
  IF NOT v_found THEN RETURN; END IF;
  IF NOT private.can_manage_task(p_task_id, v_created_by, v_assigned_to) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    (SELECT (COALESCE(MAX(t.position), -1) + 1)::integer
       FROM public.tasks t
      WHERE t.column_id = p_column_id
        AND t.parent_task_id IS NULL
        AND t.deleted_at IS NULL),
    (SELECT COUNT(*)::integer
       FROM public.tasks t
      WHERE t.parent_task_id = p_task_id
        AND t.column_id IS DISTINCT FROM p_column_id);
END;
$$;

REVOKE ALL ON FUNCTION public.task_move_plan(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_move_plan(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.task_move_plan(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The move itself.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.move_task_to_board(p_task_id uuid, p_column_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_destination_board uuid;
  v_is_subtask        boolean;
  v_next_position     integer;
  v_subtasks_expected integer;
  v_rows              integer;
BEGIN
  SELECT c.board_id INTO v_destination_board
  FROM public.columns c
  WHERE c.id = p_column_id;

  IF v_destination_board IS NULL THEN
    RAISE EXCEPTION 'That column no longer exists, or you cannot see the board it belongs to.'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT (t.parent_task_id IS NOT NULL) INTO v_is_subtask
  FROM public.tasks t
  WHERE t.id = p_task_id;

  IF v_is_subtask IS NULL THEN
    RAISE EXCEPTION 'That task no longer exists, or you cannot see it.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- A subtask has no board of its own; it lives wherever its parent lives. Moving one
  -- alone would split a parent and its children across two boards, each governed by a
  -- different board's privacy rules.
  IF v_is_subtask THEN
    RAISE EXCEPTION 'A subtask moves with its parent. Move the parent task instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT next_position, subtasks_to_move
    INTO v_next_position, v_subtasks_expected
  FROM public.task_move_plan(p_task_id, p_column_id);

  -- Zero rows means task_move_plan's own can_manage_task gate said no. Stopping here keeps
  -- the refusal a single clear sentence instead of a confusing "0 rows updated" further down.
  IF v_next_position IS NULL THEN
    RAISE EXCEPTION 'You do not have permission to move this task.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A destination the caller may not write to raises 42501 from the policy's WITH CHECK
  -- and aborts the transaction. A task the caller may not manage fails the USING clause
  -- instead, which is silent and updates nothing — hence the row count.
  UPDATE public.tasks
     SET column_id  = p_column_id,
         position   = v_next_position,
         updated_at = NOW()
   WHERE id = p_task_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'You do not have permission to move this task.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.tasks
     SET column_id  = p_column_id,
         updated_at = NOW()
   WHERE parent_task_id = p_task_id
     AND column_id IS DISTINCT FROM p_column_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> v_subtasks_expected THEN
    -- All or nothing. A parent on the new board with a subtask stranded on the old one is
    -- worse than a refused move, and harder to notice.
    RAISE EXCEPTION
      'This task has % subtask(s) you cannot move, so the move was cancelled.',
      v_subtasks_expected - v_rows
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_destination_board;
END;
$$;

REVOKE ALL ON FUNCTION public.move_task_to_board(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_task_to_board(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_task_to_board(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.move_task_to_board(uuid, uuid) IS
  'Move a top-level task (and its subtasks) into a column on another board, atomically. '
  'SECURITY INVOKER — RLS still decides; this only makes a refusal loud instead of a no-op.';

-- ---------------------------------------------------------------------------
-- Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before   BIGINT;
  v_after    BIGINT;
  v_policies TEXT[];
  v_expected TEXT[] := ARRAY[
    'Collaborators can create tasks',
    'Collaborators can update tasks',
    'Collaborators can view visible tasks'
  ];
  v_check    TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.tasks'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.tasks. Aborting.';
  END IF;

  SELECT array_agg(policyname ORDER BY policyname) INTO v_policies
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks';

  IF v_policies IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Unexpected policy set on public.tasks. Expected %, found %. Aborting.',
      v_expected, v_policies;
  END IF;

  -- The whole point of the migration: assert the destination terms actually landed in the
  -- WITH CHECK, rather than trusting that the CREATE POLICY above says what it means.
  SELECT with_check INTO v_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Collaborators can update tasks';

  IF v_check IS NULL
     OR v_check NOT LIKE '%column_hidden_by_board_privacy%'
     OR v_check NOT LIKE '%column_restricted_by_board_role%'
     OR v_check NOT LIKE '%can_manage_task%' THEN
    RAISE EXCEPTION 'tasks UPDATE WITH CHECK is missing a destination guard: %. Aborting.', v_check;
  END IF;

  IF to_regprocedure('public.move_task_to_board(uuid, uuid)') IS NULL
     OR to_regprocedure('public.task_move_plan(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'A function this migration creates is missing. Aborting.';
  END IF;

  -- 095's lesson: Postgres grants EXECUTE to PUBLIC implicitly on every new function, so the
  -- REVOKEs above are load-bearing and worth asserting rather than assuming.
  IF has_function_privilege('anon', 'public.move_task_to_board(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute move_task_to_board. Aborting.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.move_task_to_board(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute move_task_to_board. Aborting.';
  END IF;

  SELECT task_rows INTO v_before FROM _102_precheck;
  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'tasks row count changed during a policy-only migration (% -> %). Aborting.',
      v_before, v_after;
  END IF;

  RAISE NOTICE '102 verified: % policies on tasks, % rows untouched, move RPC in place.',
    array_length(v_policies, 1), v_after;
END $$;

COMMIT;
