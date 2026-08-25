-- 118: boards gain a parent, so a view can roll up the work beneath one.
--
-- WHAT IS WRONG
-- `boards` is a flat pool. There is no parent column, no grouping, nothing above a board at
-- all - verified against dev and prod, not assumed. So the single loudest requirement in
-- Prompt E has nothing to stand on:
--
--   "DESCENDANT SCOPE. Explicitly solve the recurring Vikunja community problem. Support:
--    Current project only / Current + direct children / Current + all descendants.
--    New child projects must automatically become part of an all-descendants view.
--    Do not store a static list of every descendant ID as the user-facing concept."
--
-- ATLAS_01 4.6 records why that phrasing is so exact: Vikunja users maintain the descendant
-- list BY HAND in a saved filter, so every new child project is invisible to the roll-up
-- until somebody remembers to edit the filter. The gap is not "no hierarchy", it is "the
-- hierarchy exists and the views do not follow it".
--
-- WHAT THIS ADDS
-- One nullable self-referencing column. That is the entire user-facing concept: a board
-- names its parent, and membership of "all descendants" is COMPUTED at read time by walking
-- down from the root. Nothing stores a descendant list, so a board created a minute ago is
-- in its ancestors' roll-ups the moment it is saved, with no view to update.
--
-- ON DELETE SET NULL, never CASCADE. Deleting a parent board must not delete the real work
-- underneath it; the children become roots. This mirrors 100's reasoning about
-- boards.created_by - a structural pointer is not a licence to destroy the thing it points at.
--
-- CYCLES ARE REFUSED BY A TRIGGER, and the walk is SECURITY DEFINER for the same reason
-- 115's is: a loop passing through a board the caller cannot SELECT must still be caught. A
-- cycle here is not cosmetic - `board_descendants` recurses, and a cycle in the data is an
-- infinite loop in every view built on it.
--
-- PRIVACY NEEDS NO NEW RULE, AND THAT IS DELIBERATE.
-- `boards`' SELECT policy (049/061) already hides a private board from a non-member. The
-- descendant walk in public.board_descendants is SECURITY INVOKER, so it sees exactly the
-- boards the caller sees: an unreadable child is simply not in the tree that caller gets, and
-- its tasks were never readable either. This is the ONE case in this repo where the "hidden
-- vs does not exist" trap is not a trap - "not in my roll-up because I cannot see it" is the
-- correct answer to give, not a wrong one, because the alternative is disclosing that the
-- board exists. Do not add an admin bypass here to make the counts look tidier.
--
-- ⚠️ Depth is NOT capped. A cap is a product decision that would silently refuse a legitimate
-- fifth level, and the only real risk of depth is runaway recursion, which the cycle guard
-- already removes. The walk carries its own step ceiling as a belt-and-braces guard and
-- RAISEs rather than truncating, per the lesson recorded for 116's catch-up loop: a guard that
-- truncates silently is a bug generator, not a safety net.
--
-- SAFETY
-- Additive in the sense the --allow-prod rule means, with one caveat stated plainly: it adds
-- a column and two functions and touches no existing policy, grant or row - but it also puts
-- a TRIGGER on `boards`, which changes the behaviour of writes that already happen. That is
-- the same reasoning that held 098 and 113 back. Treat it as NOT --allow-prod eligible and
-- decide it deliberately. It seeds no parent on any board, so every board stays a root and
-- nothing anyone can see changes on apply.

BEGIN;

CREATE TEMP TABLE _118_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.boards)                     AS board_rows,
  (SELECT count(*) FROM public.tasks)                      AS task_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

-- ---------------------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS parent_board_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boards_parent_board_id_fkey'
  ) THEN
    ALTER TABLE public.boards
      ADD CONSTRAINT boards_parent_board_id_fkey
      FOREIGN KEY (parent_board_id) REFERENCES public.boards(id) ON DELETE SET NULL;
  END IF;
END $$;

-- A board cannot be its own parent. The trigger below catches longer loops; this catches the
-- one-step case at the constraint level, where it cannot be reached at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boards_parent_not_self_check'
  ) THEN
    ALTER TABLE public.boards
      ADD CONSTRAINT boards_parent_not_self_check
      CHECK (parent_board_id IS NULL OR parent_board_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_boards_parent_board_id
  ON public.boards (parent_board_id) WHERE parent_board_id IS NOT NULL;

COMMENT ON COLUMN public.boards.parent_board_id IS
  'Optional parent board. NULL = a root board. Descendant membership is COMPUTED by walking '
  'this column (public.board_descendants), never stored as a list, so a new child board is in '
  'its ancestors'' roll-up views immediately. ON DELETE SET NULL: deleting a parent orphans its '
  'children to roots, it never destroys them.';

-- ---------------------------------------------------------------------------------------
-- Cycle guard
-- ---------------------------------------------------------------------------------------
-- SECURITY DEFINER so a loop routed through a board the caller cannot SELECT is still caught.
-- A cycle would make every descendant walk recurse forever, so this is a correctness guard,
-- not a nicety.
CREATE OR REPLACE FUNCTION private.enforce_board_hierarchy_acyclic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cursor UUID := NEW.parent_board_id;
  v_steps  INT  := 0;
BEGIN
  IF NEW.parent_board_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_board_id = NEW.id THEN
    RAISE EXCEPTION 'A board cannot be its own parent.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Walk UP from the proposed parent. If we arrive back at this board, the edge closes a loop.
  WHILE v_cursor IS NOT NULL LOOP
    v_steps := v_steps + 1;
    IF v_steps > 1000 THEN
      -- Report it rather than accepting the row: a truncated walk cannot prove there is no cycle.
      RAISE EXCEPTION
        'Board ancestry exceeded % steps while checking for a cycle. Refusing the change rather '
        'than accepting an edge that could not be verified.', 1000
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION
        'That would make the board hierarchy circular - the chosen parent already sits beneath '
        'this board.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT parent_board_id INTO v_cursor FROM public.boards WHERE id = v_cursor;
  END LOOP;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION private.enforce_board_hierarchy_acyclic() IS
  'Refuses a parent_board_id that would close a loop. SECURITY DEFINER so a cycle passing '
  'through a board the caller cannot read is still caught - same reasoning as 115''s relation '
  'cycle guard. Raises on an exhausted walk rather than accepting an unverified edge.';

DROP TRIGGER IF EXISTS enforce_board_hierarchy_acyclic ON public.boards;
CREATE TRIGGER enforce_board_hierarchy_acyclic
  BEFORE INSERT OR UPDATE OF parent_board_id, id ON public.boards
  FOR EACH ROW EXECUTE FUNCTION private.enforce_board_hierarchy_acyclic();

-- ⚠️ `id` is named alongside `parent_board_id` on purpose. 104's lesson: a trigger with an
-- `OF column` clause cannot police the columns it does not fire on. Re-keying a board while
-- leaving its parent alone is exactly the write that could close a loop without ever
-- mentioning parent_board_id.

-- ---------------------------------------------------------------------------------------
-- The walk, as a function anything can call
-- ---------------------------------------------------------------------------------------
-- SECURITY INVOKER, deliberately: RLS on `boards` is the authority over which boards are in
-- the caller's tree, and this must not widen it. See the privacy note in the header.
CREATE OR REPLACE FUNCTION public.board_descendants(
  p_board_id UUID,
  p_max_depth INT DEFAULT NULL
)
RETURNS TABLE (board_id UUID, depth INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE walk AS (
    SELECT b.id, 0 AS depth
    FROM public.boards b
    WHERE b.id = p_board_id

    UNION ALL

    SELECT b.id, w.depth + 1
    FROM public.boards b
    JOIN walk w ON b.parent_board_id = w.id
    WHERE p_max_depth IS NULL OR w.depth + 1 <= p_max_depth
  )
  SELECT id, depth FROM walk;
$$;

COMMENT ON FUNCTION public.board_descendants(UUID, INT) IS
  'The board and everything beneath it, as (board_id, depth) with depth 0 = the board itself. '
  'p_max_depth NULL = all descendants; 1 = direct children only. SECURITY INVOKER, so it '
  'returns exactly the boards the caller may SELECT - an unreadable child is absent, which is '
  'the correct answer rather than a leak.';

REVOKE ALL ON FUNCTION public.board_descendants(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.board_descendants(UUID, INT) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_boards   BIGINT;
  v_before_tasks    BIGINT;
  v_before_policies BIGINT;
  v_after           BIGINT;
  v_count           BIGINT;
  v_root            UUID;
  v_child           UUID;
BEGIN
  SELECT board_rows, task_rows, policy_rows
    INTO v_before_boards, v_before_tasks, v_before_policies FROM _118_precheck;

  SELECT count(*) INTO v_after FROM public.boards;
  IF v_after IS DISTINCT FROM v_before_boards THEN
    RAISE EXCEPTION 'boards row count changed during an additive migration (% -> %). Aborting.',
      v_before_boards, v_after;
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks;
  IF v_count IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed (% -> %). Aborting.', v_before_tasks, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies THEN
    RAISE EXCEPTION 'Policy count moved (% -> %) - an existing policy was touched. Aborting.',
      v_before_policies, v_count;
  END IF;

  -- Every board must still be a root: this migration seeds no hierarchy.
  SELECT count(*) INTO v_count FROM public.boards WHERE parent_board_id IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 boards with a parent after applying, found %. Aborting.', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_board_hierarchy_acyclic'
      AND tgrelid = 'public.boards'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The board hierarchy cycle guard is missing. Aborting.';
  END IF;

  -- "The guard exists" and "the guard refuses this" are different claims (117's lesson).
  -- Prove the refusal by trying it, inside a savepoint so the attempt leaves nothing behind.
  SELECT id INTO v_root FROM public.boards ORDER BY created_at LIMIT 1;
  IF v_root IS NOT NULL THEN
    SELECT id INTO v_child FROM public.boards WHERE id <> v_root ORDER BY created_at LIMIT 1;

    BEGIN
      UPDATE public.boards SET parent_board_id = id WHERE id = v_root;
      RAISE EXCEPTION 'A board was allowed to be its own parent. Aborting.';
    EXCEPTION WHEN check_violation THEN
      NULL;  -- refused, as intended
    END;

    IF v_child IS NOT NULL THEN
      -- Build root <- child, then try to close the loop by making root a child of child.
      BEGIN
        UPDATE public.boards SET parent_board_id = v_root WHERE id = v_child;

        BEGIN
          UPDATE public.boards SET parent_board_id = v_child WHERE id = v_root;
          RAISE EXCEPTION 'A two-board cycle was accepted. Aborting.';
        EXCEPTION WHEN check_violation THEN
          NULL;  -- refused, as intended
        END;

        -- And the walk must see the child while the edge is in place.
        SELECT count(*) INTO v_count FROM public.board_descendants(v_root, NULL);
        IF v_count < 2 THEN
          RAISE EXCEPTION 'board_descendants returned % rows for a parent with a child. Aborting.',
            v_count;
        END IF;

        SELECT count(*) INTO v_count FROM public.board_descendants(v_root, 0);
        IF v_count <> 1 THEN
          RAISE EXCEPTION 'board_descendants(depth 0) returned % rows, expected 1. Aborting.', v_count;
        END IF;
      END;

      -- Put it back: this migration seeds no hierarchy.
      UPDATE public.boards SET parent_board_id = NULL WHERE id = v_child;
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.boards WHERE parent_board_id IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'The verification left % board(s) parented. Aborting.', v_count;
  END IF;

  IF has_function_privilege('anon', 'public.board_descendants(uuid, int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute board_descendants. Aborting.';
  END IF;

  RAISE NOTICE '118 verified: % boards, all roots, cycle guard refuses self and 2-cycles.', v_after;
END $$;

COMMIT;
