-- 124: sprint metrics that cannot silently change - a frozen end-of-sprint snapshot and an
--      append-only daily burndown/burn-up sample.
--
-- WHY THIS EXISTS
-- Prompt G names seven metrics (committed, completed, carryover, scope added/removed,
-- burndown, burn-up, velocity) and then states the requirement that decides the whole design:
--
--   "Historical sprint data must not silently change when current project structure changes."
--
-- Every one of those numbers is derived from data that keeps moving after the sprint ends. A
-- task gets re-estimated. A status is re-categorised (112 did exactly that to production's
-- `pending_approval`, and the plan says it may happen again). A board is reorganised, a column
-- deleted, a task archived. Recomputing "what did we deliver in June" from today's rows
-- therefore returns a different answer every month, with nothing on screen admitting it - and
-- a velocity average built on top of that is worse than no velocity at all, because people
-- plan against it.
--
-- So: while a sprint is running, its numbers are computed live from current data and labelled
-- as live. The moment it closes, a trigger writes a snapshot, and every consumer reads the
-- snapshot from then on. The snapshot records not just the totals but WHICH task ids were
-- counted and HOW MANY were excluded for having no estimate - Prompt G requires every chart to
-- expose "included records / excluded records", and a burndown that silently reads an
-- unestimated task as zero is the most common way that promise is broken.
--
-- WHY THE TABLES ARE NOT APPLICATION-WRITABLE
-- `authenticated` holds SELECT and nothing else on both, mirroring crm_order_status_history
-- (103) and recurrence_occurrences (116). A ledger the application can write is a ledger that
-- can be made to disagree with what happened, and every guarantee above rests on it being
-- accurate. Rows arrive only from the trigger on `sprints` and from the definer function
-- below, both of which run as the table owner.
--
-- IDEMPOTENCY
-- UNIQUE (sprint_id, on_date). A retried cron run, two browsers open at once, or a manual
-- refresh cannot produce two points for one day. TODAY's point may be refreshed - it is still
-- being lived - but a point for a PAST date is never rewritten, which is the whole rule above
-- expressed at the row level.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: two NEW tables, two new functions, one trigger on `sprints` (a table 123 itself
-- created, so no pre-existing write path changes behaviour). Nothing that existed before 123
-- is touched. Seeds nothing - there are no closed sprints to snapshot. --allow-prod eligible,
-- and it must be applied AFTER 123.
-- Rollback: scripts/rollback/124_revert.sql (destroys the recorded history).

BEGIN;

CREATE TEMP TABLE _124_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)        AS task_rows,
  (SELECT count(*) FROM public.sprints)      AS sprint_rows,
  (SELECT count(*) FROM public.sprint_items) AS item_rows;

-- ---------------------------------------------------------------------------------------
-- 1. The frozen snapshot. One row per sprint, written once, when it closes.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sprint_metrics (
  sprint_id   UUID PRIMARY KEY REFERENCES public.sprints(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The sprint's own closing state, so a cancelled sprint is never averaged into velocity as
  -- if it had been delivered.
  final_state TEXT NOT NULL CHECK (final_state IN ('completed', 'cancelled')),

  -- The vocabulary AT THE TIME. A board that later switches from points to hours must not
  -- retroactively relabel numbers that were counted in points.
  estimate_unit TEXT NOT NULL,
  terminology   TEXT NOT NULL,

  committed_count    INTEGER NOT NULL DEFAULT 0,
  committed_estimate NUMERIC(12, 2) NOT NULL DEFAULT 0,
  completed_count    INTEGER NOT NULL DEFAULT 0,
  completed_estimate NUMERIC(12, 2) NOT NULL DEFAULT 0,
  carryover_count    INTEGER NOT NULL DEFAULT 0,
  carryover_estimate NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cancelled_count    INTEGER NOT NULL DEFAULT 0,
  added_count        INTEGER NOT NULL DEFAULT 0,
  added_estimate     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  removed_count      INTEGER NOT NULL DEFAULT 0,
  removed_estimate   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  final_count        INTEGER NOT NULL DEFAULT 0,
  final_estimate     NUMERIC(12, 2) NOT NULL DEFAULT 0,

  -- Prompt G: "included records / excluded records". Both are stored rather than described,
  -- so the chart's footnote is a fact and not a claim.
  included_task_ids  UUID[] NOT NULL DEFAULT '{}',
  unestimated_count  INTEGER NOT NULL DEFAULT 0,
  capacity           NUMERIC(10, 2)
);

COMMENT ON TABLE public.sprint_metrics IS
  'Frozen end-of-sprint numbers, written once by a trigger when the sprint closes and never '
  'recomputed. Exists because re-estimating a task, re-categorising a status or reorganising '
  'a board would otherwise silently change what a finished sprint claims to have delivered.';

COMMENT ON COLUMN public.sprint_metrics.unestimated_count IS
  'Members carrying no estimate at close. They are counted in every *_count and contribute '
  'ZERO to every *_estimate - the number that makes a burndown honest instead of flattering.';

-- ---------------------------------------------------------------------------------------
-- 2. The daily sample. Burndown (remaining) and burn-up (completed vs scope) from one row.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sprint_burndown_samples (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id UUID NOT NULL REFERENCES public.sprints(id) ON DELETE CASCADE,
  -- ⚠️ A calendar DATE in the business zone, never an instant. See CLAUDE.md's due_date
  -- section: resolving a stored day through a timezone is this repo's most-repeated bug.
  on_date   DATE NOT NULL,
  remaining_count    INTEGER NOT NULL,
  remaining_estimate NUMERIC(12, 2) NOT NULL,
  completed_count    INTEGER NOT NULL,
  completed_estimate NUMERIC(12, 2) NOT NULL,
  -- Scope = everything in the sprint on that day. Burn-up needs it as its own series, because
  -- a flat completed line under a rising scope line is a different story from one under a
  -- flat scope line, and a burndown alone cannot tell them apart.
  scope_count        INTEGER NOT NULL,
  scope_estimate     NUMERIC(12, 2) NOT NULL,
  unestimated_count  INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sprint_burndown_samples_one_per_day UNIQUE (sprint_id, on_date)
);

CREATE INDEX IF NOT EXISTS idx_sprint_burndown_sprint
  ON public.sprint_burndown_samples(sprint_id, on_date);

COMMENT ON TABLE public.sprint_burndown_samples IS
  'One point per sprint per day. Appended, never rewritten except for today, so the shape of '
  'a finished burndown is a record of what was true each day rather than a redrawing of it.';

-- ---------------------------------------------------------------------------------------
-- 3. Grants. Read-only for every client role; the wide Supabase default is revoked first.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.sprint_metrics           FROM anon, authenticated;
REVOKE ALL ON public.sprint_burndown_samples  FROM anon, authenticated;
GRANT SELECT ON public.sprint_metrics          TO authenticated;
GRANT SELECT ON public.sprint_burndown_samples TO authenticated;

ALTER TABLE public.sprint_metrics          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprint_burndown_samples ENABLE ROW LEVEL SECURITY;

-- Visible exactly when the sprint is - read through the caller's own sprints policy, which is
-- itself read through their own boards policy. No admin bypass and no definer shortcut: a
-- private board's velocity is as private as its work.
DROP POLICY IF EXISTS "Read metrics for sprints you can see" ON public.sprint_metrics;
CREATE POLICY "Read metrics for sprints you can see" ON public.sprint_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sprints s WHERE s.id = sprint_metrics.sprint_id)
  );

DROP POLICY IF EXISTS "Read burndown for sprints you can see" ON public.sprint_burndown_samples;
CREATE POLICY "Read burndown for sprints you can see" ON public.sprint_burndown_samples
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sprints s WHERE s.id = sprint_burndown_samples.sprint_id)
  );

-- ---------------------------------------------------------------------------------------
-- 4. The snapshot trigger.
--
-- AFTER UPDATE, not BEFORE: 123's own BEFORE trigger is still deciding the row's final state
-- and stamping closed_at when a BEFORE trigger would run, and the snapshot must describe the
-- sprint as it ended, not as it was being changed.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.capture_sprint_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit  TEXT;
  v_term  TEXT;
BEGIN
  IF NEW.state NOT IN ('completed', 'cancelled') THEN RETURN NEW; END IF;
  IF OLD.state IN ('completed', 'cancelled') THEN RETURN NEW; END IF;

  SELECT COALESCE(bas.estimate_unit, 'points'), COALESCE(bas.terminology, 'sprint')
    INTO v_unit, v_term
    FROM public.boards b
    LEFT JOIN public.board_agile_settings bas ON bas.board_id = b.id
   WHERE b.id = NEW.board_id;

  INSERT INTO public.sprint_metrics AS m (
    sprint_id, final_state, estimate_unit, terminology,
    committed_count, committed_estimate,
    completed_count, completed_estimate,
    carryover_count, carryover_estimate,
    cancelled_count,
    added_count, added_estimate,
    removed_count, removed_estimate,
    final_count, final_estimate,
    included_task_ids, unestimated_count, capacity
  )
  SELECT
    NEW.id, NEW.state, COALESCE(v_unit, 'points'), COALESCE(v_term, 'sprint'),
    -- Committed: stamped by 123 at activation. A sprint closed without ever being activated
    -- has no commitment, which is the honest answer rather than zero-by-coincidence.
    count(*) FILTER (WHERE si.committed),
    COALESCE(sum(si.estimate_at_commit) FILTER (WHERE si.committed), 0),
    -- Completed / carryover / cancelled are read through task_statuses.category (112), never
    -- through a column title or a substring of a status key.
    count(*) FILTER (WHERE si.removed_at IS NULL AND ts.category = 'completed'),
    COALESCE(sum(t.estimate_value) FILTER (WHERE si.removed_at IS NULL AND ts.category = 'completed'), 0),
    count(*) FILTER (WHERE si.removed_at IS NULL AND COALESCE(ts.is_closed, false) = false),
    COALESCE(sum(t.estimate_value) FILTER (WHERE si.removed_at IS NULL AND COALESCE(ts.is_closed, false) = false), 0),
    count(*) FILTER (WHERE si.removed_at IS NULL AND ts.category = 'cancelled'),
    count(*) FILTER (WHERE si.removed_at IS NULL AND NOT si.committed),
    COALESCE(sum(t.estimate_value) FILTER (WHERE si.removed_at IS NULL AND NOT si.committed), 0),
    count(*) FILTER (WHERE si.removed_at IS NOT NULL),
    COALESCE(sum(si.estimate_at_commit) FILTER (WHERE si.removed_at IS NOT NULL), 0),
    count(*) FILTER (WHERE si.removed_at IS NULL),
    COALESCE(sum(t.estimate_value) FILTER (WHERE si.removed_at IS NULL), 0),
    COALESCE(array_agg(si.task_id) FILTER (WHERE si.removed_at IS NULL), '{}'),
    count(*) FILTER (WHERE si.removed_at IS NULL AND t.estimate_value IS NULL),
    NEW.capacity
  FROM public.sprint_items si
  JOIN public.tasks t ON t.id = si.task_id
  LEFT JOIN public.columns c ON c.id = t.column_id
  LEFT JOIN public.task_statuses ts ON ts.key = COALESCE(c.status_key, t.status)
  WHERE si.sprint_id = NEW.id
  -- ⚠️ An aggregate SELECT with no GROUP BY returns ONE row even over zero members, so a
  -- sprint that closed empty still gets a row of zeros rather than no row at all. That is
  -- deliberate: "we never recorded this sprint" and "this sprint delivered nothing" must be
  -- distinguishable on screen, and a missing row reads as the first.
  ON CONFLICT (sprint_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_sprint_metrics() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS capture_sprint_metrics ON public.sprints;
CREATE TRIGGER capture_sprint_metrics
  AFTER UPDATE ON public.sprints
  FOR EACH ROW EXECUTE FUNCTION private.capture_sprint_metrics();

-- ---------------------------------------------------------------------------------------
-- 5. Sampling. SECURITY DEFINER because the tables are read-only to every client role.
--
-- Gated on private.can_view_board, so it cannot be used to discover that a private board has
-- a sprint. The caller chooses the sprint and nothing else - no date parameter, so nobody can
-- backfill a flattering point for a day that has passed.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sample_sprint_burndown(p_sprint_id UUID)
RETURNS public.sprint_burndown_samples
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board UUID;
  v_state TEXT;
  v_today DATE;
  v_row   public.sprint_burndown_samples;
BEGIN
  SELECT s.board_id, s.state INTO v_board, v_state FROM public.sprints s WHERE s.id = p_sprint_id;
  IF v_board IS NULL THEN
    RAISE EXCEPTION 'Sprint not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT private.can_view_board(v_board) THEN
    RAISE EXCEPTION 'You cannot see this board.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A closed sprint's curve is finished. Sampling it again would add a point after the fact.
  IF v_state <> 'active' THEN
    SELECT * INTO v_row FROM public.sprint_burndown_samples
     WHERE sprint_id = p_sprint_id ORDER BY on_date DESC LIMIT 1;
    RETURN v_row;
  END IF;

  v_today := (now() AT TIME ZONE 'America/Chicago')::date;

  INSERT INTO public.sprint_burndown_samples AS b (
    sprint_id, on_date,
    remaining_count, remaining_estimate,
    completed_count, completed_estimate,
    scope_count, scope_estimate, unestimated_count
  )
  SELECT
    p_sprint_id, v_today,
    count(*) FILTER (WHERE COALESCE(ts.is_closed, false) = false),
    COALESCE(sum(t.estimate_value) FILTER (WHERE COALESCE(ts.is_closed, false) = false), 0),
    count(*) FILTER (WHERE ts.category = 'completed'),
    COALESCE(sum(t.estimate_value) FILTER (WHERE ts.category = 'completed'), 0),
    count(*),
    COALESCE(sum(t.estimate_value), 0),
    count(*) FILTER (WHERE t.estimate_value IS NULL)
  FROM public.sprint_items si
  JOIN public.tasks t ON t.id = si.task_id
  LEFT JOIN public.columns c ON c.id = t.column_id
  LEFT JOIN public.task_statuses ts ON ts.key = COALESCE(c.status_key, t.status)
  WHERE si.sprint_id = p_sprint_id AND si.removed_at IS NULL
  -- TODAY is still being lived, so its point tracks. Yesterday's never moves again.
  ON CONFLICT (sprint_id, on_date) DO UPDATE SET
    remaining_count = EXCLUDED.remaining_count,
    remaining_estimate = EXCLUDED.remaining_estimate,
    completed_count = EXCLUDED.completed_count,
    completed_estimate = EXCLUDED.completed_estimate,
    scope_count = EXCLUDED.scope_count,
    scope_estimate = EXCLUDED.scope_estimate,
    unestimated_count = EXCLUDED.unestimated_count,
    captured_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ⚠️ `postgres` carries a DEFAULT ACL granting EXECUTE on every new function in public to
-- `authenticated` (117's lesson - REVOKE ... FROM PUBLIC does NOT make a function private in
-- this database). State the grants explicitly and assert them below.
REVOKE ALL ON FUNCTION public.sample_sprint_burndown(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_sprint_burndown(UUID) TO authenticated;

/**
 * The nightly sweep. Service role only - it walks every active sprint on every board,
 * including boards the caller could never see, which is exactly why no client role may
 * call it. Mirrors deliver_due_reminders (117).
 */
CREATE OR REPLACE FUNCTION public.sample_all_active_sprints()
RETURNS TABLE (sprint_id UUID, sampled BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'America/Chicago')::date;
  r RECORD;
BEGIN
  FOR r IN SELECT s.id FROM public.sprints s WHERE s.state = 'active' LOOP
    INSERT INTO public.sprint_burndown_samples (
      sprint_id, on_date,
      remaining_count, remaining_estimate,
      completed_count, completed_estimate,
      scope_count, scope_estimate, unestimated_count
    )
    SELECT
      r.id, v_today,
      count(*) FILTER (WHERE COALESCE(ts.is_closed, false) = false),
      COALESCE(sum(t.estimate_value) FILTER (WHERE COALESCE(ts.is_closed, false) = false), 0),
      count(*) FILTER (WHERE ts.category = 'completed'),
      COALESCE(sum(t.estimate_value) FILTER (WHERE ts.category = 'completed'), 0),
      count(*),
      COALESCE(sum(t.estimate_value), 0),
      count(*) FILTER (WHERE t.estimate_value IS NULL)
    FROM public.sprint_items si
    JOIN public.tasks t ON t.id = si.task_id
    LEFT JOIN public.columns c ON c.id = t.column_id
    LEFT JOIN public.task_statuses ts ON ts.key = COALESCE(c.status_key, t.status)
    WHERE si.sprint_id = r.id AND si.removed_at IS NULL
    ON CONFLICT (sprint_id, on_date) DO UPDATE SET
      remaining_count = EXCLUDED.remaining_count,
      remaining_estimate = EXCLUDED.remaining_estimate,
      completed_count = EXCLUDED.completed_count,
      completed_estimate = EXCLUDED.completed_estimate,
      scope_count = EXCLUDED.scope_count,
      scope_estimate = EXCLUDED.scope_estimate,
      unestimated_count = EXCLUDED.unestimated_count,
      captured_at = now();

    sprint_id := r.id; sampled := true; RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sample_all_active_sprints() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 6. Post-conditions.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_tasks BIGINT; v_sprints BIGINT; v_items BIGINT;
BEGIN
  SELECT task_rows, sprint_rows, item_rows INTO v_tasks, v_sprints, v_items FROM _124_precheck;

  IF (SELECT count(*) FROM public.tasks)        <> v_tasks   THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprints)      <> v_sprints THEN RAISE EXCEPTION 'Sprint rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprint_items) <> v_items   THEN RAISE EXCEPTION 'Sprint item rows moved. Aborting.'; END IF;

  IF (SELECT count(*) FROM public.sprint_metrics) <> 0 THEN RAISE EXCEPTION 'sprint_metrics seeded rows. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprint_burndown_samples) <> 0 THEN RAISE EXCEPTION 'burndown samples seeded rows. Aborting.'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('sprint_metrics', 'sprint_burndown_samples')
       AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on a metrics table. Aborting.';
  END IF;

  -- The ledger must be read-only to every client role. This is the guarantee every number
  -- rests on, so it is asserted rather than assumed.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('sprint_metrics', 'sprint_burndown_samples')
       AND grantee IN ('anon', 'authenticated')
       AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'A client role holds a write grant on a metrics ledger. Aborting.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('sprint_metrics', 'sprint_burndown_samples')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on a metrics ledger. Aborting.';
  END IF;

  -- 117's function-ACL lesson, queried rather than reasoned about.
  IF NOT has_function_privilege('authenticated', 'public.sample_sprint_burndown(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot call sample_sprint_burndown. The chart would never gain a point. Aborting.';
  END IF;
  IF has_function_privilege('authenticated', 'public.sample_all_active_sprints()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sample_all_active_sprints()', 'EXECUTE') THEN
    RAISE EXCEPTION 'A client role can run the cross-board sweep. Aborting.';
  END IF;
  IF has_function_privilege('anon', 'public.sample_sprint_burndown(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can call sample_sprint_burndown. Aborting.';
  END IF;

  RAISE NOTICE '124 verified: metrics ledger created read-only, 0 rows seeded, % sprints untouched.', v_sprints;
END $$;

COMMIT;
