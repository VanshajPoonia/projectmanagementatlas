-- Revert 134 (goal links may point at a milestone).
--
-- ⚠️ THIS DESTROYS DATA - every link between a goal and a milestone. Goals, milestones and
-- links to boards or tasks are all untouched. Dump first if it matters:
--
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only -t public.goal_links -Fc -f goal_links.dump
--
-- ⚠️ ORDER: run this BEFORE 133_revert.sql. The column dropped here carries the foreign key
-- onto public.milestones, so reverting 133 first fails with "cannot drop table ... because
-- other objects depend on it" and aborts.
--
-- This restores 129's exact two-end constraint and its two policies. It is written to be
-- runnable whether or not any milestone link exists: the DELETE below is what makes the
-- narrower CHECK re-validate, and without it the ADD CONSTRAINT would abort on the first row
-- carrying a milestone.

BEGIN;

DELETE FROM public.goal_links WHERE milestone_id IS NOT NULL;

DROP INDEX IF EXISTS idx_goal_links_milestone;

-- ⚠️ THE POLICIES COME DOWN FIRST, AND THIS ORDER IS NOT COSMETIC. Both of 134's policies
-- name milestone_id, so Postgres refuses to drop the column while they exist:
--   "cannot drop column milestone_id ... because other objects depend on it"
-- and that aborts the whole transaction. Found by RUNNING this script rather than reading it,
-- which is the lesson 132's own revert had to learn the same way.
DROP POLICY IF EXISTS "Read goal links you can see both ends of" ON public.goal_links;
DROP POLICY IF EXISTS "Admins and goal owners link work" ON public.goal_links;

ALTER TABLE public.goal_links DROP CONSTRAINT IF EXISTS goal_links_exactly_one_end;
ALTER TABLE public.goal_links DROP COLUMN IF EXISTS milestone_id;
ALTER TABLE public.goal_links
  ADD CONSTRAINT goal_links_exactly_one_end
  CHECK (num_nonnulls(board_id, task_id) = 1);

-- Now 129's originals go back on.
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
  );

DELETE FROM public.applied_migrations WHERE filename = '134_goal_milestone_links.sql';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'goal_links' AND column_name = 'milestone_id'
  ) THEN
    RAISE EXCEPTION 'goal_links.milestone_id survived the revert. Aborting.';
  END IF;
  RAISE NOTICE '134 reverted: goal_links is back to two ends.';
END $$;

COMMIT;
