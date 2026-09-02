-- 129: project purpose, and goals whose OUTCOME is kept separate from EXECUTION.
--
-- WHY THIS EXISTS
-- Prompt H's loudest requirement is a distinction, not a feature: "Display separately -
-- execution progress (how much planned work is complete) and outcome progress (did the target
-- business/user metric improve). Never imply they are the same." ATLAS_01 10.6 says the same
-- thing from the other side: "A project can complete all tasks and still fail its outcome."
--
-- That distinction only survives if the two numbers come from two different places in the
-- schema. Execution is computed from `tasks` through goal_links, at read time, and is never
-- stored. Outcome is three numbers a human maintains - start, current, target - and is never
-- inferred from task completion. There is deliberately no column anywhere that mixes them,
-- because a single "progress" percentage is exactly the lie this migration exists to prevent.
--
-- WHAT IS OPTIONAL
--   1. `app_modules.strategy` seeds DISABLED, like appointments (080), crm (103) and agile
--      (123). No nav item and /strategy redirects until a super admin switches it on.
--   2. `board_purpose` seeds ZERO rows. Prompt H: "Do not require these fields to create a
--      board." A board with no purpose row is a board with no purpose, which is the normal
--      case and must stay normal - there is no NOT NULL anywhere in that table.
--   3. Every goal field except the title is nullable. A goal with only a title is a valid
--      goal, per the progressive-disclosure principle.
--
-- THE LEDGER
-- `goal_checkins` is trigger-written and `authenticated` holds SELECT and nothing else - the
-- crm_order_status_history (103) / recurrence_occurrences (116) / sprint_metrics (124) pattern.
-- A goal's current value is one mutable number; without a history, "did the metric improve"
-- has no answer at all, and a history the application can write is one that can be made to
-- agree with whatever this quarter needs it to say.
--
-- ⚠️ `goals.checkin_note` is a WRITE-ONLY CARRIER column, 103's pattern, and 104's lesson is
-- applied to it: the trigger has NO `OF column` clause (a trigger with one cannot police the
-- columns it does not fire on), and EVERY path through it blanks the carrier, including the
-- ones that write no check-in. 104 had to fix exactly that bug: an early RETURN left a stale
-- reason in place and the NEXT transition stamped it onto a record nobody had supplied it for.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: four NEW tables, triggers on NEW TABLES ONLY, one app_modules row that seeds off.
-- No existing table, row, policy, grant or trigger is touched, so nothing that already happens
-- can start behaving differently. Eligible on this repo's own rule, and because the module
-- seeds disabled it changes nothing anyone can see until somebody switches it on.
-- Rollback: scripts/rollback/129_revert.sql (destroys every goal, purpose and check-in).

BEGIN;

CREATE TEMP TABLE _129_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.boards)      AS board_rows,
  (SELECT count(*) FROM public.tasks)       AS task_rows,
  (SELECT count(*) FROM public.profiles)    AS profile_rows,
  (SELECT count(*) FROM public.app_modules) AS module_rows;

-- ---------------------------------------------------------------------------------------
-- 1. Project purpose. Every field optional, by requirement.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_purpose (
  board_id          UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  problem_statement TEXT CHECK (problem_statement IS NULL OR length(problem_statement) <= 4000),
  purpose           TEXT CHECK (purpose           IS NULL OR length(purpose)           <= 4000),
  intended_outcome  TEXT CHECK (intended_outcome  IS NULL OR length(intended_outcome)  <= 4000),
  stakeholders      TEXT CHECK (stakeholders      IS NULL OR length(stakeholders)      <= 4000),
  target_customer   TEXT CHECK (target_customer   IS NULL OR length(target_customer)   <= 4000),
  success_criteria  TEXT CHECK (success_criteria  IS NULL OR length(success_criteria)  <= 4000),
  constraints       TEXT CHECK (constraints       IS NULL OR length(constraints)       <= 4000),
  non_goals         TEXT CHECK (non_goals         IS NULL OR length(non_goals)         <= 4000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.board_purpose IS
  'Optional "why does this project exist" record, one row per board. Every column is nullable '
  'on purpose: Prompt H requires that none of this is needed to create a board, and a board '
  'with no row here is the normal case rather than an incomplete one.';

COMMENT ON COLUMN public.board_purpose.non_goals IS
  'What this project is deliberately NOT doing. Kept as its own field rather than folded into '
  'the purpose text because it is the one people skip writing and the one that later prevents '
  'the most argument.';

-- ---------------------------------------------------------------------------------------
-- 2. The goal. Workspace-scoped, not board-scoped: a goal that could only point at one
--    board would make "Goal -> Project" meaningless, and spanning projects is the reason
--    the object exists at all.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description   TEXT CHECK (description IS NULL OR length(description) <= 4000),
  owner_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Timeframe. DATE, never TIMESTAMPTZ: a goal runs over DAYS and must never be parsed into
  -- an instant. This repo has shipped that bug five-plus times on tasks.due_date; sprints
  -- (123) made the same choice for the same reason, and lib/goals.ts compares these as
  -- calendar strings through lib/calendar-grid.ts.
  starts_on     DATE,
  ends_on       DATE,
  CONSTRAINT goals_timeframe_ordered CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),

  -- The OUTCOME half. `metric` is what is being measured in words; the three numbers are the
  -- measurement. All nullable: a goal can be qualitative, and a qualitative goal must not be
  -- forced to invent a number to exist.
  metric        TEXT CHECK (metric IS NULL OR length(metric) <= 500),
  unit          TEXT CHECK (unit   IS NULL OR length(unit)   <= 40),
  start_value   NUMERIC(18, 4),
  current_value NUMERIC(18, 4),
  target_value  NUMERIC(18, 4),

  -- Manual, never inferred. CLAUDE.md's Phase 3 note about project health applies exactly:
  -- "an auto-status that is wrong destroys trust in every other number shown". NULL means
  -- nobody has said, which is different from "on track".
  confidence    TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  health        TEXT CHECK (health     IS NULL OR health     IN ('on_track', 'at_risk', 'off_track')),

  -- A goal list with no way to close a goal is unusable within a year. `achieved` and `missed`
  -- are deliberately different endings: a goal that ended without hitting its number is a
  -- fact worth keeping, and collapsing both into "closed" is how an organisation loses the
  -- only evidence it has about how well it forecasts.
  state         TEXT NOT NULL DEFAULT 'active'
                CHECK (state IN ('active', 'achieved', 'missed', 'cancelled')),

  -- ⚠️ WRITE-ONLY CARRIER (103's pattern). Set it in the same UPDATE that moves the numbers
  -- and the trigger copies it onto the check-in it opens, then blanks it. It is ALWAYS NULL
  -- at rest, and the post-conditions below try the write that would prove otherwise.
  -- The alternative - a second write into goal_checkins afterwards - needs that table to be
  -- application-writable, which is exactly what this design refuses.
  checkin_note  TEXT CHECK (checkin_note IS NULL OR length(checkin_note) <= 2000),

  position      INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_state ON public.goals(state, position);
CREATE INDEX IF NOT EXISTS idx_goals_owner ON public.goals(owner_id);

COMMENT ON TABLE public.goals IS
  'An outcome the organisation is trying to reach. Deliberately holds NO execution figure: '
  'how much of the linked work is done is computed from tasks at read time and never stored '
  'here, so no column can ever present the two as one number.';

COMMENT ON COLUMN public.goals.current_value IS
  'The latest measurement. This is the only writable current value; every change to it is '
  'recorded in goal_checkins by a trigger, so the history cannot disagree with the goal.';

-- ---------------------------------------------------------------------------------------
-- 3. What the goal is connected to.
--
-- Prompt H draws Goal -> Project -> Milestone -> Work. Milestones do not exist yet (they are
-- Prompt I / CLAUDE.md Phase 3), so this table carries the two ends that DO exist and nothing
-- pretends otherwise. Adding milestones later is one nullable column plus one widened CHECK.
--
-- ⚠️ Two typed, foreign-keyed columns rather than a polymorphic (entity_type, entity_id) pair.
-- A uuid with no FK is a reference the database cannot police: it survives the deletion of the
-- thing it points at, and every consumer then has to decide what a dangling link means.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goal_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id    UUID NOT NULL REFERENCES public.goals(id)  ON DELETE CASCADE,
  board_id   UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  task_id    UUID REFERENCES public.tasks(id)  ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goal_links_exactly_one_end CHECK (num_nonnulls(board_id, task_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_links_board ON public.goal_links(goal_id, board_id) WHERE board_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_links_task  ON public.goal_links(goal_id, task_id)  WHERE task_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goal_links_goal ON public.goal_links(goal_id);

COMMENT ON TABLE public.goal_links IS
  'Connects a goal to a board or a work item. Exactly one end per row, both foreign-keyed. '
  'Milestones are a third column the day milestones exist; there is no placeholder for them '
  'here, because a column nothing writes is a claim the product cannot keep.';

-- ---------------------------------------------------------------------------------------
-- 4. The measurement history. TRIGGER-WRITTEN ONLY.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goal_checkins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  -- The business day the measurement was recorded on. DATE for the same reason as the
  -- timeframe above; lib/crm.ts's businessDate() is the app-side equivalent.
  on_date       DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Chicago')::date,
  current_value NUMERIC(18, 4),
  confidence    TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  health        TEXT CHECK (health     IS NULL OR health     IN ('on_track', 'at_risk', 'off_track')),
  note          TEXT CHECK (note IS NULL OR length(note) <= 2000),
  -- Why this row exists at all: the first measurement, or a later change.
  kind          TEXT NOT NULL CHECK (kind IN ('opened', 'measured')),
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goal_checkins_goal ON public.goal_checkins(goal_id, created_at DESC);

COMMENT ON TABLE public.goal_checkins IS
  'Every recorded measurement of a goal, written by a trigger and by nothing else. '
  'authenticated holds SELECT and no other privilege: a history the application can write is '
  'a history that can be made to agree with whatever this quarter needs it to say.';

-- ---------------------------------------------------------------------------------------
-- 5. Triggers. NEW TABLES ONLY - nothing here fires on boards, tasks or profiles.
-- ---------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS touch_board_purpose ON public.board_purpose;
CREATE TRIGGER touch_board_purpose
  BEFORE UPDATE ON public.board_purpose
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP TRIGGER IF EXISTS touch_goals ON public.goals;
CREATE TRIGGER touch_goals
  BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

/**
 * The measurement ledger, and the carrier column that feeds it.
 *
 * ⚠️ THREE TRIGGERS, NOT ONE, because the timings genuinely differ - 103's lesson, caught
 * there by the migration's own post-conditions on the first run:
 *   BEFORE INSERT  may still edit NEW, but the goal row does not exist yet, so writing a
 *                  check-in here fails goal_checkins.goal_id's foreign key.
 *   AFTER INSERT   can write it, but can no longer edit NEW - which is why a note supplied
 *                  at creation is refused outright rather than accepted and silently kept.
 *   BEFORE UPDATE  does both in one pass, and is where the carrier actually earns its keep.
 *
 * ⚠️ NO `OF column` CLAUSE on the update trigger. 104: a trigger with one cannot police the
 * columns it does not fire on, so `UPDATE goals SET checkin_note = 'x'` alone would simply
 * store the value and the NEXT real measurement would stamp somebody else's sentence onto it.
 */
CREATE OR REPLACE FUNCTION private.enforce_goal_checkin_carrier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A note describes a CHANGE in the measurement. There is no change at creation, so
  -- accepting one here would mean storing a sentence that never reaches the ledger - the
  -- exact "present, believed, wired to nothing" defect this codebase keeps re-learning.
  IF NEW.checkin_note IS NOT NULL AND length(btrim(NEW.checkin_note)) > 0 THEN
    RAISE EXCEPTION 'A check-in note describes a change to a measurement, so it cannot be supplied when the goal is created. Create the goal, then record the first measurement.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.checkin_note := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_goal_checkin_carrier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_goal_checkin_carrier ON public.goals;
CREATE TRIGGER enforce_goal_checkin_carrier
  BEFORE INSERT ON public.goals
  FOR EACH ROW EXECUTE FUNCTION private.enforce_goal_checkin_carrier();

CREATE OR REPLACE FUNCTION private.open_goal_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only when there is something to measure. A qualitative goal opens no ledger, and an
  -- opening row of NULL would put a meaningless point on every chart.
  IF NEW.current_value IS NOT NULL OR NEW.confidence IS NOT NULL OR NEW.health IS NOT NULL THEN
    INSERT INTO public.goal_checkins (goal_id, current_value, confidence, health, note, kind, created_by)
    VALUES (NEW.id, NEW.current_value, NEW.confidence, NEW.health, NULL, 'opened', COALESCE(auth.uid(), NEW.created_by));
  END IF;
  RETURN NULL;  -- AFTER trigger; the return value is ignored.
END;
$$;

REVOKE ALL ON FUNCTION private.open_goal_checkin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS open_goal_checkin ON public.goals;
CREATE TRIGGER open_goal_checkin
  AFTER INSERT ON public.goals
  FOR EACH ROW EXECUTE FUNCTION private.open_goal_checkin();

CREATE OR REPLACE FUNCTION private.record_goal_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note TEXT := NULLIF(btrim(COALESCE(NEW.checkin_note, '')), '');
BEGIN
  -- ⚠️ The carrier is blanked on EVERY path out of this function, including the one that
  -- writes nothing. 104's defect was an early RETURN that skipped exactly this line, so a
  -- stale reason survived to be stamped onto the next real transition by a caller who had
  -- supplied none. Blank first, decide second.
  NEW.checkin_note := NULL;

  IF NEW.current_value IS DISTINCT FROM OLD.current_value
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.health     IS DISTINCT FROM OLD.health THEN
    INSERT INTO public.goal_checkins (goal_id, current_value, confidence, health, note, kind, created_by)
    VALUES (NEW.id, NEW.current_value, NEW.confidence, NEW.health, v_note, 'measured', auth.uid());
    RETURN NEW;
  END IF;

  -- Nothing measurable moved. A note with no measurement behind it is refused rather than
  -- dropped silently: the caller asked to record something and must be told it did not land.
  IF v_note IS NOT NULL THEN
    RAISE EXCEPTION 'A check-in note has to accompany a change to the value, confidence or health. Nothing measurable changed in this update.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.record_goal_checkin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS record_goal_checkin ON public.goals;
CREATE TRIGGER record_goal_checkin
  BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION private.record_goal_checkin();

-- ---------------------------------------------------------------------------------------
-- 6. Grants. ⚠️ Supabase default-grants a blanket ALL on every new table in public to anon
--    and authenticated (095's lesson, which bit appointments twice), so granting narrowly is
--    not enough - the wide grant is already there and has to be revoked first.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.board_purpose  FROM anon, authenticated;
REVOKE ALL ON public.goals          FROM anon, authenticated;
REVOKE ALL ON public.goal_links     FROM anon, authenticated;
REVOKE ALL ON public.goal_checkins  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_purpose TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals         TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.goal_links    TO authenticated;
-- SELECT and nothing else. This is the whole guarantee behind every outcome number.
GRANT SELECT ON public.goal_checkins TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 7. RLS.
--
-- Board scope is read through the CALLER'S OWN `boards` policy (119/123's pattern), never
-- through a SECURITY DEFINER bypass, so a private board's purpose is invisible to a
-- non-member without any policy here knowing what board privacy is.
--
-- ⚠️ Every write policy is narrower than or equal to the SELECT policy on the same table.
-- RLS applies the SELECT policy to an UPDATE's WHERE clause, so a write policy wider than
-- its SELECT policy silently matches zero rows - the trap 099 set for `columns`.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.board_purpose ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read purpose for boards you can see" ON public.board_purpose;
CREATE POLICY "Read purpose for boards you can see" ON public.board_purpose
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_purpose.board_id)
  );

-- Writing a board's purpose is the same tier as configuring the board: admin. Mirrors
-- board_agile_settings (123) rather than the boards UPDATE policy itself, because this is
-- board CONTENT like a column, not the board record - and a guest or client cannot reach it
-- either way, since neither can be an admin.
DROP POLICY IF EXISTS "Admins write purpose for boards they can see" ON public.board_purpose;
CREATE POLICY "Admins write purpose for boards they can see" ON public.board_purpose
  FOR ALL
  USING (
    private.is_admin_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_purpose.board_id)
  )
  WITH CHECK (
    private.is_admin_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_purpose.board_id)
  );

-- A goal is org furniture, like a status or a team: everyone signed in can read it, because
-- a goal nobody can see cannot align anybody.
DROP POLICY IF EXISTS "Everyone signed in reads goals" ON public.goals;
CREATE POLICY "Everyone signed in reads goals" ON public.goals
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins create goals" ON public.goals;
CREATE POLICY "Admins create goals" ON public.goals
  FOR INSERT WITH CHECK (private.is_admin_user());

-- ⚠️ The OWNER can update their own goal, deliberately wider than create/delete. Recording
-- this month's number is the single most frequent action on this table, and routing it
-- through an admin is how a goal's current value silently stops being current. It stays
-- narrower than SELECT, so the 099 trap does not apply.
DROP POLICY IF EXISTS "Admins and the owner update a goal" ON public.goals;
CREATE POLICY "Admins and the owner update a goal" ON public.goals
  FOR UPDATE
  USING (
    private.is_active_user()
    AND (private.is_admin_user() OR owner_id = auth.uid())
  )
  WITH CHECK (
    private.is_active_user()
    AND (private.is_admin_user() OR owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins delete goals" ON public.goals;
CREATE POLICY "Admins delete goals" ON public.goals
  FOR DELETE USING (private.is_admin_user());

-- Both ends readable, or the id of a task the caller cannot see leaks through the join -
-- 115's rule for task_relations, and 123's for sprint membership.
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

DROP POLICY IF EXISTS "Admins and goal owners unlink work" ON public.goal_links;
CREATE POLICY "Admins and goal owners unlink work" ON public.goal_links
  FOR DELETE USING (
    private.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.goals g
       WHERE g.id = goal_links.goal_id
         AND (private.is_admin_user() OR g.owner_id = auth.uid())
    )
  );

-- Read-only for everyone, and there is no INSERT/UPDATE/DELETE policy at all - not even for
-- an admin - because there is no grant behind one. Both halves are asserted below.
DROP POLICY IF EXISTS "Everyone signed in reads goal check-ins" ON public.goal_checkins;
CREATE POLICY "Everyone signed in reads goal check-ins" ON public.goal_checkins
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------------------
-- 8. The module row. Seeds DISABLED, like appointments (080), crm (103) and agile (123).
-- ---------------------------------------------------------------------------------------
INSERT INTO public.app_modules (module_key, enabled)
VALUES ('strategy', false)
ON CONFLICT (module_key) DO NOTHING;

-- ---------------------------------------------------------------------------------------
-- 9. Post-conditions. These TRY THE BAD WRITE wherever they can, because "the constraint
--    exists" and "the constraint refuses this" are different claims - 117's lesson, where a
--    CHECK silently passed on the empty array it had been written to reject.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_boards   BIGINT;
  v_tasks    BIGINT;
  v_profiles BIGINT;
  v_modules  BIGINT;
  v_goal     UUID;
  v_refused  BOOLEAN;
BEGIN
  SELECT board_rows, task_rows, profile_rows, module_rows
    INTO v_boards, v_tasks, v_profiles, v_modules FROM _129_precheck;

  IF (SELECT count(*) FROM public.boards)   <> v_boards   THEN RAISE EXCEPTION 'Board rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.tasks)    <> v_tasks    THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.profiles) <> v_profiles THEN RAISE EXCEPTION 'Profile rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.app_modules) <> v_modules + 1 THEN
    RAISE EXCEPTION 'Expected exactly one new app_modules row. Aborting.';
  END IF;

  IF (SELECT enabled FROM public.app_modules WHERE module_key = 'strategy') THEN
    RAISE EXCEPTION 'The strategy module seeded ENABLED. It must seed off. Aborting.';
  END IF;

  -- Nothing may exist yet. A purpose or a goal invented by a migration is a claim nobody made.
  IF (SELECT count(*) FROM public.board_purpose) <> 0 THEN RAISE EXCEPTION 'board_purpose seeded rows. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.goals)         <> 0 THEN RAISE EXCEPTION 'goals seeded rows. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.goal_links)    <> 0 THEN RAISE EXCEPTION 'goal_links seeded rows. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.goal_checkins) <> 0 THEN RAISE EXCEPTION 'goal_checkins seeded rows. Aborting.'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('board_purpose', 'goals', 'goal_links', 'goal_checkins')
       AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on every new table. Aborting.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('board_purpose', 'goals', 'goal_links', 'goal_checkins')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on a strategy table. Aborting.';
  END IF;

  -- The ledger guarantee, asserted rather than described: authenticated may read it and
  -- nothing else. If this ever fails, every outcome number in the product is unbacked.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'goal_checkins'
       AND grantee = 'authenticated' AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated holds more than SELECT on goal_checkins. Aborting.';
  END IF;

  -- goal_links is INSERT/DELETE only: editing which goal a link belongs to makes it a
  -- different link, so there is no UPDATE grant and no UPDATE policy (115's rule).
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'goal_links'
       AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated holds UPDATE on goal_links. Aborting.';
  END IF;

  -- ---- Behavioural assertions. Everything below runs as the migration role, so it proves
  -- ---- the TRIGGERS and CONSTRAINTS, which is what these are for; RLS is proved by
  -- ---- scripts/check-strategy.mjs against real sessions.
  INSERT INTO public.goals (title, metric, unit, start_value, current_value, target_value, confidence, health)
  VALUES ('_129 self-test', 'self test', 'x', 0, 10, 100, 'medium', 'on_track')
  RETURNING id INTO v_goal;

  IF (SELECT count(*) FROM public.goal_checkins WHERE goal_id = v_goal AND kind = 'opened') <> 1 THEN
    RAISE EXCEPTION 'Creating a measurable goal did not open its ledger. Aborting.';
  END IF;

  UPDATE public.goals SET current_value = 20, checkin_note = 'moved' WHERE id = v_goal;

  IF (SELECT count(*) FROM public.goal_checkins WHERE goal_id = v_goal) <> 2 THEN
    RAISE EXCEPTION 'Changing a measurement did not record a check-in. Aborting.';
  END IF;
  IF (SELECT note FROM public.goal_checkins WHERE goal_id = v_goal AND kind = 'measured') <> 'moved' THEN
    RAISE EXCEPTION 'The carrier note did not reach the check-in. Aborting.';
  END IF;
  IF (SELECT checkin_note FROM public.goals WHERE id = v_goal) IS NOT NULL THEN
    RAISE EXCEPTION 'checkin_note is not NULL at rest - 104 all over again. Aborting.';
  END IF;

  -- The carrier must not survive an update that measures nothing. This is 104's exact defect.
  v_refused := false;
  BEGIN
    UPDATE public.goals SET checkin_note = 'no-op note' WHERE id = v_goal;
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A note with no measurement behind it was accepted. Aborting.';
  END IF;
  IF (SELECT checkin_note FROM public.goals WHERE id = v_goal) IS NOT NULL THEN
    RAISE EXCEPTION 'A refused note was stored on the goal. Aborting.';
  END IF;

  -- A note at creation is refused rather than quietly dropped.
  v_refused := false;
  BEGIN
    INSERT INTO public.goals (title, checkin_note) VALUES ('_129 note at birth', 'nope');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A check-in note was accepted at creation. Aborting.';
  END IF;

  -- Exactly one end per link.
  v_refused := false;
  BEGIN
    INSERT INTO public.goal_links (goal_id) VALUES (v_goal);
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A goal link with no end was accepted. Aborting.';
  END IF;

  -- A goal that ends before it starts.
  v_refused := false;
  BEGIN
    INSERT INTO public.goals (title, starts_on, ends_on) VALUES ('_129 backwards', DATE '2026-12-01', DATE '2026-01-01');
  EXCEPTION WHEN check_violation THEN v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A goal ending before it starts was accepted. Aborting.';
  END IF;

  DELETE FROM public.goals WHERE id = v_goal;
  IF (SELECT count(*) FROM public.goal_checkins WHERE goal_id = v_goal) <> 0 THEN
    RAISE EXCEPTION 'Deleting a goal left its check-ins behind. Aborting.';
  END IF;

  IF (SELECT count(*) FROM public.goals) <> 0 THEN
    RAISE EXCEPTION 'Self-test goals survived. Aborting.';
  END IF;

  RAISE NOTICE '129 OK: purpose + goals installed, ledger is trigger-only, carrier blanks on every path.';
END;
$$;

COMMIT;
