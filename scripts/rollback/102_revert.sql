-- Rollback for 102_move_task_between_boards.sql.
--
-- Restores the tasks UPDATE policy verbatim as 035 defined it (and 065/101 left it: the
-- board-privacy, guest/client and is_active gates all live inside private.can_manage_task,
-- which this file does not touch), then drops the two functions 102 added.
--
-- ⚠️ Reverting RE-OPENS the hole 102 closed: with the destination terms gone from the WITH
-- CHECK, an UPDATE that changes column_id is judged only against the board the task is
-- LEAVING, so anyone who can manage a task can move it onto a private board they are not a
-- member of, or onto a board where they are a guest/client. Only revert alongside the client
-- code that offers the move (components/board/move-task-dialog.tsx and its call site in
-- task-detail-modal.tsx) — with that UI still deployed and the RPC dropped, every move
-- attempt fails with "function does not exist".
--
-- No rows are read or written, so nothing here can destroy data.

BEGIN;

DROP POLICY IF EXISTS "Collaborators can update tasks" ON public.tasks;
CREATE POLICY "Collaborators can update tasks"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (private.can_manage_task(id, created_by, assigned_to))
  WITH CHECK (private.can_manage_task(id, created_by, assigned_to));

DROP FUNCTION IF EXISTS public.move_task_to_board(uuid, uuid);
DROP FUNCTION IF EXISTS public.task_move_plan(uuid, uuid);

DO $$
DECLARE
  v_check TEXT;
BEGIN
  SELECT with_check INTO v_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Collaborators can update tasks';

  IF v_check IS NULL OR v_check LIKE '%column_hidden_by_board_privacy%' THEN
    RAISE EXCEPTION 'tasks UPDATE policy was not restored to its pre-102 form: %. Aborting.', v_check;
  END IF;

  IF to_regprocedure('public.move_task_to_board(uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'move_task_to_board still exists. Aborting.';
  END IF;

  RAISE NOTICE '102 reverted: destination guards removed, move RPC dropped.';
END $$;

COMMIT;
