-- 135: tasks.start_date - the second end a timeline bar needs.
--
-- WHY THIS EXISTS
-- Measured against both databases before it was written: `tasks` has exactly one date a human
-- sets, `due_date`. A Gantt bar needs two ends, so without this column every bar on the
-- timeline is a one-day tick and the view answers no question the calendar does not already
-- answer. Prompt I's "first useful version" lists "resize duration", which is this column.
--
-- ⚠️ TIMESTAMPTZ, NOT DATE, AND THAT IS DELIBERATE DESPITE 123 SETTING THE OPPOSITE PRECEDENT.
-- CLAUDE.md is emphatic that sprints.start_date/end_date being real DATEs is what kept Prompt G
-- clear of the family of bugs tasks.due_date has produced five times. That reasoning is sound
-- and it does not apply here, for one reason: `due_date` is TIMESTAMPTZ and cannot be changed
-- without rewriting every live row (173 on prod, 117 on dev). A row whose two ends are different types is worse than
-- either consistent choice - every comparison between them needs a conversion, and the first
-- person to write `new Date(start_date)` reintroduces the bug from the other side.
--
-- So this column matches its sibling, and the existing discipline covers it: every write goes
-- through `dueDateForStorage` (which always yields YYYY-MM-DDT00:00:00.000Z) and every read
-- through `dueCalendarDate` (which takes the UTC date part). lib/timeline.ts normalises both
-- ends to a YYYY-MM-DD calendar day at the boundary, so no layout arithmetic ever touches an
-- instant. milestones.due_date (133) is a real DATE because that table is new and has no
-- sibling to match.
--
-- ⚠️ THE CHECK CONSTRAINT, AND WHY IT IS HERE RATHER THAN IN THE UI.
-- This adds a table constraint to `tasks`, the hottest table in the product, so it is worth
-- being explicit about the risk rather than letting `ADD COLUMN` carry it silently.
--   * What it can refuse: only a row that sets BOTH start_date and due_date with the start
--     after the due. It is NULL-tolerant on both sides, so it cannot refuse anything today.
--   * Its blast radius on existing writes is provably zero: the predicate names a column that
--     does not exist until this statement runs, so no shipped write path, import, automation
--     or trigger can produce a value it rejects. The post-conditions count the rows that would
--     fail (0 of 173) rather than asserting it.
--   * Why not leave it to the client: that is exactly the defect 104 had to fix, where
--     crm_statuses.requires_reason was honoured by one screen and by nothing underneath it. A
--     backwards range entering through psql or an import would then have to be defended
--     against by every timeline consumer forever.
--   * The post-conditions COUNT the rows that would fail rather than asserting none do, and
--     the count is reported in the NOTICE, so the claim is checked per database rather than
--     copied from whichever one it was first written against.
-- On that basis it is treated as --allow-prod eligible alongside the column. The owner is free
-- to disagree; what this header owes them is the argument, before the fact.
--
-- No GRANT is needed: `authenticated` holds table-wide INSERT/SELECT/UPDATE on `tasks`
-- (verified, not assumed), so a new column is writable by the same policies that already
-- govern the row. 101's column-grant trap is the opposite case and does not apply here.
--
-- Rollback: scripts/rollback/135_revert.sql (drops the column; destroys every start date).

BEGIN;

DROP TABLE IF EXISTS _135_precheck;
CREATE TEMP TABLE _135_precheck AS
SELECT
  (SELECT count(*) FROM public.tasks) AS task_rows,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal) AS task_triggers,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_start_before_due;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_start_before_due
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON public.tasks(start_date)
  WHERE start_date IS NOT NULL;

COMMENT ON COLUMN public.tasks.start_date IS
  'When the work is planned to begin. TIMESTAMPTZ to match due_date, always stored as UTC '
  'midnight via dueDateForStorage and always read as a calendar day via dueCalendarDate. NULL '
  'means unscheduled, which the timeline reports as its own state and never as "starts today".';

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks    BIGINT;
  v_before_ttrig    BIGINT;
  v_before_policies BIGINT;
  v_count           BIGINT;
  v_task            UUID;
  v_saved_start     TIMESTAMPTZ;
  v_saved_due       TIMESTAMPTZ;
BEGIN
  SELECT task_rows, task_triggers, policy_rows
    INTO v_before_tasks, v_before_ttrig, v_before_policies FROM _135_precheck;

  SELECT count(*) INTO v_count FROM public.tasks;
  IF v_count IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed (% -> %). Aborting.', v_before_tasks, v_count;
  END IF;

  -- The header's central claim, counted rather than reasoned about.
  SELECT count(*) INTO v_count FROM public.tasks
   WHERE start_date IS NOT NULL AND due_date IS NOT NULL AND start_date > due_date;
  IF v_count <> 0 THEN
    RAISE EXCEPTION '% existing tasks violate the new constraint. Aborting.', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks WHERE start_date IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      '% tasks already carry a start date, so this migration is not the no-op it claims to be. '
      'Aborting.', v_count;
  END IF;

  -- No trigger and no policy was added. This file must change nothing about how a task write
  -- is authorised - only what values one may hold.
  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal;
  IF v_count IS DISTINCT FROM v_before_ttrig THEN
    RAISE EXCEPTION 'Trigger count on tasks changed (% -> %). Aborting.', v_before_ttrig, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies THEN
    RAISE EXCEPTION 'Policy count changed (% -> %). Aborting.', v_before_policies, v_count;
  END IF;

  -- "The constraint exists" and "the constraint refuses this" are different claims (117).
  SELECT id, start_date, due_date INTO v_task, v_saved_start, v_saved_due
  FROM public.tasks WHERE deleted_at IS NULL LIMIT 1;

  IF v_task IS NOT NULL THEN
    BEGIN
      UPDATE public.tasks
         SET start_date = '2026-03-10T00:00:00Z', due_date = '2026-03-01T00:00:00Z'
       WHERE id = v_task;
      RAISE EXCEPTION 'A start date after its due date was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And the generous side must be accepted, or the guard is refusing everything: a range,
    -- a single day, and both NULL-tolerant halves.
    UPDATE public.tasks
       SET start_date = '2026-03-01T00:00:00Z', due_date = '2026-03-10T00:00:00Z'
     WHERE id = v_task;
    UPDATE public.tasks
       SET start_date = '2026-03-10T00:00:00Z', due_date = '2026-03-10T00:00:00Z'
     WHERE id = v_task;
    UPDATE public.tasks SET due_date = NULL WHERE id = v_task;
    UPDATE public.tasks SET start_date = NULL WHERE id = v_task;

    UPDATE public.tasks SET start_date = v_saved_start, due_date = v_saved_due WHERE id = v_task;

    IF EXISTS (
      SELECT 1 FROM public.tasks
      WHERE id = v_task
        AND (start_date IS DISTINCT FROM v_saved_start OR due_date IS DISTINCT FROM v_saved_due)
    ) THEN
      RAISE EXCEPTION 'The probe did not restore the task it borrowed. Aborting.';
    END IF;
  ELSE
    RAISE NOTICE '135: no task on this database, so the constraint probes were skipped.';
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks WHERE start_date IS NOT NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'The probes left % start dates behind. Aborting.', v_count;
  END IF;

  RAISE NOTICE
    '135 verified: tasks.start_date on % rows, all NULL, backwards range refused, forwards '
    'and equal and NULL ranges accepted, 0 triggers and 0 policies added.', v_before_tasks;
END $$;

COMMIT;
