-- 133: milestones - a dated commitment a project is judged against.
--
-- WHY THIS EXISTS
-- Prompt I opens "MILESTONES FIRST. Implement before advanced Gantt", and ATLAS_01's build
-- priority puts milestones/dependencies at rung 13 with timeline/Gantt at 14 behind a scope
-- decision. Two places in the repo have been waiting on this table by name:
--   * 129's goal_links header: "Milestones are a third column the day milestones exist."
--   * FEATURES.md: "milestone pressure" is one of My Work's two remaining honest gaps, listed
--     as "blocked on schema, deliberately not faked".
--
-- WHAT A MILESTONE IS, AND WHAT IT IS NOT
-- It is a DATE somebody is accountable for, not a container of work and not a goal. So:
--   * `due_date` is NOT NULL. A dateless milestone cannot appear on a timeline, which is the
--     entire reason it exists, and it would be a second object shaped like a goal (129) with
--     none of a goal's outcome machinery.
--   * `board_id` is NOT NULL. A milestone belongs to a project. Cross-project and portfolio
--     roll-ups come from boards.parent_board_id (118) and public.board_descendants, which
--     already answer that question - a nullable board_id would be a second hierarchy.
--
-- ⚠️ THERE IS NO `progress` COLUMN, AND THAT IS PROMPT H'S RULE APPLIED AGAIN.
-- Prompt I lists "progress" as a milestone field. 129 already settled how this repo stores a
-- progress figure: execution progress is COMPUTED from tasks at read time and never stored,
-- because a stored copy of a derived fact is a copy that can be set to disagree with it. A
-- milestone's progress is exactly that shape - "how much of the linked work is done" - so
-- lib/milestones.ts computes it and returns NULL, never 0, when nothing is linked.
--
-- ⚠️ `state` IS A DECISION; BEING LATE IS A FACT. THEY ARE DIFFERENT COLUMNS' WORTH OF IDEA.
-- 'open' | 'reached' | 'missed' | 'cancelled' are things a person declares. Whether an OPEN
-- milestone is overdue is derived from due_date and today, and is never stored, so the two can
-- never disagree. This is 130's rejected-versus-parked distinction: closing something with a
-- judgement and closing it because time passed are not the same event, and flattening them
-- loses the half you need six months later.
--
-- ⚠️ MISSING OR CANCELLING ONE NEEDS A REASON, ENFORCED BY THE TRIGGER, NOT THE DIALOG.
-- 128's rule for owner decisions and 130's for rejected ideas, and 104 is why it is in the
-- trigger: crm_statuses.requires_reason was honoured by one screen and by nothing underneath
-- it, so a cancel written by an import recorded no reason at all. A slipped date whose reason
-- was never written down is indistinguishable from one nobody noticed.
--
-- ⚠️ `milestone_tasks` IS A COLUMN IN DISGUISE, DELIBERATELY, AND 127 IS THE REASON.
-- UNIQUE (task_id) means a task belongs to at most one milestone, which is exactly the
-- semantics of a `tasks.milestone_id` column. It is a table instead because the rule that
-- matters - a task's milestone must be on the task's own board - has to be enforced by a
-- trigger, and 125/127 is this repo's clearest recorded lesson about where a trigger may live:
-- the same rule on `tasks` costs an owner override and is not --allow-prod eligible, while on
-- a table this migration creates it ships on the standing rule. Same enforcement, one file.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: two NEW tables, triggers on NEW TABLES ONLY, no seeded rows. No existing table,
-- row, policy, grant or trigger is touched, so no write path that already happens passes
-- through anything here. Eligible on this repo's own rule.
-- Rollback: scripts/rollback/133_revert.sql (destroys every milestone and its work links;
-- the tasks themselves are untouched).

BEGIN;

-- ---------------------------------------------------------------------------------------
-- Pre-check: capture what must not move
-- ---------------------------------------------------------------------------------------
DROP TABLE IF EXISTS _133_precheck;
CREATE TEMP TABLE _133_precheck AS
SELECT
  (SELECT count(*) FROM public.tasks)   AS task_rows,
  (SELECT count(*) FROM public.boards)  AS board_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal) AS task_triggers;

-- ---------------------------------------------------------------------------------------
-- milestones
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.milestones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id          UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,

  -- Deprovisioning decided here rather than discovered later (119's lesson). A milestone is
  -- project furniture that outlives whoever owned it, so deleting a person must not destroy
  -- it (CASCADE) and must not make it claim somebody else committed to the date (reassign).
  -- SET NULL keeps the record and drops only the attribution. The delete-user route needs no
  -- change for this table, and check-milestones.mjs pins that.
  owner_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  due_date          DATE NOT NULL,

  state             TEXT NOT NULL DEFAULT 'open',
  -- The reason a date was missed or a commitment dropped. Required for those two states by
  -- private.enforce_milestone_state; always NULL while the milestone is open or reached.
  state_note        TEXT,
  state_changed_at  TIMESTAMPTZ,
  state_changed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reached_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT milestones_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT milestones_state_known
    CHECK (state IN ('open', 'reached', 'missed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_milestones_board ON public.milestones(board_id, due_date);
CREATE INDEX IF NOT EXISTS idx_milestones_owner ON public.milestones(owner_id)
  WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_milestones_open ON public.milestones(due_date)
  WHERE state = 'open';

COMMENT ON TABLE public.milestones IS
  'A dated commitment on one board. Progress is NEVER stored here - it is computed from the '
  'linked work at read time (129''s rule). Being overdue is likewise derived from due_date, '
  'so a milestone can never be marked late and not be late.';
COMMENT ON COLUMN public.milestones.state IS
  'A human decision: open | reached | missed | cancelled. Whether an OPEN milestone is late is '
  'derived from due_date and today, deliberately not stored.';
COMMENT ON COLUMN public.milestones.state_note IS
  'Why the date was missed or the commitment dropped. Required for those two states by the '
  'trigger rather than by the dialog - 104''s lesson.';

-- ---------------------------------------------------------------------------------------
-- milestone_tasks - the "related work" link
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.milestone_tasks (
  milestone_id  UUID NOT NULL REFERENCES public.milestones(id) ON DELETE CASCADE,
  -- CASCADE on the task: the link is meaningless without its work item, and deleting the
  -- link destroys nothing anyone wrote. Deleting the MILESTONE never touches the task.
  task_id       UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  added_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (milestone_id, task_id),
  -- One milestone per task. This is what makes the table equivalent to a tasks.milestone_id
  -- column; see the header for why it is a table anyway.
  CONSTRAINT milestone_tasks_one_per_task UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS idx_milestone_tasks_task ON public.milestone_tasks(task_id);

COMMENT ON TABLE public.milestone_tasks IS
  'Work delivering a milestone. UNIQUE(task_id) makes this a tasks.milestone_id column in all '
  'but storage; it is a table so the same-board rule can be a trigger on a NEW table (125/127).';

-- ---------------------------------------------------------------------------------------
-- Triggers, on the new tables only
-- ---------------------------------------------------------------------------------------

-- ⚠️ `btrim(x) = ''` IS NOT "is this blank". Postgres's one-argument btrim strips SPACES and
-- nothing else, so a reason of E'\t\n' sails straight through it while JavaScript's `.trim()`
-- rejects the same string - and the whole point of requiring a reason is defeated by a reason
-- made of a tab. Found by the parity harness (scripts/check-milestones.mjs) running
-- lib/milestones.cases.mjs against this trigger, NOT by reading the SQL, which is exactly what
-- that gate exists for: the TypeScript mirror and this trigger disagreed on their very first
-- run, in the direction where the database was the looser of the two.
--
-- One helper rather than three inline copies, because 109 records what a rule expressed in
-- three places costs when a fourth case is added later. No GRANT/REVOKE pair is needed: it is
-- called only by a trigger function, never by a POLICY, and 132's "permission denied for
-- function" was the cost of confusing those two.
CREATE OR REPLACE FUNCTION private.is_blank(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$ SELECT COALESCE(p_text, '') !~ '[^[:space:]]' $$;

COMMENT ON FUNCTION private.is_blank(TEXT) IS
  'NULL, empty, or nothing but whitespace. Matches JavaScript trim() closely enough that the '
  'dialog and the trigger agree; btrim() does not, because it only strips spaces.';

-- State transitions. No `OF column` clause anywhere: 104's defect was a trigger registered
-- BEFORE UPDATE OF status that never fired on an UPDATE touching only the carrier columns,
-- so their values were simply stored and stamped onto the NEXT real transition.
CREATE OR REPLACE FUNCTION private.enforce_milestone_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A milestone may legitimately be entered already reached or already missed (importing
    -- last quarter's plan), so the note requirement applies here too, but the stamps are
    -- honoured as supplied so a real historical date can be recorded.
    IF NEW.state IN ('missed', 'cancelled') AND private.is_blank(NEW.state_note) THEN
      RAISE EXCEPTION
        'Recording a milestone as % needs a reason. Six months from now the note is the only '
        'record of why the date moved.', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.state IN ('open', 'reached') THEN
      NEW.state_note := NULL;
    END IF;

    IF NEW.state = 'reached' THEN
      NEW.reached_at := COALESCE(NEW.reached_at, now());
    ELSE
      NEW.reached_at := NULL;
    END IF;

    IF NEW.state <> 'open' THEN
      NEW.state_changed_at := COALESCE(NEW.state_changed_at, now());
      NEW.state_changed_by := COALESCE(NEW.state_changed_by, auth.uid());
    END IF;

    RETURN NEW;
  END IF;

  NEW.updated_at := now();

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state IN ('missed', 'cancelled') AND private.is_blank(NEW.state_note) THEN
      RAISE EXCEPTION
        'Recording a milestone as % needs a reason. Six months from now the note is the only '
        'record of why the date moved.', NEW.state
        USING ERRCODE = 'check_violation';
    END IF;

    -- Reopening clears the whole outcome together, so a reopened milestone never carries a
    -- reason, a resolver or a reached date that is no longer true. 128 does exactly this for
    -- owner decisions, and 103's carrier lesson is the same shape: every path clears.
    IF NEW.state = 'open' THEN
      NEW.state_note       := NULL;
      NEW.reached_at       := NULL;
      NEW.state_changed_at := NULL;
      NEW.state_changed_by := NULL;
      RETURN NEW;
    END IF;

    IF NEW.state = 'reached' THEN
      NEW.state_note := NULL;
      NEW.reached_at := now();
    ELSE
      NEW.reached_at := NULL;
    END IF;

    -- Stamped, never supplied, so the record cannot be made to say somebody else made a call
    -- they did not make. 128's asymmetry: honoured on INSERT, imposed on UPDATE.
    NEW.state_changed_at := now();
    NEW.state_changed_by := auth.uid();
    RETURN NEW;
  END IF;

  -- The state did not change, so nothing may quietly rewrite its outcome alongside an
  -- ordinary edit. Keeping the stamps is what stops a title edit from re-dating a decision.
  NEW.reached_at       := OLD.reached_at;
  NEW.state_changed_at := OLD.state_changed_at;
  NEW.state_changed_by := OLD.state_changed_by;
  IF NEW.state IN ('open', 'reached') THEN
    NEW.state_note := NULL;
  ELSE
    -- An unchanged closed state may have its reason corrected, but never blanked.
    IF private.is_blank(NEW.state_note) THEN
      NEW.state_note := OLD.state_note;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- No GRANT/REVOKE pair here: a trigger function is invoked by the trigger machinery, not
-- called by the user, so no EXECUTE check happens against the caller. The opposite is true of
-- a function an RLS POLICY calls - 132 shipped a REVOKE on one of those and every note edit
-- then failed with "permission denied for function" for everybody.
REVOKE ALL ON FUNCTION private.enforce_milestone_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_milestone_state ON public.milestones;
CREATE TRIGGER enforce_milestone_state
  BEFORE INSERT OR UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION private.enforce_milestone_state();

-- A task's milestone must be on the task's own board. Without this, a milestone on the
-- marketing board could carry contracting work and every roll-up on both boards would be
-- wrong with nothing on screen admitting it.
CREATE OR REPLACE FUNCTION private.enforce_milestone_task_board()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_board      UUID;
  v_milestone_board UUID;
BEGIN
  SELECT c.board_id INTO v_task_board
  FROM public.tasks t JOIN public.columns c ON c.id = t.column_id
  WHERE t.id = NEW.task_id;

  SELECT m.board_id INTO v_milestone_board
  FROM public.milestones m WHERE m.id = NEW.milestone_id;

  IF v_task_board IS NULL OR v_milestone_board IS NULL THEN
    RAISE EXCEPTION 'Cannot link work to a milestone: one end no longer exists.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_task_board <> v_milestone_board THEN
    RAISE EXCEPTION
      'That work item is on a different board from this milestone. Move the work, or make a '
      'milestone on its own board.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.enforce_milestone_task_board() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_milestone_task_board ON public.milestone_tasks;
CREATE TRIGGER enforce_milestone_task_board
  BEFORE INSERT OR UPDATE ON public.milestone_tasks
  FOR EACH ROW EXECUTE FUNCTION private.enforce_milestone_task_board();

-- ---------------------------------------------------------------------------------------
-- Grants, then RLS
-- ---------------------------------------------------------------------------------------
-- Supabase default-grants ALL on every new table in public to anon and authenticated, so
-- granting narrowly is not enough: the wide grant is already there (090's lesson).
REVOKE ALL ON public.milestones      FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.milestone_tasks FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestones      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.milestone_tasks TO authenticated;

ALTER TABLE public.milestones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_tasks ENABLE ROW LEVEL SECURITY;

-- Reading follows the board, through the caller's own boards policy. A private board's
-- milestones are invisible to a non-member for free, without this policy needing to know
-- anything about board privacy - 119's reasoning, and 109 records what happens when the same
-- privacy rule ends up copied into three places.
DROP POLICY IF EXISTS "Read milestones for boards you can see" ON public.milestones;
CREATE POLICY "Read milestones for boards you can see" ON public.milestones
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = milestones.board_id)
  );

-- Writing is the board-configuration tier: admin, mirroring board_purpose (129) and
-- board_agile_settings (123). A guest or client cannot reach it either way, since neither
-- can be an admin - so this needs no board_members term of its own.
DROP POLICY IF EXISTS "Admins manage milestones on boards they can see" ON public.milestones;
CREATE POLICY "Admins manage milestones on boards they can see" ON public.milestones
  FOR ALL
  USING (
    private.is_admin_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = milestones.board_id)
  )
  WITH CHECK (
    private.is_admin_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = milestones.board_id)
  );

-- ⚠️ The OWNER may update their own milestone, deliberately wider than create/delete, and for
-- the same reason 129 gave a goal's owner that ability: declaring the date reached is the most
-- frequent action on this table, and routing it through an admin is how a plan silently stops
-- being current. It stays NARROWER than SELECT, so 099's trap (a SELECT policy narrower than
-- the UPDATE policy silently matching zero rows) does not apply.
DROP POLICY IF EXISTS "The owner updates their own milestone" ON public.milestones;
CREATE POLICY "The owner updates their own milestone" ON public.milestones
  FOR UPDATE
  USING (
    private.is_active_user()
    AND owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = milestones.board_id)
  )
  WITH CHECK (
    private.is_active_user()
    AND owner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = milestones.board_id)
  );

-- Both ends readable, or the id of a task the caller cannot see leaks through the join.
-- 115's rule for task_relations, 123's for sprint membership, 129's for goal links.
DROP POLICY IF EXISTS "Read milestone work you can see both ends of" ON public.milestone_tasks;
CREATE POLICY "Read milestone work you can see both ends of" ON public.milestone_tasks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = milestone_tasks.milestone_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = milestone_tasks.task_id
         AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

-- Linking work needs the right to manage that work, not merely to see it. A guest or client
-- can view a board's tasks and cannot write them (065), and putting a task into a plan is a
-- statement about the task.
DROP POLICY IF EXISTS "Manage milestone work you can manage" ON public.milestone_tasks;
CREATE POLICY "Manage milestone work you can manage" ON public.milestone_tasks
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = milestone_tasks.milestone_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = milestone_tasks.task_id
         AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.milestones m WHERE m.id = milestone_tasks.milestone_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = milestone_tasks.task_id
         AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

-- ---------------------------------------------------------------------------------------
-- Post-conditions. "The trigger exists" and "the trigger refuses this" are different claims
-- (117's lesson), so every rule below is exercised rather than asserted.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks    BIGINT;
  v_before_boards   BIGINT;
  v_before_policies BIGINT;
  v_before_ttrig    BIGINT;
  v_count           BIGINT;
  v_board           UUID;
  v_other_board     UUID;
  v_col             UUID;
  v_other_col       UUID;
  v_task            UUID;
  v_other_task      UUID;
  v_person          UUID;
  v_ms              UUID;
  v_qual            TEXT;
BEGIN
  SELECT task_rows, board_rows, policy_rows, task_triggers
    INTO v_before_tasks, v_before_boards, v_before_policies, v_before_ttrig
    FROM _133_precheck;

  SELECT count(*) INTO v_count FROM public.tasks;
  IF v_count IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed (% -> %). Aborting.', v_before_tasks, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.boards;
  IF v_count IS DISTINCT FROM v_before_boards THEN
    RAISE EXCEPTION 'boards row count changed (% -> %). Aborting.', v_before_boards, v_count;
  END IF;

  -- The eligibility claim in the header, checked rather than asserted: this migration must
  -- not have put a trigger on `tasks`. That is the whole difference between 127 and 125.
  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid = 'public.tasks'::regclass AND NOT tgisinternal;
  IF v_count IS DISTINCT FROM v_before_ttrig THEN
    RAISE EXCEPTION
      'This migration added a trigger to `tasks` (% -> %). It claims to be --allow-prod '
      'eligible and would not be. Aborting.', v_before_ttrig, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies + 5 THEN
    RAISE EXCEPTION 'Expected % policies after adding 5, found %. Aborting.',
      v_before_policies + 5, v_count;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.milestones'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.milestone_tasks'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on both new tables. Aborting.';
  END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('milestones', 'milestone_tasks')
    AND grantee = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on the new tables. Aborting.', v_count;
  END IF;

  -- The owner-update policy must stay narrower than SELECT, or 099's trap applies: a write
  -- the policy allows would match zero rows because the row cannot be read.
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'milestones' AND cmd = 'SELECT';
  IF v_qual LIKE '%owner_id%' THEN
    RAISE EXCEPTION
      'The milestones SELECT policy narrowed to the owner. Every UPDATE by an admin would then '
      'match zero rows (099). Aborting.';
  END IF;

  -- Exercise the rules against real rows, then roll every fixture back out.
  SELECT c.board_id, c.id, t.id INTO v_board, v_col, v_task
  FROM public.tasks t JOIN public.columns c ON c.id = t.column_id
  WHERE t.archived_at IS NULL AND t.deleted_at IS NULL
  LIMIT 1;

  SELECT id INTO v_person FROM public.profiles ORDER BY created_at LIMIT 1;

  IF v_board IS NOT NULL THEN
    INSERT INTO public.milestones (board_id, title, due_date, created_by)
    VALUES (v_board, '_133_probe', CURRENT_DATE, v_person)
    RETURNING id INTO v_ms;

    -- A blank title must be refused.
    BEGIN
      INSERT INTO public.milestones (board_id, title, due_date)
      VALUES (v_board, '   ', CURRENT_DATE);
      RAISE EXCEPTION 'A blank milestone title was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Missing or cancelling without a reason must be refused, on INSERT and on UPDATE.
    BEGIN
      INSERT INTO public.milestones (board_id, title, due_date, state)
      VALUES (v_board, '_133_probe_noreason', CURRENT_DATE, 'missed');
      RAISE EXCEPTION 'A missed milestone was accepted with no reason. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      UPDATE public.milestones SET state = 'cancelled' WHERE id = v_ms;
      RAISE EXCEPTION 'A cancelled milestone was accepted with no reason. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- ⚠️ The one btrim() would let through. A reason made of a tab and a newline is not a
    -- reason, and the first version of this trigger accepted it.
    BEGIN
      UPDATE public.milestones
         SET state = 'cancelled', state_note = E'\t\n  ' WHERE id = v_ms;
      RAISE EXCEPTION 'A whitespace-only reason was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And a good one must be accepted, or the guard is simply refusing everything.
    UPDATE public.milestones
       SET state = 'missed', state_note = 'permit expired'
     WHERE id = v_ms;
    IF NOT EXISTS (
      SELECT 1 FROM public.milestones
      WHERE id = v_ms AND state = 'missed' AND state_changed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'A missed milestone with a reason was not stamped. Aborting.';
    END IF;

    -- Reopening must clear the whole outcome together, not leave a stale reason behind.
    UPDATE public.milestones SET state = 'open' WHERE id = v_ms;
    IF EXISTS (
      SELECT 1 FROM public.milestones
      WHERE id = v_ms
        AND (state_note IS NOT NULL OR reached_at IS NOT NULL
             OR state_changed_at IS NOT NULL OR state_changed_by IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'Reopening left an outcome behind. Aborting.';
    END IF;

    -- Reaching one stamps reached_at without being asked.
    UPDATE public.milestones SET state = 'reached' WHERE id = v_ms;
    IF NOT EXISTS (SELECT 1 FROM public.milestones WHERE id = v_ms AND reached_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Reaching a milestone did not stamp reached_at. Aborting.';
    END IF;

    -- An ordinary edit must not re-date the decision.
    UPDATE public.milestones SET title = '_133_probe_renamed' WHERE id = v_ms;
    IF EXISTS (
      SELECT 1 FROM public.milestones m, _133_precheck
      WHERE m.id = v_ms AND m.reached_at IS NULL
    ) THEN
      RAISE EXCEPTION 'A title edit cleared the reached stamp. Aborting.';
    END IF;

    -- Linking work on the same board is accepted; a different board is refused.
    IF v_task IS NOT NULL THEN
      INSERT INTO public.milestone_tasks (milestone_id, task_id) VALUES (v_ms, v_task);

      SELECT t.id INTO v_other_task
      FROM public.tasks t JOIN public.columns c ON c.id = t.column_id
      WHERE c.board_id <> v_board LIMIT 1;

      IF v_other_task IS NOT NULL THEN
        BEGIN
          INSERT INTO public.milestone_tasks (milestone_id, task_id) VALUES (v_ms, v_other_task);
          RAISE EXCEPTION 'Work from another board was linked to this milestone. Aborting.';
        EXCEPTION WHEN check_violation THEN NULL;
        END;
      ELSE
        RAISE NOTICE
          '133: no second board with work, so the cross-board refusal was not exercised here. '
          'pnpm check:milestones covers it against real RLS.';
      END IF;

      -- One milestone per task.
      DECLARE v_ms2 UUID;
      BEGIN
        INSERT INTO public.milestones (board_id, title, due_date)
        VALUES (v_board, '_133_probe_two', CURRENT_DATE) RETURNING id INTO v_ms2;
        BEGIN
          INSERT INTO public.milestone_tasks (milestone_id, task_id) VALUES (v_ms2, v_task);
          RAISE EXCEPTION 'A task was linked to two milestones. Aborting.';
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
        DELETE FROM public.milestones WHERE id = v_ms2;
      END;
    END IF;

    DELETE FROM public.milestones WHERE title LIKE '\_133\_probe%';
  ELSE
    RAISE NOTICE '133: no board with work found, so the probes were skipped on this database.';
  END IF;

  SELECT count(*) INTO v_count FROM public.milestones;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 seeded milestones, found %. Aborting.', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks;
  IF v_count IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed during the probes (% -> %). Aborting.',
      v_before_tasks, v_count;
  END IF;

  RAISE NOTICE
    '133 verified: milestones + milestone_tasks, 5 policies, 0 triggers added to tasks, '
    'reason required, reopen clears, one milestone per task, cross-board refused.';
END $$;

COMMIT;
