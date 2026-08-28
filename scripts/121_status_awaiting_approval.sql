-- 121: let a status declare that work sitting in it is waiting on somebody else's approval.
--
-- WHY THIS EXISTS
-- "What is waiting on my approval / on someone else's?" is one of the five questions My Work
-- is supposed to answer, and it has been named on screen as an unanswerable gap since the page
-- shipped, on the grounds that it "needs an approvals module". That was true when the only
-- thing a status carried was a label. It stopped being true at 112, which gave every status a
-- normalized `category` and made the catalog the place where a status's MEANING lives.
--
-- Approval is not a sixth category, deliberately. The five categories
-- (backlog|planned|started|completed|cancelled) answer "how far along is this", and work
-- awaiting sign-off has genuinely started - that is why production's `pending_approval` was
-- corrected to `started` by hand on 2026-08-23 rather than left in the to-do bucket. Whether
-- something is waiting on a person is an ORTHOGONAL fact about the same status, so it gets its
-- own boolean instead of being crammed into an axis that already means something else.
--
-- WHAT IT IS NOT
-- This is not an approvals module. There is no approver, no request, no decision record and no
-- audit of who signed off - and nothing here pretends otherwise. It answers exactly one
-- question, "is this item parked waiting on a human", which is the question that changes what
-- a person should work on next: you cannot push work that is not yours to push. When a real
-- approvals module lands it will have its own tables and this flag will still be the honest
-- answer for the boards that only ever used a status.
--
-- THE ONE ROW THIS SEEDS, AND WHY IT IS NAMED
-- Production carries a fifth status, key `pending_approval`, that dev does not have. It is
-- seeded to is_approval = true by exact key match - not by a substring heuristic over labels,
-- which is precisely the "it worked by coincidence" trap 112 was written to end. On dev this
-- matches nothing and seeds zero rows. The post-conditions report the count.
--
-- To undo just that classification without reverting the migration:
--   UPDATE public.task_statuses SET is_approval = false WHERE key = 'pending_approval';
--
-- Nothing about the task changes: it keeps its status, its category, its column and its
-- position. The only difference is that its assignee sees it grouped under "Waiting on
-- approval" in My Work instead of only under its due date, and that WorkNext stops ranking it
-- as something they can act on today.
--
-- SAFETY
-- Additive: one nullable-with-default column on task_statuses, plus one UPDATE that touches at
-- most one row and changes no existing column. No policy, grant, trigger or constraint on any
-- existing object is touched, so this is --allow-prod eligible on this repo's own rule.
-- task_statuses is super-admin-writable (069) and the new column inherits exactly that.
-- Rollback: scripts/rollback/121_revert.sql.

BEGIN;

CREATE TEMP TABLE _121_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.task_statuses)                          AS status_rows,
  (SELECT count(*) FROM public.tasks)                                  AS task_rows,
  (SELECT count(*) FROM public.task_statuses WHERE is_archived = false) AS active_rows,
  (SELECT string_agg(key || ':' || category, ',' ORDER BY key) FROM public.task_statuses) AS categories;

ALTER TABLE public.task_statuses
  ADD COLUMN IF NOT EXISTS is_approval BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.task_statuses.is_approval IS
  'Work in this status is parked waiting on a person to approve or sign off. Orthogonal to '
  'category: an item awaiting approval has usually started. Read by My Work''s "Waiting on '
  'approval" section and by WorkNext, which stops recommending work its owner cannot push.';

-- The one named seed. Exact key, never a label heuristic.
UPDATE public.task_statuses
   SET is_approval = true
 WHERE key = 'pending_approval'
   AND is_approval = false;

-- ---------------------------------------------------------------------------------------
-- Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_statuses  BIGINT;
  v_before_tasks     BIGINT;
  v_before_active    BIGINT;
  v_before_categories TEXT;
  v_seeded           BIGINT;
BEGIN
  SELECT status_rows, task_rows, active_rows, categories
    INTO v_before_statuses, v_before_tasks, v_before_active, v_before_categories
  FROM _121_precheck;

  IF (SELECT count(*) FROM public.task_statuses) <> v_before_statuses THEN
    RAISE EXCEPTION 'Status row count moved. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.tasks) <> v_before_tasks THEN
    RAISE EXCEPTION 'Task row count moved. Aborting.';
  END IF;
  IF (SELECT count(*) FROM public.task_statuses WHERE is_archived = false) <> v_before_active THEN
    RAISE EXCEPTION 'A status was archived or unarchived. Aborting.';
  END IF;

  -- 112's categories decide what counts as open, done and cancelled everywhere in the app.
  -- This migration must not move a single one of them.
  IF (SELECT string_agg(key || ':' || category, ',' ORDER BY key) FROM public.task_statuses)
     IS DISTINCT FROM v_before_categories THEN
    RAISE EXCEPTION 'A status category changed. This migration must not reclassify anything. Aborting.';
  END IF;

  SELECT count(*) INTO v_seeded FROM public.task_statuses WHERE is_approval;
  IF v_seeded > 1 THEN
    RAISE EXCEPTION 'Expected at most one seeded approval status, found %. Aborting.', v_seeded;
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_statuses WHERE is_approval AND key <> 'pending_approval') THEN
    RAISE EXCEPTION 'A status other than pending_approval was flagged. Aborting.';
  END IF;

  -- The column must be writable by exactly the people who already manage the catalog - that
  -- is, nobody new. task_statuses is super-admin-only (069), and adding a column must not
  -- have created a second, wider way in.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'task_statuses' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on task_statuses. Aborting.';
  END IF;

  RAISE NOTICE '121 verified: task_statuses.is_approval added, % status(es) seeded, % categories unchanged.',
    v_seeded, v_before_statuses;
END $$;

COMMIT;
