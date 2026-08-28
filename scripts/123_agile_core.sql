-- 123: optional Agile mode - per-board settings, sprints/cycles, sprint membership,
--      an estimate on the canonical work item, and a WIP limit on a column.
--
-- WHY THIS EXISTS
-- Prompt G's first line is "this module must be optional", and its strongest architectural
-- requirement is the one Taiga gets right: "the same underlying item can be represented in
-- Scrum and Kanban - never copy the task to make it appear in a second methodology." So there
-- is no `sprint_tasks` table holding a COPY of anything and no second work-item engine. A
-- sprint is a named window; membership is a join row pointing at the one canonical task; every
-- board, list, table, calendar, saved view, My Work section and report keeps reading exactly
-- the rows it already read.
--
-- WHAT IS OPTIONAL, AND AT HOW MANY LEVELS
--   1. `app_modules.agile` seeds DISABLED, like appointments (080) and crm (103). Nothing
--      appears in anyone's nav until a super admin switches it on.
--   2. `board_agile_settings.is_enabled` seeds nothing at all - agile is per board, opt-in,
--      so marketing/contracting/real-estate/finance/operations boards never see the word
--      "sprint". A board with no settings row is a board with agile off; that is why the row
--      is created on demand rather than backfilled.
--   3. `terminology` picks the noun the UI uses. One underlying model, three labels.
--
-- WHY is_agile_eligible FINALLY GETS A CONSUMER
-- 113 seeded `work_item_types.is_agile_eligible` and nothing has ever read it - this repo's
-- most-repeated defect, a column that is present and believed and wired to nothing. The
-- membership trigger below is its first real reader: a `subtask` (is_agile_eligible = false)
-- cannot be put in a sprint on its own, because it is already carried by its parent and
-- counting both double-counts every estimate in the burndown.
--
-- THE LEDGER RULE
-- "Historical sprint data must not silently change when current project structure changes."
-- That is answered in three places, and only one of them is here: `sprint_items` records WHEN
-- a task joined and whether it was there before the sprint started (`committed`), and its
-- immutable fields are protected by a trigger rather than by everyone remembering not to write
-- them. 124 adds the frozen end-of-sprint snapshot and the daily burndown samples, which is
-- what makes a completed sprint's numbers survive a later re-estimate, re-status or reorg.
--
-- SAFETY / --allow-prod ELIGIBILITY
-- Additive: three NEW tables, two new columns with their own CHECKs (each validated against a
-- column that is NULL in every existing row, so neither can fail on any data that exists), one
-- app_modules row, and triggers on NEW TABLES ONLY. No existing table, row, policy, grant or
-- trigger is touched. That makes it --allow-prod eligible on this repo's own rule, and because
-- both modules seed off it changes nothing anyone can see until someone opts in.
-- ⚠️ 125 (the WIP ENFORCEMENT trigger) puts a trigger on `tasks` and is deliberately a
-- separate file for exactly that reason. It is NOT eligible. Do not apply the two together.
-- Rollback: scripts/rollback/123_revert.sql (destroys every sprint and its membership).

BEGIN;

CREATE TEMP TABLE _123_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)             AS task_rows,
  (SELECT count(*) FROM public.boards)            AS board_rows,
  (SELECT count(*) FROM public.columns)           AS column_rows,
  (SELECT count(*) FROM public.task_statuses)     AS status_rows,
  (SELECT count(*) FROM public.work_item_types)   AS type_rows,
  (SELECT count(*) FROM public.app_modules)       AS module_rows;

-- ---------------------------------------------------------------------------------------
-- 1. Per-board settings. A board with no row here has agile OFF.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_agile_settings (
  board_id     UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  is_enabled   BOOLEAN NOT NULL DEFAULT false,
  -- One model, three nouns. Prompt G: "UI terminology is project-configurable."
  terminology  TEXT NOT NULL DEFAULT 'sprint'
               CHECK (terminology IN ('sprint', 'cycle', 'iteration')),
  -- The estimate column on tasks is deliberately UNIT-FREE (`estimate_value`), because a
  -- column called estimate_hours that a board configures as points is a name that lies.
  -- The unit lives here, next to the board whose sprints are summed in it.
  estimate_unit TEXT NOT NULL DEFAULT 'points'
               CHECK (estimate_unit IN ('points', 'hours', 'days')),
  -- Prompt G: "Warn when over capacity. Do not block by default unless configured."
  capacity_mode TEXT NOT NULL DEFAULT 'warning'
               CHECK (capacity_mode IN ('warning', 'enforcement')),
  -- Prompt G's WIP section, same two modes. Enforcement is only real once 125 is applied;
  -- until then this column is honoured by the UI alone, and the settings screen says so
  -- rather than offering a switch that silently does nothing.
  wip_mode      TEXT NOT NULL DEFAULT 'warning'
               CHECK (wip_mode IN ('warning', 'enforcement')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.board_agile_settings IS
  'Per-board agile opt-in and vocabulary. Absence of a row means agile is off for that board.';

-- ---------------------------------------------------------------------------------------
-- 2. The sprint / cycle itself.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  goal        TEXT CHECK (goal IS NULL OR length(goal) <= 2000),
  -- ⚠️ DATE, not TIMESTAMPTZ, and that is deliberate after this repo's five-and-counting
  -- due-date bugs: a sprint starts on a DAY, not at an instant, so it must never be parsed
  -- into one. lib/agile.ts compares these as calendar strings and never calls new Date() on
  -- them. See CLAUDE.md's tasks.due_date section for why the opposite choice cost so much.
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  owner_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  state       TEXT NOT NULL DEFAULT 'planned'
              CHECK (state IN ('planned', 'active', 'completed', 'cancelled')),
  -- NULL means "no capacity declared", which is different from zero. A capacity of zero would
  -- make every sprint over capacity from its first item.
  capacity    NUMERIC(10, 2) CHECK (capacity IS NULL OR capacity > 0),
  activated_at TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sprints_dates_ordered CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_sprints_board ON public.sprints(board_id, start_date DESC);

-- One active sprint per board. Two simultaneously active sprints make "the current
-- commitment" ambiguous, which is the one number sprint planning exists to show.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_one_active_per_board
  ON public.sprints(board_id) WHERE state = 'active';

COMMENT ON TABLE public.sprints IS
  'A sprint/cycle/iteration - one underlying model, the noun chosen per board in '
  'board_agile_settings.terminology. Scoped to a board; a task can be in one live sprint.';

-- ---------------------------------------------------------------------------------------
-- 3. Membership - a pointer to the canonical task, plus the facts a metric needs later.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sprint_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id  UUID NOT NULL REFERENCES public.sprints(id) ON DELETE CASCADE,
  task_id    UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- TRUE when the item was in the sprint at the moment it was activated. This is the whole
  -- of "committed vs scope added" and it is stamped by the trigger, never by the client -
  -- a caller that can set its own commitment flag can make any sprint look fully delivered.
  committed  BOOLEAN NOT NULL DEFAULT false,
  -- The estimate AS IT WAS when the item joined. Re-estimating a task afterwards must not
  -- silently rewrite what the team committed to.
  estimate_at_commit NUMERIC(10, 2),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Kept across a re-add, so churn stays visible even though removed_at is cleared.
  removed_count INTEGER NOT NULL DEFAULT 0 CHECK (removed_count >= 0),
  CONSTRAINT sprint_items_unique UNIQUE (sprint_id, task_id)
);

-- A task belongs to at most ONE live sprint. Removed rows stay, so the history survives.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_items_one_live_sprint
  ON public.sprint_items(task_id) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sprint_items_sprint ON public.sprint_items(sprint_id);

COMMENT ON TABLE public.sprint_items IS
  'Sprint membership. NOT a copy of the task - one row pointing at the canonical work item, '
  'plus the commitment facts a sprint metric cannot reconstruct after the fact.';

-- ---------------------------------------------------------------------------------------
-- 4. The estimate, on the canonical work item.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS estimate_value NUMERIC(10, 2)
    CONSTRAINT tasks_estimate_value_nonneg CHECK (estimate_value IS NULL OR estimate_value >= 0);

COMMENT ON COLUMN public.tasks.estimate_value IS
  'Size of this work item. Deliberately unit-free: the unit is board_agile_settings.'
  'estimate_unit (points|hours|days), so a board can change vocabulary without a data '
  'migration and no column name can contradict the configuration. NULL means unestimated, '
  'which is a fact sprint planning must show rather than treat as zero.';

-- ---------------------------------------------------------------------------------------
-- 5. The WIP limit, on the column it constrains.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.columns
  ADD COLUMN IF NOT EXISTS wip_limit INTEGER
    CONSTRAINT columns_wip_limit_positive CHECK (wip_limit IS NULL OR wip_limit > 0);

COMMENT ON COLUMN public.columns.wip_limit IS
  'Maximum live work items allowed in this column, or NULL for no limit. Whether exceeding '
  'it warns or refuses is board_agile_settings.wip_mode. ⚠️ Enforcement is only real once '
  'migration 125 (the trigger on tasks) is applied - until then this is honoured by the UI '
  'alone and the settings screen must say so.';

-- ---------------------------------------------------------------------------------------
-- 6. Triggers. NEW TABLES ONLY - nothing here fires on tasks, boards or columns.
-- ---------------------------------------------------------------------------------------

-- Settings: touch updated_at (private.touch_updated_at already exists, 047-era).
DROP TRIGGER IF EXISTS touch_board_agile_settings ON public.board_agile_settings;
CREATE TRIGGER touch_board_agile_settings
  BEFORE UPDATE ON public.board_agile_settings
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

DROP TRIGGER IF EXISTS touch_sprints ON public.sprints;
CREATE TRIGGER touch_sprints
  BEFORE UPDATE ON public.sprints
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

/**
 * Sprint state machine.
 *
 * Stamps activated_at / closed_at itself rather than trusting a client to, and refuses the
 * transitions that would rewrite history: a completed or cancelled sprint cannot be reopened,
 * renamed into a different window, or re-dated. Everything a burndown, a velocity average or
 * a carryover count is built on has to still mean what it meant.
 */
CREATE OR REPLACE FUNCTION private.enforce_sprint_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'active'    THEN NEW.activated_at := COALESCE(NEW.activated_at, now()); END IF;
    IF NEW.state IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'A sprint cannot be created already closed. Create it planned, then close it.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE from here down.
  IF OLD.state IN ('completed', 'cancelled') THEN
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION 'Sprint "%" is % and cannot be reopened. Its recorded metrics describe a window that has closed.',
        OLD.title, OLD.state USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.board_id IS DISTINCT FROM OLD.board_id THEN
      RAISE EXCEPTION 'The dates and board of a closed sprint cannot change - every recorded metric is scoped to them.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.board_id IS DISTINCT FROM OLD.board_id AND EXISTS (
    SELECT 1 FROM public.sprint_items si WHERE si.sprint_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'A sprint that already holds work cannot be moved to another board.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state = 'active' AND OLD.state <> 'active' THEN
    NEW.activated_at := COALESCE(NEW.activated_at, now());
    -- Everything still in the sprint at activation IS the commitment. Stamped here, in the
    -- same transaction as the transition, so no client can decide it afterwards - and work
    -- that joined and left again before the start is deliberately NOT stamped, because it was
    -- never in the commitment.
    --
    -- ⚠️ The transaction-local GUC is what lets this write past the ledger's own immutability
    -- rule. enforce_sprint_item_integrity refuses ANY change to `committed`, which is the
    -- whole point of the column - and that includes this statement, since a trigger cannot
    -- tell one UPDATE from another. The flag names the sprint being activated, is set with
    -- is_local = true so it dies with the transaction, and is cleared immediately after. A
    -- client has no way to set it: PostgREST executes no arbitrary SQL and exposes no RPC
    -- that would. If one is ever added, this is the thing it must not be able to touch.
    PERFORM set_config('agile.commitment_stamp', NEW.id::text, true);
    UPDATE public.sprint_items
       SET committed = true
     WHERE sprint_id = NEW.id AND removed_at IS NULL AND NOT committed;
    PERFORM set_config('agile.commitment_stamp', '', true);
  END IF;

  IF NEW.state IN ('completed', 'cancelled') AND OLD.state NOT IN ('completed', 'cancelled') THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_sprint_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_sprint_state ON public.sprints;
CREATE TRIGGER enforce_sprint_state
  BEFORE INSERT OR UPDATE ON public.sprints
  FOR EACH ROW EXECUTE FUNCTION private.enforce_sprint_state();

/**
 * Membership integrity, and the immutability of the ledger fields.
 *
 * ⚠️ The trigger is BEFORE INSERT OR UPDATE with NO `OF column` clause, on purpose. 104's
 * lesson: a trigger with an OF list cannot police the columns it does not fire on, and every
 * field this protects (committed, added_at, estimate_at_commit) is exactly the kind a caller
 * would try to set directly.
 */
CREATE OR REPLACE FUNCTION private.enforce_sprint_item_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sprint_board   UUID;
  v_sprint_state   TEXT;
  v_task_board     UUID;
  v_type_key       TEXT;
  v_agile_eligible BOOLEAN;
BEGIN
  SELECT s.board_id, s.state INTO v_sprint_board, v_sprint_state
    FROM public.sprints s WHERE s.id = NEW.sprint_id;

  IF v_sprint_board IS NULL THEN
    RAISE EXCEPTION 'Sprint % does not exist.', NEW.sprint_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A closed sprint's membership is history. Nothing may join or leave it.
  IF v_sprint_state IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Sprint membership cannot change after the sprint is %.', v_sprint_state
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT c.board_id, t.type_key INTO v_task_board, v_type_key
      FROM public.tasks t JOIN public.columns c ON c.id = t.column_id
     WHERE t.id = NEW.task_id;

    IF v_task_board IS NULL THEN
      RAISE EXCEPTION 'Task % is not on a board and cannot join a sprint.', NEW.task_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_task_board <> v_sprint_board THEN
      RAISE EXCEPTION 'A sprint only holds work from its own board.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- 113's is_agile_eligible, finally consulted. A subtask is carried by its parent; counting
    -- both would double every estimate in the burndown.
    SELECT wit.is_agile_eligible INTO v_agile_eligible
      FROM public.work_item_types wit WHERE wit.key = v_type_key;
    IF COALESCE(v_agile_eligible, true) = false THEN
      RAISE EXCEPTION 'Work items of type "%" cannot be planned into a sprint on their own.', v_type_key
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.added_at   := now();
    NEW.added_by   := COALESCE(auth.uid(), NEW.added_by);
    -- ⚠️ ALWAYS false on insert. `committed` means "was in this window at the moment it
    -- started", and the ONLY writer of true is the activation branch of enforce_sprint_state.
    -- Stamping true here for a planned sprint looks equivalent and is not: work added to a
    -- planned sprint and then removed again BEFORE it started would keep the flag, and would
    -- be counted forever as part of a commitment it was never in. Anything joining a running
    -- sprint is scope added, and it must not be able to claim otherwise either.
    NEW.committed  := false;
    NEW.removed_at := NULL;
    NEW.removed_by := NULL;
    NEW.removed_count := 0;
    SELECT t.estimate_value INTO NEW.estimate_at_commit FROM public.tasks t WHERE t.id = NEW.task_id;
    RETURN NEW;
  END IF;

  -- UPDATE. There are exactly TWO legal shapes, and everything else is refused.
  --
  -- Shape 1: the activation stamp, and only from inside enforce_sprint_state's transaction.
  IF NEW.committed IS DISTINCT FROM OLD.committed THEN
    IF COALESCE(current_setting('agile.commitment_stamp', true), '') IS DISTINCT FROM NEW.sprint_id::text THEN
      RAISE EXCEPTION 'Commitment is recorded when the sprint starts and cannot be set by hand.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Nothing may ride along with it. A statement that flipped `committed` AND moved
    -- `added_at` would be exactly the forgery the flag exists to prevent, wearing its permit.
    IF NEW.sprint_id IS DISTINCT FROM OLD.sprint_id
       OR NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.added_at IS DISTINCT FROM OLD.added_at
       OR NEW.added_by IS DISTINCT FROM OLD.added_by
       OR NEW.estimate_at_commit IS DISTINCT FROM OLD.estimate_at_commit
       OR NEW.removed_at IS DISTINCT FROM OLD.removed_at THEN
      RAISE EXCEPTION 'Only the commitment flag may change while a sprint is being started.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Shape 2: a removal or a re-add. Everything else is the record of what happened.
  IF NEW.sprint_id IS DISTINCT FROM OLD.sprint_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.added_at IS DISTINCT FROM OLD.added_at
     OR NEW.added_by IS DISTINCT FROM OLD.added_by
     OR NEW.estimate_at_commit IS DISTINCT FROM OLD.estimate_at_commit THEN
    RAISE EXCEPTION 'Only the removal of a sprint item may be edited. Move work by removing it and adding it to another sprint.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN
    NEW.removed_at    := now();
    NEW.removed_by    := COALESCE(auth.uid(), NEW.removed_by);
    NEW.removed_count := OLD.removed_count + 1;
  ELSIF NEW.removed_at IS NULL AND OLD.removed_at IS NOT NULL THEN
    -- Re-added. removed_count is deliberately NOT reset: the churn happened.
    NEW.removed_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_sprint_item_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_sprint_item_integrity ON public.sprint_items;
CREATE TRIGGER enforce_sprint_item_integrity
  BEFORE INSERT OR UPDATE ON public.sprint_items
  FOR EACH ROW EXECUTE FUNCTION private.enforce_sprint_item_integrity();

-- ---------------------------------------------------------------------------------------
-- 7. Grants. ⚠️ Supabase's default privileges hand every NEW table in public a blanket ALL
--    to anon and authenticated (095's lesson, and the trap that bit appointments twice), so
--    granting narrowly is not enough - the wide grant is already there and must be revoked.
-- ---------------------------------------------------------------------------------------
REVOKE ALL ON public.board_agile_settings FROM anon, authenticated;
REVOKE ALL ON public.sprints              FROM anon, authenticated;
REVOKE ALL ON public.sprint_items         FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_agile_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sprints              TO authenticated;
-- No DELETE on sprint_items: removal is `removed_at`, so the record of what was committed
-- survives. Deleting the row is how a sprint's history quietly becomes flattering.
GRANT SELECT, INSERT, UPDATE ON public.sprint_items TO authenticated;

-- ---------------------------------------------------------------------------------------
-- 8. RLS.
--
-- Board scope is read through the CALLER'S OWN `boards` policy - the saved_views (119)
-- pattern - never through a SECURITY DEFINER bypass. A private board's sprints are therefore
-- invisible to a non-member without any of these policies knowing what board privacy is,
-- and an admin who is not a member of a private board sees nothing here either, which is the
-- same answer the board page itself gives them.
--
-- ⚠️ Every write policy below is NARROWER THAN OR EQUAL TO the SELECT policy on the same
-- table. That is deliberate and load-bearing: RLS applies the SELECT policy to an UPDATE's
-- WHERE clause, so a write policy wider than its SELECT policy silently matches zero rows
-- (the trap 099 set for `columns` and 107 had to work around).
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.board_agile_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprint_items         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read agile settings for boards you can see" ON public.board_agile_settings;
CREATE POLICY "Read agile settings for boards you can see" ON public.board_agile_settings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_agile_settings.board_id)
  );

-- Configuring a board is the same tier as adding a column to it: admin. Board roles are
-- unchanged - a guest or client cannot reach this because they cannot be an admin.
DROP POLICY IF EXISTS "Admins configure agile on boards they can see" ON public.board_agile_settings;
CREATE POLICY "Admins configure agile on boards they can see" ON public.board_agile_settings
  FOR ALL
  USING (
    private.is_admin_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_agile_settings.board_id)
  )
  WITH CHECK (
    private.is_admin_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = board_agile_settings.board_id)
  );

DROP POLICY IF EXISTS "Read sprints on boards you can see" ON public.sprints;
CREATE POLICY "Read sprints on boards you can see" ON public.sprints
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.boards b WHERE b.id = sprints.board_id)
  );

-- ⚠️ Guests and clients are read-only on a board (065), and a sprint is a plan for that
-- board's work, so they must not be able to create or move one. The predicate is a fourth
-- copy of the rule private.task_restricted_by_board_role (065) and
-- private.column_restricted_by_board_role (067) already express - correct today, and safe
-- only because board_members' SELECT policy (061) always exposes the caller's OWN row so
-- this subquery reads nothing that could be hidden from it. If a fourth role is added to
-- board_members_role_check, FOUR places need updating.
DROP POLICY IF EXISTS "Members manage sprints on boards they can see" ON public.sprints;
CREATE POLICY "Members manage sprints on boards they can see" ON public.sprints
  FOR ALL
  USING (
    private.is_active_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = sprints.board_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.board_members bm
       WHERE bm.board_id = sprints.board_id
         AND bm.user_id = auth.uid()
         AND bm.role IN ('guest', 'client')
    )
  )
  WITH CHECK (
    private.is_active_user()
    AND EXISTS (SELECT 1 FROM public.boards b WHERE b.id = sprints.board_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.board_members bm
       WHERE bm.board_id = sprints.board_id
         AND bm.user_id = auth.uid()
         AND bm.role IN ('guest', 'client')
    )
  );

-- Membership is visible to anyone who can see BOTH ends. Requiring only the sprint would leak
-- the id of a task the caller cannot read through the join - 115's rule for task_relations.
DROP POLICY IF EXISTS "Read sprint items you can see both ends of" ON public.sprint_items;
CREATE POLICY "Read sprint items you can see both ends of" ON public.sprint_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sprints s WHERE s.id = sprint_items.sprint_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = sprint_items.task_id
         AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
    )
  );

-- Planning work into a sprint is managing that work: the same bar as editing the task, so a
-- guest or client is refused by can_manage_task without this policy restating board roles.
DROP POLICY IF EXISTS "Plan work you can manage into a sprint you can see" ON public.sprint_items;
CREATE POLICY "Plan work you can manage into a sprint you can see" ON public.sprint_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.sprints s WHERE s.id = sprint_items.sprint_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = sprint_items.task_id
         AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

DROP POLICY IF EXISTS "Remove work you can manage from a sprint" ON public.sprint_items;
CREATE POLICY "Remove work you can manage from a sprint" ON public.sprint_items
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.sprints s WHERE s.id = sprint_items.sprint_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = sprint_items.task_id
         AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.sprints s WHERE s.id = sprint_items.sprint_id)
    AND EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.id = sprint_items.task_id
         AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
    )
  );

-- ---------------------------------------------------------------------------------------
-- 9. The module row. Seeds DISABLED, like appointments (080) and crm (103), so applying this
--    migration changes nothing anyone can see until a super admin switches it on.
-- ---------------------------------------------------------------------------------------
INSERT INTO public.app_modules (module_key, enabled)
VALUES ('agile', false)
ON CONFLICT (module_key) DO NOTHING;

-- ---------------------------------------------------------------------------------------
-- 10. Post-conditions. Assertions that TRY THE BAD WRITE where possible, because "the
--     constraint exists" and "the constraint refuses this" are different claims (117's
--     lesson, where a CHECK passed on the empty array it was written to reject).
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks   BIGINT;
  v_before_boards  BIGINT;
  v_before_columns BIGINT;
  v_before_status  BIGINT;
  v_before_types   BIGINT;
  v_before_modules BIGINT;
  v_refused        BOOLEAN;
BEGIN
  SELECT task_rows, board_rows, column_rows, status_rows, type_rows, module_rows
    INTO v_before_tasks, v_before_boards, v_before_columns, v_before_status, v_before_types, v_before_modules
  FROM _123_precheck;

  IF (SELECT count(*) FROM public.tasks)   <> v_before_tasks   THEN RAISE EXCEPTION 'Task rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.boards)  <> v_before_boards  THEN RAISE EXCEPTION 'Board rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.columns) <> v_before_columns THEN RAISE EXCEPTION 'Column rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.task_statuses)   <> v_before_status THEN RAISE EXCEPTION 'Status rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.work_item_types) <> v_before_types  THEN RAISE EXCEPTION 'Work item type rows moved. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.app_modules) <> v_before_modules + 1 THEN
    RAISE EXCEPTION 'Expected exactly one new app_modules row. Aborting.';
  END IF;

  -- The module must be OFF. A migration that switches a module on for everyone is not optional.
  IF (SELECT enabled FROM public.app_modules WHERE module_key = 'agile') THEN
    RAISE EXCEPTION 'The agile module seeded ENABLED. It must seed off. Aborting.';
  END IF;

  -- Nothing may exist yet: no board opted in, no sprint, no membership.
  IF (SELECT count(*) FROM public.board_agile_settings) <> 0 THEN RAISE EXCEPTION 'board_agile_settings seeded rows. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprints) <> 0 THEN RAISE EXCEPTION 'sprints seeded rows. Aborting.'; END IF;
  IF (SELECT count(*) FROM public.sprint_items) <> 0 THEN RAISE EXCEPTION 'sprint_items seeded rows. Aborting.'; END IF;

  -- The new columns must be NULL everywhere. If either CHECK could have failed on real data
  -- this is where it shows up, rather than mid-ALTER on production.
  IF EXISTS (SELECT 1 FROM public.tasks WHERE estimate_value IS NOT NULL) THEN
    RAISE EXCEPTION 'tasks.estimate_value is populated after an additive migration. Aborting.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.columns WHERE wip_limit IS NOT NULL) THEN
    RAISE EXCEPTION 'columns.wip_limit is populated after an additive migration. Aborting.';
  END IF;

  -- RLS is enabled on all three, and anon holds nothing (095's rule for every new table).
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('board_agile_settings', 'sprints', 'sprint_items')
       AND c.relrowsecurity = false
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on every new agile table. Aborting.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('board_agile_settings', 'sprints', 'sprint_items')
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon holds a grant on an agile table. Aborting.';
  END IF;

  -- sprint_items must not be DELETE-able by a client: that is how a sprint's history would
  -- quietly become flattering. Asserted rather than assumed.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'sprint_items'
       AND grantee = 'authenticated' AND privilege_type = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'authenticated holds DELETE on sprint_items. Aborting.';
  END IF;

  -- The state machine really refuses a sprint created already closed.
  v_refused := false;
  BEGIN
    INSERT INTO public.sprints (board_id, title, start_date, end_date, state)
    SELECT b.id, '__123_probe__', CURRENT_DATE, CURRENT_DATE, 'completed'
      FROM public.boards b LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  IF NOT v_refused AND EXISTS (SELECT 1 FROM public.boards) THEN
    RAISE EXCEPTION 'A sprint could be created already completed. The state machine is not doing its job. Aborting.';
  END IF;
  DELETE FROM public.sprints WHERE title = '__123_probe__';

  -- The date ordering constraint really refuses an inverted window.
  v_refused := false;
  BEGIN
    INSERT INTO public.sprints (board_id, title, start_date, end_date)
    SELECT b.id, '__123_probe2__', CURRENT_DATE, CURRENT_DATE - 1 FROM public.boards b LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_refused := true;
  END;
  IF NOT v_refused AND EXISTS (SELECT 1 FROM public.boards) THEN
    RAISE EXCEPTION 'A sprint could end before it starts. Aborting.';
  END IF;
  DELETE FROM public.sprints WHERE title = '__123_probe2__';

  -- ⚠️ The commitment flag's unsettability is NOT asserted here, deliberately. A migration
  -- runs on an empty sprint_items table, so any probe would pass over zero rows - a vacuous
  -- pass that reads like a verified rule, which is worse than no check at all. It is proved
  -- against real rows by `pnpm check:agile` ("nobody can flip `committed` by hand", and the
  -- activation case beside it).

  RAISE NOTICE '123 verified: agile module seeded OFF, 3 tables + 2 nullable columns added, % tasks and % columns untouched.',
    v_before_tasks, v_before_columns;
END $$;

COMMIT;
