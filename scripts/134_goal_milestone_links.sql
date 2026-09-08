-- 134: a goal may point at a milestone, which is the third column 129 said it would need.
--
-- WHY THIS EXISTS
-- Prompt I lists "related goal" among a milestone's fields, and 129 wrote down in advance
-- exactly how that would be done:
--
--   "Milestones are a third column the day milestones exist; there is no placeholder for
--    them, because a column nothing writes is a claim the product cannot keep."
--
-- 133 created the table, so this is that day. goal_links keeps two typed, foreign-keyed
-- columns rather than a polymorphic (entity_type, entity_id) pair, and gains a third of the
-- same kind. A uuid with no FK is a reference the database cannot police.
--
-- ⚠️ WHY THIS IS A SEPARATE FILE FROM 133, AND WHY THAT MATTERS
-- 133 is unambiguously additive: new tables only. This file changes a CONSTRAINT on an
-- EXISTING table, and CLAUDE.md names that class as "destructive until proven otherwise". So
-- it is split out, exactly as 125 was split from 127 - same feature, two different risks, and
-- only one of them needs an argument. Splitting them means the useful half ships without one.
--
-- THE PROOF, since "until proven otherwise" is an invitation to prove it:
--   1. The new predicate is strictly WEAKER than the old one. Every row satisfying
--      num_nonnulls(board_id, task_id) = 1 also satisfies
--      num_nonnulls(board_id, task_id, milestone_id) = 1, because milestone_id is NULL on
--      every row that exists when this runs - the column is created in the same statement.
--      There is no data value the old constraint accepted that the new one rejects.
--   2. No write path that already happens can reach the new branch. Nothing in the shipped
--      product sets milestone_id, because the column does not exist until this file runs.
--   3. The post-conditions below re-validate every existing row, assert the row count did not
--      move, and then TRY the shapes on both sides of the boundary rather than trusting them.
-- On that basis it is --allow-prod eligible. The owner is free to disagree with the reasoning;
-- what this header owes them is the reasoning, stated before the fact rather than after.
--
-- Rollback: scripts/rollback/134_revert.sql (drops the column and restores the old CHECK;
-- destroys any goal-to-milestone link, and nothing else).

BEGIN;

DROP TABLE IF EXISTS _134_precheck;
CREATE TEMP TABLE _134_precheck AS
SELECT
  (SELECT count(*) FROM public.goal_links) AS link_rows,
  (SELECT count(*) FROM public.goals)      AS goal_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

ALTER TABLE public.goal_links
  ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES public.milestones(id) ON DELETE CASCADE;

-- CASCADE, unlike the ON DELETE SET NULL that 130 gives a converted idea's pointers. The
-- difference is what the row means without its target: a converted idea is a durable fact
-- about something that happened, so it must survive; a goal-to-milestone link is a statement
-- about a milestone, and once the milestone is gone the link asserts nothing. Matches the
-- board_id and task_id ends of this same table.

ALTER TABLE public.goal_links DROP CONSTRAINT IF EXISTS goal_links_exactly_one_end;
ALTER TABLE public.goal_links
  ADD CONSTRAINT goal_links_exactly_one_end
  CHECK (num_nonnulls(board_id, task_id, milestone_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_links_milestone
  ON public.goal_links(goal_id, milestone_id) WHERE milestone_id IS NOT NULL;

COMMENT ON COLUMN public.goal_links.milestone_id IS
  'The third end 129 anticipated. Exactly one of board_id / task_id / milestone_id is set.';

-- ---------------------------------------------------------------------------------------
-- The policies have to learn about the third end, or a link to a milestone the caller cannot
-- see leaks its id through the join - 115's rule, applied by 129 to the first two ends.
-- These are REPLACEMENTS of 129's own policies on 129's own table, adding a term that is
-- vacuously true (milestone_id IS NULL) for every row that exists today.
-- ---------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Read goal links you can see both ends of" ON public.goal_links;
CREATE POLICY "Read goal links you can see both ends of" ON public.goal_links
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.goals g WHERE g.id = goal_links.goal_id)
    AND (
      board_id IS NULL
      OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = goal_links.board_id)
    )
    AND (
      task_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.tasks t
         WHERE t.id = goal_links.task_id
           AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
      )
    )
    AND (
      milestone_id IS NULL
      OR EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = goal_links.milestone_id)
    )
  );

DROP POLICY IF EXISTS "Admins and goal owners link work" ON public.goal_links;
CREATE POLICY "Admins and goal owners link work" ON public.goal_links
  FOR INSERT WITH CHECK (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.goals g
       WHERE g.id = goal_links.goal_id
         AND (private.is_admin_user() OR g.owner_id = auth.uid())
    )
    AND (
      board_id IS NULL
      OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = goal_links.board_id)
    )
    AND (
      task_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.tasks t
         WHERE t.id = goal_links.task_id
           AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
      )
    )
    AND (
      milestone_id IS NULL
      OR EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = goal_links.milestone_id)
    )
  );

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_links    BIGINT;
  v_before_goals    BIGINT;
  v_before_policies BIGINT;
  v_count           BIGINT;
  v_goal            UUID;
  v_board           UUID;
  v_ms              UUID;
BEGIN
  SELECT link_rows, goal_rows, policy_rows
    INTO v_before_links, v_before_goals, v_before_policies FROM _134_precheck;

  SELECT count(*) INTO v_count FROM public.goal_links;
  IF v_count IS DISTINCT FROM v_before_links THEN
    RAISE EXCEPTION 'goal_links row count changed (% -> %). Aborting.', v_before_links, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.goals;
  IF v_count IS DISTINCT FROM v_before_goals THEN
    RAISE EXCEPTION 'goals row count changed (% -> %). Aborting.', v_before_goals, v_count;
  END IF;

  -- Two policies were replaced, not added. If the count moved, one of 129's is gone.
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies THEN
    RAISE EXCEPTION 'Policy count changed (% -> %); this file replaces two and adds none. Aborting.',
      v_before_policies, v_count;
  END IF;

  -- Claim 1 from the header, checked: every pre-existing row still satisfies the constraint.
  -- ADD CONSTRAINT already validates, so reaching this line proves it, but an explicit count
  -- of rows that would fail says so in the log rather than by absence of an error.
  SELECT count(*) INTO v_count FROM public.goal_links
   WHERE num_nonnulls(board_id, task_id, milestone_id) <> 1;
  IF v_count <> 0 THEN
    RAISE EXCEPTION '% existing goal_links rows violate the widened constraint. Aborting.', v_count;
  END IF;

  -- Claim 2, checked: milestone_id really is NULL everywhere, so nothing that already ran
  -- could have written it.
  SELECT count(*) INTO v_count FROM public.goal_links WHERE milestone_id IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION '% goal_links rows already carry a milestone. Aborting.', v_count;
  END IF;

  -- And the boundary itself, tried rather than trusted: exactly one end, never two, never none.
  SELECT id INTO v_goal FROM public.goals LIMIT 1;
  SELECT id INTO v_board FROM public.boards LIMIT 1;

  IF v_goal IS NOT NULL AND v_board IS NOT NULL THEN
    INSERT INTO public.milestones (board_id, title, due_date)
    VALUES (v_board, '_134_probe', CURRENT_DATE) RETURNING id INTO v_ms;

    INSERT INTO public.goal_links (goal_id, milestone_id) VALUES (v_goal, v_ms);

    BEGIN
      INSERT INTO public.goal_links (goal_id, milestone_id, board_id) VALUES (v_goal, v_ms, v_board);
      RAISE EXCEPTION 'A goal link with two ends was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.goal_links (goal_id) VALUES (v_goal);
      RAISE EXCEPTION 'A goal link with no end was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Deleting the milestone must take the link with it and leave the goal alone.
    DELETE FROM public.milestones WHERE id = v_ms;
    IF EXISTS (SELECT 1 FROM public.goal_links WHERE milestone_id = v_ms) THEN
      RAISE EXCEPTION 'Deleting a milestone left its goal link behind. Aborting.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.goals WHERE id = v_goal) THEN
      RAISE EXCEPTION 'Deleting a milestone destroyed the goal. Aborting.';
    END IF;
  ELSE
    RAISE NOTICE '134: no goal or no board on this database, so the boundary probes were skipped.';
  END IF;

  SELECT count(*) INTO v_count FROM public.goal_links;
  IF v_count IS DISTINCT FROM v_before_links THEN
    RAISE EXCEPTION 'goal_links row count changed during the probes (% -> %). Aborting.',
      v_before_links, v_count;
  END IF;

  RAISE NOTICE
    '134 verified: goal_links has a third end, % existing rows revalidated and unchanged, '
    'two ends refused, no ends refused, milestone delete cascades the link only.',
    v_before_links;
END $$;

COMMIT;
