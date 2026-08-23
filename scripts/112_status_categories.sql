-- 112: give a status a normalized CATEGORY, so nothing has to guess from its name.
--
-- WHAT IS WRONG
-- 063 made columns.status_key the source of truth for *which* status a task holds, and that
-- fixed the "WIP column silently classifies as To Do" bug at the column level. It did not fix
-- the layer above it. lib/task-status.ts still decides what a status *means* like this:
--
--     function bucketFromText(value: string) {
--       if (value.includes('done') || value.includes('complete') || value.includes('cancel'))
--         return 'done'
--       if (value.includes('progress') || value.includes('going')) return 'in_progress'
--       return 'to_do'
--     }
--
-- and the FK path calls it with the key: `bucketFromText(task.column.status_key)`. So the FK
-- reliably answers "which status", and then a substring match answers "is that open or done".
-- Every consumer of that answer - overdue math, the reports view, My Work, the AI assistant,
-- subtask progress counts - inherits the guess.
--
-- Today it happens to be right, because the four seeded keys are to_do / in_progress / done /
-- cancelled and each contains a substring the function looks for. It is right by coincidence.
-- task_statuses is admin-managed: a super admin can add a status this minute, and the moment
-- one is called `review`, `blocked`, `wip`, `qa` or `waiting`, it falls through every branch
-- and is silently counted as To Do. Nothing errors. A blocked task is reported as not started.
--
-- THE FIX
-- Put the meaning in the table, where the person creating the status states it, instead of
-- inferring it from the letters of the key. Five normalized categories, the vocabulary the
-- plan already specifies:
--
--     backlog | planned | started | completed | cancelled
--
-- These are deliberately NOT the same as the three coarse buckets the app renders
-- (to_do / in_progress / done). The categories are the durable domain fact; the buckets are a
-- presentation collapse of them, and lib/task-status.ts owns that collapse in one place.
-- Keeping them separate is what lets a future Backlog status be distinguishable from To Do
-- without touching any consumer.
--
-- is_closed is a GENERATED column rather than a plain boolean. "Open vs closed" is not an
-- independent fact - it is a function of the category - and a writable column that restates a
-- derived fact is a column that can be set to disagree with it. Postgres computes it here, so
-- it cannot drift.
--
-- WHY NOT ALSO DELETE THE STRING MATCHING
-- The fallback in lib/task-status.ts stays, for the same reason 063 kept its own: a task's raw
-- `status` TEXT column is still written alongside column_id (see lib/task-mutations.ts), and a
-- caller that has a bare status string and no catalog to resolve it against still needs an
-- answer. What changes is the order - the category is consulted first and always wins, so the
-- heuristic only ever runs where there is genuinely nothing better. It is now the last resort
-- rather than the primary path.
--
-- SAFETY
-- Additive: two new columns plus one generated column on task_statuses, no policy, grant,
-- trigger or existing column touched, and no row's existing values altered. The backfill only
-- populates the new column. Post-conditions below assert every status ends up categorised, the
-- four seeded keys land on the categories the app currently assumes, and no row appeared or
-- vanished. Rollback: scripts/rollback/112_revert.sql (drops the three columns; destroys the
-- categorisation but no task data).

BEGIN;

CREATE TEMP TABLE _112_precheck ON COMMIT DROP AS
SELECT count(*) AS status_rows FROM public.task_statuses;

-- Nullable first, so the backfill decides every value rather than a DEFAULT deciding for the
-- rows that already exist. NOT NULL is asserted at the end, once nothing is left unset.
ALTER TABLE public.task_statuses
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT;

-- The four keys this workspace actually runs on. Matched on the exact key, never a substring -
-- the whole point of this migration is that substring matching is what we are retiring.
UPDATE public.task_statuses SET category = 'planned'   WHERE key = 'to_do'       AND category IS NULL;
UPDATE public.task_statuses SET category = 'started'   WHERE key = 'in_progress' AND category IS NULL;
UPDATE public.task_statuses SET category = 'completed' WHERE key = 'done'        AND category IS NULL;
UPDATE public.task_statuses SET category = 'cancelled' WHERE key = 'cancelled'   AND category IS NULL;

-- Anything else that exists (none on dev or prod as of writing, but this must not depend on
-- that) lands on 'planned' - the same bucket the old heuristic's `return 'to_do'` fallthrough
-- gave it. Deliberately identical to today's behaviour, so this migration changes no
-- classification anywhere; it only makes the classification explicit and editable.
UPDATE public.task_statuses SET category = 'planned' WHERE category IS NULL;

ALTER TABLE public.task_statuses
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN category SET DEFAULT 'planned';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_statuses'::regclass AND conname = 'task_statuses_category_check'
  ) THEN
    ALTER TABLE public.task_statuses
      ADD CONSTRAINT task_statuses_category_check
      CHECK (category IN ('backlog', 'planned', 'started', 'completed', 'cancelled'));
  END IF;
END $$;

-- Derived, never written. See the header.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_statuses' AND column_name = 'is_closed'
  ) THEN
    ALTER TABLE public.task_statuses
      ADD COLUMN is_closed BOOLEAN
      GENERATED ALWAYS AS (category IN ('completed', 'cancelled')) STORED;
  END IF;
END $$;

COMMENT ON COLUMN public.task_statuses.category IS
  'Normalized meaning of this status: backlog|planned|started|completed|cancelled. This is the '
  'source of truth for open/closed and progress math - never infer it from key or label.';
COMMENT ON COLUMN public.task_statuses.is_closed IS
  'Generated from category. A closed status is completed or cancelled - work has left the pipeline.';
COMMENT ON COLUMN public.task_statuses.icon IS
  'Optional lucide-react icon name for this status. NULL means the consumer picks by category.';

-- ---------------------------------------------------------------------------------------
-- Post-conditions. Anything failing here rolls the whole migration back.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before BIGINT;
  v_after  BIGINT;
  v_bad    BIGINT;
  v_cat    TEXT;
BEGIN
  SELECT status_rows INTO v_before FROM _112_precheck;

  SELECT count(*) INTO v_after FROM public.task_statuses;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'task_statuses row count changed during an additive migration (% -> %). Aborting.',
      v_before, v_after;
  END IF;

  SELECT count(*) INTO v_bad FROM public.task_statuses WHERE category IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% status row(s) left uncategorised. Aborting.', v_bad;
  END IF;

  -- The four keys every consumer currently assumes. If one of these is wrong, the app's
  -- overdue and completion math changes silently, which is precisely what must not happen.
  FOR v_cat IN
    SELECT format('%s=%s', key, category) FROM public.task_statuses
    WHERE (key = 'to_do'       AND category <> 'planned')
       OR (key = 'in_progress' AND category <> 'started')
       OR (key = 'done'        AND category <> 'completed')
       OR (key = 'cancelled'   AND category <> 'cancelled')
  LOOP
    RAISE EXCEPTION 'Seeded status categorised wrongly: %. Aborting.', v_cat;
  END LOOP;

  -- is_closed must agree with category for every row, or the generated expression is wrong.
  SELECT count(*) INTO v_bad FROM public.task_statuses
  WHERE is_closed IS DISTINCT FROM (category IN ('completed', 'cancelled'));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'is_closed disagrees with category on % row(s). Aborting.', v_bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.task_statuses'::regclass AND conname = 'task_statuses_category_check'
  ) THEN
    RAISE EXCEPTION 'task_statuses_category_check is missing - an arbitrary category could be stored. Aborting.';
  END IF;

  -- RLS must still be on, and the policy set untouched: this migration adds columns only.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.task_statuses'::regclass) THEN
    RAISE EXCEPTION 'RLS is no longer enabled on task_statuses. Aborting.';
  END IF;

  SELECT count(*) INTO v_bad FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'task_statuses';
  IF v_bad <> 2 THEN
    RAISE EXCEPTION 'Expected 2 policies on task_statuses, found %. Aborting.', v_bad;
  END IF;

  RAISE NOTICE '112 verified: % statuses categorised, is_closed generated, policies untouched.', v_after;
END $$;

COMMIT;
