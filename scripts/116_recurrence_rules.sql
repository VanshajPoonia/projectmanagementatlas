-- 116: separate the recurrence RULE from the work it GENERATES, and make generation idempotent.
--
-- WHAT IS WRONG
-- 025 put five columns on `tasks` - is_recurring, recurrence_pattern, recurrence_interval,
-- recurrence_end_date - and 086 added recurrence_weekdays. There is a toggle for them in
-- create-task-dialog.tsx and task-detail-modal.tsx, and a badge on task-card.tsx. 086's own
-- comment states the position plainly: "Descriptive only ... nothing currently spawns task
-- instances from it."
--
-- So for months a user has been able to mark a task "repeats weekly", see it confirmed on the
-- card, and receive nothing. That is the same defect class as profiles.is_active before 101 -
-- a control that is present, prominent and believed, wired to nothing. Measured on production
-- 2026-08-24: 14 tasks carry is_recurring = TRUE.
--
-- Worse, the columns cannot express a rule even descriptively:
--   * 4 of those 14 production rows have is_recurring = TRUE and recurrence_pattern = NULL.
--     "Recurs, cadence unspecified." Nothing rejected it because there is no CHECK.
--   * 0 of the 14 have an end date, and there is no occurrence count, so no rule can terminate.
--   * The task IS the rule AND IS the occurrence. There is nowhere to record that a given
--     instance was already produced, so any generator would duplicate on every retry.
--
-- THE FIX
-- Two tables, because they are two different things:
--
--   recurrence_rules        the schedule. One row per repeating thing. Owns frequency,
--                           interval, weekdays, bounds, and whether it is running.
--   recurrence_occurrences  the ledger. One row per instance the rule has produced, keyed
--                           UNIQUE (rule_id, occurrence_date).
--
-- That UNIQUE constraint is the whole idempotency story, and it is enforced by Postgres rather
-- than by the generator remembering to check. A retried job asks to create the same
-- (rule, date) pair, hits the constraint, and does nothing. Prompt D's requirement - "retrying
-- a scheduled job must not duplicate an occurrence" - is therefore a property of the schema and
-- not of the caller's care.
--
-- The ledger also answers a question the task rows cannot: `task_id` is ON DELETE SET NULL, so
-- deleting a generated task leaves its occurrence row behind. "I deleted this week's instance"
-- means the instance existed and was removed - it must not mean "produce it again next sweep".
--
-- WHY NO TRIGGER, AND WHY THIS IS ADDITIVE
-- The obvious design is a trigger on `tasks` firing when an occurrence closes. This does not do
-- that. Generation is entirely inside run_recurrence_generation(), which handles the
-- after-completion mode by asking whether the latest occurrence is closed. That keeps this
-- migration purely additive - two new tables, new functions, no existing table, row, policy,
-- grant or trigger touched - and so `--allow-prod` eligible on this repo's own rule, unlike 113.
-- The app calls the same function right after completing a task so the next instance appears
-- immediately; the sweep is the safety net. Both paths are idempotent, so they cannot disagree.
--
-- WHY THE LEDGER IS NOT WRITABLE BY ANYONE
-- `authenticated` gets SELECT on recurrence_occurrences and nothing else, mirroring
-- crm_order_status_history (103). A ledger that the application can write is a ledger that can
-- be made to disagree with what actually happened, and every idempotency guarantee here rests
-- on it being accurate. Only the SECURITY DEFINER generator writes it.
--
-- THE BACKFILL, AND WHAT IT DELIBERATELY DOES NOT DO
-- The 10 well-formed recurring tasks become active rules in 'on_completion' mode: the next
-- instance is produced when the current one is completed, so day one generates nothing and the
-- boards do not move until a human finishes something. Horizon generation for the same rules
-- would have created roughly 80 tasks on first sweep against a 171-task database.
--
-- The 4 rows with a NULL pattern get NO RULE. frequency is NOT NULL here on purpose, and there
-- is no defensible way to guess whether "repeats" meant daily or monthly. They keep
-- is_recurring = TRUE, no data is touched, and the editor reports them as incomplete so a human
-- can state the cadence. Inventing a schedule and then generating work from it is worse than
-- reporting the gap.
--
-- The five columns on `tasks` are left in place and untouched. Nothing is dropped and no task
-- row is modified by this migration.
--
-- Rollback: scripts/rollback/116_revert.sql. It destroys the rules and the ledger; it does NOT
-- delete any task, including tasks that were generated.

BEGIN;

CREATE TEMP TABLE _116_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)                             AS task_rows,
  (SELECT count(*) FROM public.tasks WHERE is_recurring)          AS recurring_rows,
  (SELECT count(*) FROM public.task_statuses)                     AS status_rows;

-- ---------------------------------------------------------------------------------------
-- The rule.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurrence_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The task this rule reproduces. Every generated occurrence is cloned from it, in both
  -- modes, so it stays the single description of "what recurs" even after instances exist.
  source_task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,

  frequency TEXT NOT NULL,
  -- Not named `interval`: that is a type name in SQL and reads as one at every call site.
  interval_count INTEGER NOT NULL DEFAULT 1,

  -- Only meaningful for frequency='weekly'. 0=Sunday..6=Saturday, matching 086 and the
  -- marketing calendar's picker, so the two weekday rows in this product mean the same thing.
  weekdays INTEGER[] NULL,

  -- Only meaningful for frequency='monthly'. NULL means "same day-of-month as starts_on".
  month_day INTEGER NULL,

  -- 'schedule'      produce every occurrence up to a horizon, so work is visible in advance.
  -- 'on_completion' produce the next one only once the current one closes, so exactly one
  --                 instance is ever live. The safe default, and what a repeating chore means.
  generation_mode TEXT NOT NULL DEFAULT 'on_completion',

  -- How far ahead 'schedule' mode is allowed to run. Bounded so a rule with no end date
  -- cannot produce unbounded work; see the CHECK below.
  horizon_days INTEGER NOT NULL DEFAULT 30,

  starts_on DATE NOT NULL,

  -- Bounds. Both optional and independent: whichever is reached first stops the rule.
  ends_on DATE NULL,
  max_occurrences INTEGER NULL,

  -- Maintained by the generator, never by the application. Lets max_occurrences be enforced
  -- without counting the ledger on every call.
  occurrences_created INTEGER NOT NULL DEFAULT 0,

  is_paused BOOLEAN NOT NULL DEFAULT FALSE,

  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recurrence_rules_frequency_check
    CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),

  -- Ceilings here are deliberately far above anything anyone would type. A CHECK that
  -- refuses a legitimate-if-unusual schedule ("every 500 days") teaches people the feature is
  -- fragile, and the cost of a wide bound is nothing - these are bounds against nonsense and
  -- runaway loops, not a product opinion about how often work should repeat.
  CONSTRAINT recurrence_rules_interval_check
    CHECK (interval_count BETWEEN 1 AND 1000),

  CONSTRAINT recurrence_rules_mode_check
    CHECK (generation_mode IN ('schedule', 'on_completion')),

  -- A horizon of 0 would mean "never produce anything" while still reading as active.
  -- Three years of look-ahead. The loop guard in run_recurrence_generation() is sized off
  -- THIS number - see the note there - so the two must be changed together.
  CONSTRAINT recurrence_rules_horizon_check
    CHECK (horizon_days BETWEEN 1 AND 1095),

  CONSTRAINT recurrence_rules_max_occurrences_check
    CHECK (max_occurrences IS NULL OR max_occurrences BETWEEN 1 AND 10000),

  CONSTRAINT recurrence_rules_ends_after_start_check
    CHECK (ends_on IS NULL OR ends_on >= starts_on),

  -- Weekdays belong to weekly and nowhere else, and an empty array is not "no restriction",
  -- it is a rule that can never fire. Both are rejected rather than silently ignored.
  --
  -- ⚠️ COALESCE is load-bearing. array_length('{}', 1) is NULL, not 0, and a CHECK constraint
  -- PASSES when its expression evaluates to NULL - so the obvious
  -- `array_length(weekdays,1) BETWEEN 1 AND 7` silently accepts the empty array, which is
  -- precisely the value it was written to reject. Caught by check-recurrence.mjs, not by
  -- reading: the first version of this constraint shipped to dev and let '{}' straight through.
  CONSTRAINT recurrence_rules_weekdays_check
    CHECK (
      weekdays IS NULL
      OR (
        frequency = 'weekly'
        AND COALESCE(array_length(weekdays, 1), 0) BETWEEN 1 AND 7
        AND weekdays <@ ARRAY[0,1,2,3,4,5,6]
      )
    ),

  CONSTRAINT recurrence_rules_month_day_check
    CHECK (
      month_day IS NULL
      OR (frequency = 'monthly' AND month_day BETWEEN 1 AND 31)
    ),

  CONSTRAINT recurrence_rules_occurrences_created_check
    CHECK (occurrences_created >= 0)
);

-- One live rule per task. A task that recurs on two schedules at once is not a thing this
-- product models, and allowing it would make "the rule for this task" ambiguous everywhere.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurrence_rules_source_task
  ON public.recurrence_rules(source_task_id);

CREATE INDEX IF NOT EXISTS idx_recurrence_rules_runnable
  ON public.recurrence_rules(is_paused, generation_mode)
  WHERE is_paused = FALSE;

-- ---------------------------------------------------------------------------------------
-- The ledger. See the header: this is the idempotency guarantee.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurrence_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.recurrence_rules(id) ON DELETE CASCADE,

  -- The calendar date this instance is FOR, in the business timezone. A DATE and not a
  -- timestamp: an occurrence belongs to a day, and comparing it as an instant is the trap
  -- lib/crm.ts's BUSINESS_TIME_ZONE exists to avoid.
  occurrence_date DATE NOT NULL,

  -- SET NULL, not CASCADE. Deleting a generated task must not delete the record that it was
  -- generated, or the next sweep would produce it again. See the header.
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recurrence_occurrences_unique_per_date UNIQUE (rule_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_recurrence_occurrences_rule_date
  ON public.recurrence_occurrences(rule_id, occurrence_date DESC);

CREATE INDEX IF NOT EXISTS idx_recurrence_occurrences_task
  ON public.recurrence_occurrences(task_id)
  WHERE task_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_recurrence_rules_updated_at ON public.recurrence_rules;
CREATE TRIGGER set_recurrence_rules_updated_at
  BEFORE UPDATE ON public.recurrence_rules
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- Date math. IMMUTABLE and side-effect free, so it is callable from a CHECK, from the
-- generator, and from a harness that compares it against lib/recurrence.ts case for case.
--
-- Every branch delegates the hard part to Postgres interval arithmetic, which already clamps
-- correctly: '2026-01-31'::date + interval '1 month' is 2026-02-28, and Feb 29 + 1 year is
-- Feb 28. Reimplementing that clamping is how off-by-one-day bugs get written.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_occurrence_date(
  p_after      DATE,
  p_frequency  TEXT,
  p_interval   INTEGER,
  p_weekdays   INTEGER[] DEFAULT NULL,
  p_month_day  INTEGER   DEFAULT NULL
)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_interval INTEGER := GREATEST(COALESCE(p_interval, 1), 1);
  v_candidate DATE;
  v_dow INTEGER;
  v_step INTEGER;
  v_target_day INTEGER;
  v_month_start DATE;
BEGIN
  IF p_after IS NULL OR p_frequency IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_frequency = 'daily' THEN
    RETURN p_after + (v_interval || ' days')::INTERVAL;

  ELSIF p_frequency = 'weekly' THEN
    IF p_weekdays IS NULL OR array_length(p_weekdays, 1) IS NULL THEN
      -- Plain weekly: same weekday, N weeks on.
      RETURN p_after + (v_interval * 7 || ' days')::INTERVAL;
    END IF;

    -- Selected weekdays. Walk forward day by day to the end of the current week looking for
    -- another listed day; a loop of at most 7 steps is clearer here than modular arithmetic
    -- and cannot be off by one at a week boundary.
    v_dow := EXTRACT(DOW FROM p_after)::INTEGER;
    FOR v_step IN 1..(6 - v_dow) LOOP
      IF ((v_dow + v_step) = ANY (p_weekdays)) THEN
        RETURN p_after + (v_step || ' days')::INTERVAL;
      END IF;
    END LOOP;

    -- Nothing left this week, so jump to the interval-th week ahead and take its first
    -- listed day. Sunday-anchored, matching the 0=Sunday convention of the array itself.
    v_candidate := p_after - (v_dow || ' days')::INTERVAL + (v_interval * 7 || ' days')::INTERVAL;
    FOR v_step IN 0..6 LOOP
      IF (v_step = ANY (p_weekdays)) THEN
        RETURN v_candidate + (v_step || ' days')::INTERVAL;
      END IF;
    END LOOP;
    -- Unreachable: the CHECK constraint refuses an empty weekdays array.
    RETURN NULL;

  ELSIF p_frequency = 'monthly' THEN
    IF p_month_day IS NULL THEN
      RETURN p_after + (v_interval || ' months')::INTERVAL;
    END IF;
    -- An explicit day-of-month. Move to the target month first, then clamp into it, so
    -- "the 31st" lands on the 30th in a 30-day month instead of overflowing into the next.
    v_month_start := date_trunc('month', p_after)::DATE + (v_interval || ' months')::INTERVAL;
    v_target_day := LEAST(
      p_month_day,
      EXTRACT(DAY FROM (date_trunc('month', v_month_start) + INTERVAL '1 month - 1 day'))::INTEGER
    );
    RETURN v_month_start + ((v_target_day - 1) || ' days')::INTERVAL;

  ELSIF p_frequency = 'yearly' THEN
    RETURN p_after + (v_interval || ' years')::INTERVAL;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.next_occurrence_date(DATE, TEXT, INTEGER, INTEGER[], INTEGER) IS
  'The one definition of when a recurrence next fires. lib/recurrence.ts mirrors it and '
  'scripts/check-recurrence.mjs asserts the two agree case for case - do not change one alone.';

-- ---------------------------------------------------------------------------------------
-- Producing one occurrence.
--
-- SECURITY DEFINER because it writes recurrence_occurrences, which no role may write, and
-- because a scheduled sweep has no session user to authorise against. It is therefore written
-- to take no direction from the caller beyond a rule id and a date: it never accepts task
-- content, a column, or an owner, so there is nothing to inject through it.
--
-- Returns the task id it created, or NULL when the occurrence already existed. Callers use
-- that to report honestly instead of claiming work that was already there.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_recurrence_occurrence(
  p_rule_id UUID,
  p_occurrence_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_rule    public.recurrence_rules%ROWTYPE;
  v_source  public.tasks%ROWTYPE;
  v_board   UUID;
  v_column  UUID;
  v_status  TEXT;
  v_new_id  UUID;
  v_pos     INTEGER;
BEGIN
  SELECT * INTO v_rule FROM public.recurrence_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurrence rule % does not exist.', p_rule_id;
  END IF;

  -- The idempotency check, stated before doing any work. The UNIQUE constraint below is what
  -- actually guarantees it under concurrency; this is the cheap path for the common retry.
  IF EXISTS (
    SELECT 1 FROM public.recurrence_occurrences
    WHERE rule_id = p_rule_id AND occurrence_date = p_occurrence_date
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_source FROM public.tasks WHERE id = v_rule.source_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurrence rule % has no source task.', p_rule_id;
  END IF;

  SELECT c.board_id INTO v_board FROM public.columns c WHERE c.id = v_source.column_id;

  -- Land the new instance in a column that means "not started", resolved through 112's
  -- category rather than a column title. Falling back to the source task's own column would
  -- put a fresh occurrence straight into Done whenever the template had been completed, which
  -- is exactly the state an on_completion rule is in when it fires.
  SELECT c.id, c.status_key INTO v_column, v_status
  FROM public.columns c
  JOIN public.task_statuses s ON s.key = c.status_key
  WHERE c.board_id = v_board
    AND s.category IN ('planned', 'backlog')
    AND s.is_archived = FALSE
  ORDER BY (s.category = 'planned') DESC, c.position ASC
  LIMIT 1;

  IF v_column IS NULL THEN
    -- No open column on this board. Refuse rather than guess: silently dropping the
    -- occurrence would let a rule report as running while producing nothing.
    RAISE EXCEPTION 'Board % has no open column to place a recurring task in.', v_board;
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1 INTO v_pos
  FROM public.tasks
  WHERE column_id = v_column AND deleted_at IS NULL AND archived_at IS NULL;

  INSERT INTO public.tasks (
    column_id, title, description, assigned_to, created_by, position,
    due_date, status, priority, visibility, type_key,
    -- Deliberately NOT is_recurring. The generated instance is an occurrence, not a rule;
    -- marking it recurring would make every instance look like a second schedule and would
    -- let a user "edit the recurrence" on a copy, changing nothing.
    is_recurring
  ) VALUES (
    v_column,
    v_source.title,
    v_source.description,
    v_source.assigned_to,
    v_rule.created_by,
    v_pos,
    p_occurrence_date::TIMESTAMPTZ,
    v_status,
    v_source.priority,
    v_source.visibility,
    v_source.type_key,
    FALSE
  )
  RETURNING id INTO v_new_id;

  -- Carry the people and the labels across. A recurring task that arrives unassigned every
  -- week is a recurring task nobody does.
  INSERT INTO public.task_assignees (task_id, user_id)
  SELECT v_new_id, ta.user_id FROM public.task_assignees ta WHERE ta.task_id = v_source.id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.task_tags (task_id, tag_id)
  SELECT v_new_id, tt.tag_id FROM public.task_tags tt WHERE tt.task_id = v_source.id
  ON CONFLICT DO NOTHING;

  -- Claim the date. Under concurrency the loser of the race raises unique_violation, and the
  -- handler undoes its own task rather than leaving an orphan behind.
  BEGIN
    INSERT INTO public.recurrence_occurrences (rule_id, occurrence_date, task_id)
    VALUES (p_rule_id, p_occurrence_date, v_new_id);
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM public.tasks WHERE id = v_new_id;
    RETURN NULL;
  END;

  UPDATE public.recurrence_rules
  SET occurrences_created = occurrences_created + 1
  WHERE id = p_rule_id;

  INSERT INTO public.task_activity (task_id, actor_id, action, event_type, metadata)
  VALUES (
    v_new_id, v_rule.created_by,
    'created this task from a recurring schedule',
    'recurrence_generated',
    jsonb_build_object('rule_id', p_rule_id, 'occurrence_date', p_occurrence_date)
  );

  RETURN v_new_id;
END;
$$;

-- ⚠️ REVOKE FROM PUBLIC IS NOT ENOUGH FOR A FUNCTION IN THIS DATABASE.
-- `postgres` carries a DEFAULT ACL granting EXECUTE on every new function in `public` to
-- `authenticated` (and historically `anon`). That is a real grant, not the implicit PUBLIC
-- one, so REVOKE ... FROM PUBLIC leaves it untouched and the function stays callable. 095
-- closed this for anon on TABLES; the function default was still open. Measured here with
-- has_function_privilege(), not reasoned about.
--
-- It matters enormously for this one: it is SECURITY DEFINER, so a signed-in user calling it
-- directly would create an occurrence on any rule for any date, bypassing every bound the
-- driver enforces - paused, ends_on, max_occurrences - and bypassing RLS entirely.
-- Only run_recurrence_generation() may call it.
REVOKE ALL ON FUNCTION public.create_recurrence_occurrence(UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- The driver. One entry point for every way generation can be triggered: the sweep, the
-- app calling it after a completion, and an admin pressing "Run now". All three are the
-- same code path, so they cannot drift, and all three are idempotent, so they cannot
-- double-produce when they overlap.
--
-- Returns a row per rule it considered, so a caller can report what actually happened
-- rather than asserting success. Prompt D's "show number affected" starts here.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_recurrence_generation(
  p_rule_id UUID DEFAULT NULL,
  p_today   DATE DEFAULT NULL
)
RETURNS TABLE (rule_id UUID, created_count INTEGER, skipped_reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_today    DATE := COALESCE(p_today, (now() AT TIME ZONE 'America/Chicago')::DATE);
  v_rule     public.recurrence_rules%ROWTYPE;
  v_last     DATE;
  v_next     DATE;
  v_limit    DATE;
  v_created  INTEGER;
  v_task     UUID;
  v_guard    INTEGER;
  v_open     BOOLEAN;
  v_latest   UUID;
BEGIN
  -- A full sweep is either the scheduled job (no session user - the service role) or an
  -- admin. A signed-in user may drive a single rule, and only one whose task they can see;
  -- that is the path the board takes when a recurring task is completed.
  IF p_rule_id IS NULL THEN
    IF auth.uid() IS NOT NULL AND NOT private.is_admin_user() THEN
      RAISE EXCEPTION 'Only an admin or the scheduled job may run a full recurrence sweep.';
    END IF;
  ELSE
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.recurrence_rules r
      JOIN public.tasks t ON t.id = r.source_task_id
      WHERE r.id = p_rule_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    ) THEN
      RAISE EXCEPTION 'Recurrence rule % is not yours to run.', p_rule_id;
    END IF;
  END IF;

  FOR v_rule IN
    SELECT r.* FROM public.recurrence_rules r
    JOIN public.tasks t ON t.id = r.source_task_id
    WHERE (p_rule_id IS NULL OR r.id = p_rule_id)
      AND r.is_paused = FALSE
      AND t.deleted_at IS NULL
      AND t.archived_at IS NULL
    ORDER BY r.created_at
  LOOP
    v_created := 0;

    -- Bounds first, so an exhausted rule reports why instead of looking like a failure.
    IF v_rule.max_occurrences IS NOT NULL
       AND v_rule.occurrences_created >= v_rule.max_occurrences THEN
      rule_id := v_rule.id; created_count := 0; skipped_reason := 'occurrence limit reached';
      RETURN NEXT; CONTINUE;
    END IF;

    IF v_rule.ends_on IS NOT NULL AND v_rule.ends_on < v_today THEN
      rule_id := v_rule.id; created_count := 0; skipped_reason := 'past its end date';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT occurrence_date, task_id INTO v_last, v_latest
    FROM public.recurrence_occurrences
    WHERE recurrence_occurrences.rule_id = v_rule.id
    ORDER BY occurrence_date DESC
    LIMIT 1;

    IF v_rule.generation_mode = 'on_completion' THEN
      -- The instance currently in play is the newest occurrence, or the source task itself
      -- when the rule has produced nothing yet. 112's category decides "closed" - never the
      -- column title, and never the raw status text.
      SELECT NOT COALESCE(s.is_closed, FALSE) INTO v_open
      FROM public.tasks t
      LEFT JOIN public.columns c ON c.id = t.column_id
      LEFT JOIN public.task_statuses s ON s.key = c.status_key
      WHERE t.id = COALESCE(v_latest, v_rule.source_task_id)
        AND t.deleted_at IS NULL;

      IF v_open IS NULL THEN
        -- The instance was deleted outright. Treat that as "nothing in play" and continue,
        -- rather than stalling the rule forever on a row that no longer exists.
        v_open := FALSE;
      END IF;

      IF v_open THEN
        rule_id := v_rule.id; created_count := 0;
        skipped_reason := 'current occurrence is still open';
        RETURN NEXT; CONTINUE;
      END IF;

      v_next := public.next_occurrence_date(
        COALESCE(v_last, v_rule.starts_on),
        v_rule.frequency, v_rule.interval_count, v_rule.weekdays, v_rule.month_day
      );

      -- Completing three weeks late should produce ONE next instance, dated ahead, not three
      -- overdue copies. Walk forward to today rather than backfilling the gap.
      --
      -- ⚠️ The guard is sized to be unreachable in practice AND it fails LOUDLY. 20000 steps is
      -- ~54 years of a daily rule, so no real schedule reaches it. The important half is the
      -- check afterwards: the first version stopped at 500 and carried on with whatever date
      -- it had reached, which for a daily rule older than 500 days meant silently creating an
      -- occurrence dated in the PAST. A guard that truncates quietly turns a safety net into a
      -- bug generator, so an exhausted guard reports and skips instead.
      v_guard := 0;
      WHILE v_next IS NOT NULL AND v_next < v_today AND v_guard < 20000 LOOP
        v_next := public.next_occurrence_date(
          v_next, v_rule.frequency, v_rule.interval_count, v_rule.weekdays, v_rule.month_day
        );
        v_guard := v_guard + 1;
      END LOOP;

      IF v_guard >= 20000 THEN
        rule_id := v_rule.id; created_count := 0;
        skipped_reason := 'start date is too far in the past to catch up - edit the schedule';
        RETURN NEXT; CONTINUE;
      END IF;

      IF v_next IS NOT NULL
         AND (v_rule.ends_on IS NULL OR v_next <= v_rule.ends_on) THEN
        v_task := public.create_recurrence_occurrence(v_rule.id, v_next);
        IF v_task IS NOT NULL THEN v_created := 1; END IF;
      END IF;

    ELSE
      -- Schedule mode: fill forward to the horizon. The horizon is what stops a rule with no
      -- end date from producing unbounded work, so it is a column and not a magic number.
      v_limit := v_today + v_rule.horizon_days;
      IF v_rule.ends_on IS NOT NULL AND v_rule.ends_on < v_limit THEN
        v_limit := v_rule.ends_on;
      END IF;

      IF v_last IS NULL THEN
        v_next := GREATEST(v_rule.starts_on, v_today);
        -- starts_on may not itself be a listed weekday; move to one before producing anything.
        IF v_rule.frequency = 'weekly' AND v_rule.weekdays IS NOT NULL
           AND NOT (EXTRACT(DOW FROM v_next)::INTEGER = ANY (v_rule.weekdays)) THEN
          v_next := public.next_occurrence_date(
            v_next, v_rule.frequency, v_rule.interval_count, v_rule.weekdays, v_rule.month_day
          );
        END IF;
      ELSE
        v_next := public.next_occurrence_date(
          v_last, v_rule.frequency, v_rule.interval_count, v_rule.weekdays, v_rule.month_day
        );
      END IF;

      -- ⚠️ Sized off horizon_days, which is capped at 1095. The most a rule can legitimately
      -- produce in one sweep is one occurrence per day inside the horizon, so 1095 is the true
      -- ceiling and 20000 leaves an order of magnitude of headroom. It was 400 - fewer than a
      -- daily rule needs at even the OLD 365-day horizon, which would have stopped filling
      -- part-way through with no indication. If horizon_days is ever raised past this, raise
      -- this with it.
      v_guard := 0;
      WHILE v_next IS NOT NULL AND v_next <= v_limit AND v_guard < 20000 LOOP
        EXIT WHEN v_rule.max_occurrences IS NOT NULL
              AND (v_rule.occurrences_created + v_created) >= v_rule.max_occurrences;

        v_task := public.create_recurrence_occurrence(v_rule.id, v_next);
        IF v_task IS NOT NULL THEN v_created := v_created + 1; END IF;

        v_next := public.next_occurrence_date(
          v_next, v_rule.frequency, v_rule.interval_count, v_rule.weekdays, v_rule.month_day
        );
        v_guard := v_guard + 1;
      END LOOP;
    END IF;

    rule_id := v_rule.id;
    created_count := v_created;
    skipped_reason := NULL;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- The driver, by contrast, IS meant to be callable by a signed-in user: it does its own
-- authorisation at the top (own rule only, or admin for a full sweep) and enforces every
-- bound. anon is revoked because nothing unauthenticated has any business generating work.
REVOKE ALL ON FUNCTION public.run_recurrence_generation(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_recurrence_generation(UUID, DATE) TO authenticated;

-- Pure date math over no data at all, so it is safe for a signed-in user to call and the
-- harness does. anon still gets nothing, per 095's rule.
REVOKE ALL ON FUNCTION public.next_occurrence_date(DATE, TEXT, INTEGER, INTEGER[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_occurrence_date(DATE, TEXT, INTEGER, INTEGER[], INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------------------
-- Grants. Per 095, a new table in `public` inherits a blanket grant, so the wide grant is
-- already there and granting narrowly is not enough - it has to be revoked first.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.recurrence_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.recurrence_occurrences FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurrence_rules TO authenticated;

-- SELECT and nothing else, mirroring crm_order_status_history. The ledger is the idempotency
-- guarantee; an application that can write it is an application that can break the guarantee.
GRANT SELECT ON public.recurrence_occurrences TO authenticated;

ALTER TABLE public.recurrence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurrence_occurrences ENABLE ROW LEVEL SECURITY;

-- Policy shape copied from task_links, so board privacy, guest/client read-only and task
-- visibility all apply to a schedule exactly as they apply to the task it belongs to. Nothing
-- here has to learn about board roles a second time.
DROP POLICY IF EXISTS "Collaborators can view recurrence rules" ON public.recurrence_rules;
CREATE POLICY "Collaborators can view recurrence rules"
  ON public.recurrence_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = recurrence_rules.source_task_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can create recurrence rules" ON public.recurrence_rules;
CREATE POLICY "Collaborators can create recurrence rules"
  ON public.recurrence_rules FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = recurrence_rules.source_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can update recurrence rules" ON public.recurrence_rules;
CREATE POLICY "Collaborators can update recurrence rules"
  ON public.recurrence_rules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = recurrence_rules.source_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = recurrence_rules.source_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Collaborators can delete recurrence rules" ON public.recurrence_rules;
CREATE POLICY "Collaborators can delete recurrence rules"
  ON public.recurrence_rules FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = recurrence_rules.source_task_id
        AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

-- Read-only, and only for people who can see the work the rule reproduces.
DROP POLICY IF EXISTS "Collaborators can view recurrence occurrences" ON public.recurrence_occurrences;
CREATE POLICY "Collaborators can view recurrence occurrences"
  ON public.recurrence_occurrences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.recurrence_rules r
      JOIN public.tasks t ON t.id = r.source_task_id
      WHERE r.id = recurrence_occurrences.rule_id
        AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

COMMENT ON TABLE public.recurrence_rules IS
  'The schedule for a repeating task. One row per repeating thing, never per instance.';
COMMENT ON TABLE public.recurrence_occurrences IS
  'Ledger of instances a rule has produced. UNIQUE(rule_id, occurrence_date) is what makes '
  'generation idempotent - a retried job cannot duplicate. Written only by '
  'create_recurrence_occurrence(); authenticated holds SELECT and nothing else.';
COMMENT ON COLUMN public.recurrence_occurrences.task_id IS
  'ON DELETE SET NULL on purpose. Deleting a generated task must not erase the record that it '
  'was generated, or the next sweep would produce it again.';

-- ---------------------------------------------------------------------------------------
-- Backfill. See the header for why the malformed rows are deliberately skipped.
-- ---------------------------------------------------------------------------------------
INSERT INTO public.recurrence_rules (
  source_task_id, frequency, interval_count, weekdays,
  generation_mode, starts_on, ends_on, created_by, is_paused
)
SELECT
  t.id,
  -- 086 allowed a 'custom' pattern meaning "these weekdays". That is weekly with a weekday
  -- list, which this table can express directly, so the special case does not survive.
  CASE WHEN t.recurrence_pattern = 'custom' THEN 'weekly' ELSE t.recurrence_pattern END,
  GREATEST(LEAST(COALESCE(t.recurrence_interval, 1), 365), 1),
  CASE
    WHEN t.recurrence_pattern = 'custom'
     AND t.recurrence_weekdays IS NOT NULL
     AND array_length(t.recurrence_weekdays, 1) > 0
    THEN t.recurrence_weekdays
    ELSE NULL
  END,
  -- Active, but one instance at a time: day one produces nothing until a human completes
  -- something. Horizon mode on these same rules would have created roughly 80 tasks at once.
  'on_completion',
  COALESCE(t.due_date::DATE, t.created_at::DATE, CURRENT_DATE),
  t.recurrence_end_date::DATE,
  t.created_by,
  FALSE
FROM public.tasks t
WHERE t.is_recurring = TRUE
  AND t.deleted_at IS NULL
  AND t.recurrence_pattern IN ('daily', 'weekly', 'monthly', 'yearly', 'custom')
  -- A 'custom' pattern with no weekdays names no days at all, so it is as unschedulable as a
  -- NULL pattern and is skipped for the same reason.
  AND NOT (
    t.recurrence_pattern = 'custom'
    AND (t.recurrence_weekdays IS NULL OR array_length(t.recurrence_weekdays, 1) IS NULL)
  )
  AND NOT EXISTS (SELECT 1 FROM public.recurrence_rules r WHERE r.source_task_id = t.id)
ON CONFLICT (source_task_id) DO NOTHING;

-- ---------------------------------------------------------------------------------------
-- Post-conditions. Anything failing here rolls the whole migration back.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before   BIGINT;
  v_after    BIGINT;
  v_rules    BIGINT;
  v_skipped  BIGINT;
  v_bad      BIGINT;
  v_date     DATE;
BEGIN
  SELECT task_rows INTO v_before FROM _116_precheck;
  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'tasks row count changed during an additive migration (% -> %). Aborting.',
      v_before, v_after;
  END IF;

  -- No task row may have been edited either. The five recurrence_* columns stay exactly as
  -- they were; this migration reads them and writes a new table.
  SELECT recurring_rows INTO v_before FROM _116_precheck;
  SELECT count(*) INTO v_after FROM public.tasks WHERE is_recurring;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'is_recurring count changed (% -> %) - the backfill must not write tasks. Aborting.',
      v_before, v_after;
  END IF;

  -- Nothing may have been generated yet. Every backfilled rule is on_completion, so the
  -- ledger must be empty until a human closes something.
  SELECT count(*) INTO v_bad FROM public.recurrence_occurrences;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'The migration generated % occurrence(s). It must generate none. Aborting.', v_bad;
  END IF;

  SELECT count(*) INTO v_rules FROM public.recurrence_rules;
  SELECT count(*) INTO v_skipped
  FROM public.tasks t
  WHERE t.is_recurring AND t.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.recurrence_rules r WHERE r.source_task_id = t.id);

  -- Every recurring task is either ruled or knowingly skipped; none may be silently lost.
  SELECT count(*) INTO v_bad FROM public.tasks WHERE is_recurring AND deleted_at IS NULL;
  IF (v_rules + v_skipped) <> v_bad THEN
    RAISE EXCEPTION 'Backfill does not account for every recurring task (% ruled + % skipped <> %). Aborting.',
      v_rules, v_skipped, v_bad;
  END IF;

  -- Every rule must be schedulable. A rule that cannot compute its own next date is exactly
  -- the malformed state this migration exists to stop.
  FOR v_date IN
    SELECT public.next_occurrence_date(r.starts_on, r.frequency, r.interval_count, r.weekdays, r.month_day)
    FROM public.recurrence_rules r
  LOOP
    IF v_date IS NULL THEN
      RAISE EXCEPTION 'A backfilled rule cannot compute its next occurrence. Aborting.';
    END IF;
  END LOOP;

  -- Assert the constraint by trying to violate it. "The constraint exists" is not the same
  -- claim as "the constraint refuses this value" - see the COALESCE note on the column.
  BEGIN
    INSERT INTO public.recurrence_rules (source_task_id, frequency, interval_count, weekdays, starts_on)
    SELECT id, 'weekly', 1, ARRAY[]::INTEGER[], CURRENT_DATE FROM public.tasks LIMIT 1;
    RAISE EXCEPTION 'An empty weekday array was accepted - the rule could never fire. Aborting.';
  EXCEPTION
    WHEN check_violation THEN NULL; -- expected
    WHEN unique_violation THEN NULL; -- the sample task already has a rule; the CHECK is untested here
  END;

  -- The idempotency guarantee must be a constraint, not a convention.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recurrence_occurrences'::regclass
      AND conname = 'recurrence_occurrences_unique_per_date'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'The UNIQUE(rule_id, occurrence_date) constraint is missing - generation would duplicate. Aborting.';
  END IF;

  -- The ledger must not be application-writable.
  SELECT count(*) INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'recurrence_occurrences'
    AND grantee IN ('authenticated', 'anon')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'recurrence_occurrences is writable by a client role (% grant(s)). Aborting.', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('recurrence_rules', 'recurrence_occurrences')
    AND grantee = 'anon';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on the new tables - 095 must stay closed. Aborting.', v_bad;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.recurrence_rules'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.recurrence_occurrences'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on both new tables. Aborting.';
  END IF;

  SELECT count(*) INTO v_bad FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'recurrence_rules';
  IF v_bad <> 4 THEN
    RAISE EXCEPTION 'Expected 4 policies on recurrence_rules, found %. Aborting.', v_bad;
  END IF;

  -- The generator must not be reachable directly. See the REVOKE above for why FROM PUBLIC
  -- alone does not achieve this.
  IF has_function_privilege('authenticated', 'public.create_recurrence_occurrence(uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_recurrence_occurrence(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_recurrence_occurrence is callable by a client role - it would bypass every rule bound. Aborting.';
  END IF;

  IF has_function_privilege('anon', 'public.run_recurrence_generation(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can run recurrence generation. Aborting.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.run_recurrence_generation(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot run their own rule - the Run now button would fail. Aborting.';
  END IF;

  -- 112 is a hard dependency: create_recurrence_occurrence resolves its destination column
  -- through task_statuses.category, and the driver reads is_closed.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'task_statuses' AND column_name = 'is_closed'
  ) THEN
    RAISE EXCEPTION '112 has not been applied - recurrence cannot resolve open vs closed. Aborting.';
  END IF;

  RAISE NOTICE '116 verified: % rule(s) backfilled, % recurring task(s) skipped as unschedulable, 0 generated.',
    v_rules, v_skipped;
END $$;

COMMIT;
