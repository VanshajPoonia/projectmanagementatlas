-- 113: one work-item domain with configurable types, instead of a table per kind of work.
--
-- WHY
-- The plan's canonical-work-item requirement is that Task, Subtask, Bug, Feature, User Story,
-- Request, Deliverable, Risk, Decision, Approval and Change Request are all the SAME record
-- with a different type, so that one Kanban, one List, one Calendar, one My Work and one
-- future Sprint/Timeline read from one table. The alternative - a table or a boolean per kind
-- - is what produces methodology-specific copies of the same work, and it is explicitly ruled
-- out.
--
-- This migration builds the extensibility and deliberately activates almost none of it. Only
-- `task` and `subtask` are seeded active, because they are the only two the product renders
-- today; the other nine are seeded INACTIVE so the vocabulary exists, is editable by a super
-- admin, and shows up in no picker until someone turns it on. Nothing anyone sees changes.
--
-- WHAT A TYPE CONTROLS
--   name / plural_name / description / icon / color  - presentation
--   default_status_key                               - what a new one of these starts as
--   can_have_children / can_be_child /
--     allowed_parent_type_keys                       - allowed hierarchy
--   is_agile_eligible                                - may appear in a backlog/sprint later
--   is_active                                        - offered in pickers at all
--   is_system                                        - cannot be deactivated or deleted
--
-- HIERARCHY IS ENFORCED IN THE DATABASE, NOT IN THE PICKER
-- 060 already stops a self-parent, a cycle, and nesting more than one level deep. Those rules
-- are about SHAPE and stay exactly as they are. This migration adds the rules about KIND -
-- whether this sort of item may be a child at all, and whether that sort may be its parent -
-- in a second trigger that runs alongside. Keeping them separate means 060's guarantees are
-- untouched and independently verifiable.
--
-- ⚠️ The trigger is `BEFORE INSERT OR UPDATE OF type_key, parent_task_id`. Per this repo's own
-- CRM lesson (104), a trigger with an `OF column` clause cannot police columns it does not
-- fire on - so both columns that can invalidate the hierarchy are named. The third check below
-- exists precisely because `type_key` is one of them: changing a parent's type to one that
-- cannot have children must be refused while it still has some, and that is an UPDATE of
-- type_key on the PARENT row, which no parent_task_id-only trigger would ever see.
--
-- BACKFILL
-- tasks.type_key defaults to 'task', so every existing row is a Task - which is what they all
-- are today. Rows that are already subtasks (`parent_task_id IS NOT NULL`) are moved to
-- 'subtask', because that is what they already are; it renames nothing and changes no
-- behaviour. Dev has 0 such rows; prod may differ, so the backfill is written to be correct
-- either way and is guarded against the one shape it could not represent (a subtask that
-- itself has children, which 060 already makes impossible - asserted, not assumed).
--
-- SAFETY
-- Additive: one new table, one new column on `tasks` with a DEFAULT that matches existing
-- reality, one new trigger on `tasks`, and no existing policy, grant, constraint or column
-- altered. The trigger does change the behaviour of writes that already happen, so this is NOT
-- "purely additive" in the sense the --allow-prod rule means - it needs a deliberate decision
-- before prod, like 098 did. Rollback: scripts/rollback/113_revert.sql.

BEGIN;

CREATE TEMP TABLE _113_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks) AS task_rows,
  (SELECT count(*) FROM public.tasks WHERE parent_task_id IS NOT NULL) AS subtask_rows;

-- ---------------------------------------------------------------------------------------
-- The type registry
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_item_types (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                      TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  plural_name              TEXT,
  description              TEXT,
  icon                     TEXT,
  color                    TEXT NOT NULL DEFAULT '#6366f1',
  default_status_key       TEXT REFERENCES public.task_statuses(key) ON UPDATE CASCADE ON DELETE SET NULL,
  can_have_children        BOOLEAN NOT NULL DEFAULT TRUE,
  can_be_child             BOOLEAN NOT NULL DEFAULT TRUE,
  -- NULL means "any type that can_have_children". A non-null array narrows it further.
  allowed_parent_type_keys TEXT[],
  is_agile_eligible        BOOLEAN NOT NULL DEFAULT TRUE,
  is_active                BOOLEAN NOT NULL DEFAULT FALSE,
  is_system                BOOLEAN NOT NULL DEFAULT FALSE,
  position                 INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_item_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  -- An empty array would mean "no parent is ever allowed", which `can_be_child = false`
  -- already says more clearly. Two ways to express one rule is one way too many.
  CONSTRAINT work_item_types_parent_keys_nonempty
    CHECK (allowed_parent_type_keys IS NULL OR array_length(allowed_parent_type_keys, 1) > 0)
);

COMMENT ON TABLE public.work_item_types IS
  'Configurable kinds of work item. Every row in public.tasks is one of these; there is no '
  'second table per kind. Seeded types beyond task/subtask are inactive until switched on.';
COMMENT ON COLUMN public.work_item_types.allowed_parent_type_keys IS
  'NULL = any type whose can_have_children is true. Non-null narrows to exactly these keys.';
COMMENT ON COLUMN public.work_item_types.is_system IS
  'A system type underpins existing behaviour and cannot be deactivated or deleted.';

-- Seed. `task` and `subtask` active because the product renders them today; everything else
-- present but off, so the vocabulary is editable without appearing anywhere yet.
INSERT INTO public.work_item_types
  (key, name, plural_name, description, icon, color, can_have_children, can_be_child,
   allowed_parent_type_keys, is_agile_eligible, is_active, is_system, position)
VALUES
  ('task',           'Task',           'Tasks',            'A unit of work.',                                  'CircleCheck',  '#6366f1', TRUE,  TRUE,  NULL,           TRUE,  TRUE,  TRUE,  0),
  ('subtask',        'Subtask',        'Subtasks',         'A step inside another work item.',                 'ListTree',     '#8b5cf6', FALSE, TRUE,  NULL,           FALSE, TRUE,  TRUE,  1),
  ('bug',            'Bug',            'Bugs',             'Something behaving incorrectly.',                  'Bug',          '#dc2626', TRUE,  TRUE,  NULL,           TRUE,  FALSE, FALSE, 2),
  ('feature',        'Feature',        'Features',         'New capability to build.',                         'Sparkles',     '#0ea5e9', TRUE,  TRUE,  NULL,           TRUE,  FALSE, FALSE, 3),
  ('user_story',     'User Story',     'User Stories',     'Value described from the user''s point of view.',  'BookOpen',     '#14b8a6', TRUE,  TRUE,  NULL,           TRUE,  FALSE, FALSE, 4),
  ('request',        'Request',        'Requests',         'Incoming ask, not yet accepted as work.',          'Inbox',        '#f59e0b', TRUE,  TRUE,  NULL,           FALSE, FALSE, FALSE, 5),
  ('deliverable',    'Deliverable',    'Deliverables',     'Something handed to a client or stakeholder.',     'Package',      '#22c55e', TRUE,  TRUE,  NULL,           FALSE, FALSE, FALSE, 6),
  ('risk',           'Risk',           'Risks',            'Something that could go wrong.',                   'TriangleAlert','#f97316', TRUE,  TRUE,  NULL,           FALSE, FALSE, FALSE, 7),
  ('decision',       'Decision',       'Decisions',        'A choice to make, with its outcome recorded.',     'GitBranch',    '#a855f7', TRUE,  TRUE,  NULL,           FALSE, FALSE, FALSE, 8),
  ('approval',       'Approval',       'Approvals',        'A sign-off someone owes.',                         'Stamp',        '#eab308', TRUE,  TRUE,  NULL,           FALSE, FALSE, FALSE, 9),
  ('change_request', 'Change Request', 'Change Requests',  'A change to agreed scope, cost or dates.',         'FileDiff',     '#ec4899', TRUE,  TRUE,  NULL,           FALSE, FALSE, FALSE, 10)
ON CONFLICT (key) DO NOTHING;

-- Default state per type. Set after the seed so it survives a re-run and cannot fail on
-- ordering. 'to_do' is the only sensible default for everything the product renders today.
UPDATE public.work_item_types
SET default_status_key = 'to_do'
WHERE default_status_key IS NULL
  AND EXISTS (SELECT 1 FROM public.task_statuses WHERE key = 'to_do');

-- There is no shared updated_at helper in `public` - the one that exists belongs to
-- Supabase's `storage` schema, and every table here that carries updated_at either sets it
-- inline in its own trigger (103) or lets it go stale. Define one, in `private` alongside the
-- other helpers, so 113/114/115 do not each grow a copy.
CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_work_item_types_updated_at ON public.work_item_types;
CREATE TRIGGER set_work_item_types_updated_at
  BEFORE UPDATE ON public.work_item_types
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- Grants and RLS. Mirrors task_statuses exactly (069): everyone reads, super admins write.
-- A type is workspace-defining in the same way a status is.
--
-- The explicit REVOKE is this repo's standing rule: Supabase's default privileges hand every
-- new table in `public` a blanket grant, so granting narrowly is not enough - 095 closed that
-- for `anon` at the default-privilege level, and this restates it so the table is correct
-- regardless of how it was created.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.work_item_types ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.work_item_types FROM anon;
REVOKE ALL ON public.work_item_types FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_types TO authenticated;

DROP POLICY IF EXISTS "Everyone can view work item types" ON public.work_item_types;
CREATE POLICY "Everyone can view work item types"
  ON public.work_item_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Super admins can manage work item types" ON public.work_item_types;
CREATE POLICY "Super admins can manage work item types"
  ON public.work_item_types FOR ALL
  USING (private.is_super_admin_user())
  WITH CHECK (private.is_super_admin_user());

-- A system type must survive any amount of editing. Without this, deactivating `task` would
-- leave every existing row pointing at a type no picker offers and no new task creatable.
CREATE OR REPLACE FUNCTION private.protect_system_work_item_types()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'The "%" work item type is built in and cannot be deleted.', OLD.key
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system AND NEW.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'The "%" work item type is built in and cannot be deactivated.', OLD.key
      USING ERRCODE = '23514';
  END IF;

  IF OLD.is_system AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'The key of a built-in work item type cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_system_work_item_types ON public.work_item_types;
CREATE TRIGGER protect_system_work_item_types
  BEFORE UPDATE OR DELETE ON public.work_item_types
  FOR EACH ROW EXECUTE FUNCTION private.protect_system_work_item_types();

-- ---------------------------------------------------------------------------------------
-- tasks.type_key
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS type_key TEXT NOT NULL DEFAULT 'task';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_type_key_fkey'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_type_key_fkey FOREIGN KEY (type_key)
      REFERENCES public.work_item_types(key) ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_type_key ON public.tasks(type_key);

COMMENT ON COLUMN public.tasks.type_key IS
  'Which kind of work item this row is. One table, many types - see public.work_item_types.';

-- Backfill: rows that are already subtasks become type `subtask`. Runs BEFORE the hierarchy
-- trigger is created, so the migration cannot trip over its own rules while restating facts
-- that are already true.
UPDATE public.tasks
SET type_key = 'subtask'
WHERE parent_task_id IS NOT NULL
  AND type_key = 'task'
  -- Defensive: `subtask` cannot have children, so a subtask that somehow has its own children
  -- must stay a plain task rather than be given a type that contradicts its own shape. 060
  -- makes this impossible; the post-conditions assert it really was, so a surprise on prod
  -- surfaces as an aborted migration rather than a silently skipped row.
  AND NOT EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_task_id = public.tasks.id);

-- ---------------------------------------------------------------------------------------
-- Hierarchy by KIND. 060 owns hierarchy by SHAPE and is untouched.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_work_item_type_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self   public.work_item_types%ROWTYPE;
  v_parent public.work_item_types%ROWTYPE;
BEGIN
  SELECT * INTO v_self FROM public.work_item_types WHERE key = NEW.type_key;
  IF NOT FOUND THEN
    -- The foreign key says this cannot happen; saying it plainly beats a constraint name.
    RAISE EXCEPTION 'Unknown work item type "%".', NEW.type_key USING ERRCODE = '23503';
  END IF;

  -- A type that is switched off may not be chosen for new work, nor switched TO. Existing
  -- rows keep their type: deactivating `bug` must not invalidate the bugs already filed.
  IF NOT v_self.is_active
     AND (TG_OP = 'INSERT' OR NEW.type_key IS DISTINCT FROM OLD.type_key) THEN
    RAISE EXCEPTION 'The "%" work item type is not enabled.', v_self.name
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_task_id IS NOT NULL THEN
    IF NOT v_self.can_be_child THEN
      RAISE EXCEPTION 'A % cannot be a subtask of anything.', v_self.name
        USING ERRCODE = '23514';
    END IF;

    SELECT wt.* INTO v_parent
    FROM public.tasks t
    JOIN public.work_item_types wt ON wt.key = t.type_key
    WHERE t.id = NEW.parent_task_id;

    IF FOUND THEN
      IF NOT v_parent.can_have_children THEN
        RAISE EXCEPTION 'A % cannot have subtasks.', v_parent.name USING ERRCODE = '23514';
      END IF;

      IF v_self.allowed_parent_type_keys IS NOT NULL
         AND NOT (v_parent.key = ANY (v_self.allowed_parent_type_keys)) THEN
        RAISE EXCEPTION 'A % cannot sit under a %.', v_self.name, v_parent.name
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Re-typing a row that already has children. This is the check that needs `type_key` in the
  -- trigger's OF list: nothing about the CHILD rows changes here, so a parent_task_id-only
  -- trigger would never fire and the contradiction would be stored.
  IF NOT v_self.can_have_children
     AND EXISTS (SELECT 1 FROM public.tasks c WHERE c.parent_task_id = NEW.id) THEN
    RAISE EXCEPTION 'A % cannot have subtasks, and this one already has some.', v_self.name
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_work_item_type_hierarchy ON public.tasks;
CREATE TRIGGER enforce_work_item_type_hierarchy
  BEFORE INSERT OR UPDATE OF type_key, parent_task_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.enforce_work_item_type_hierarchy();

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks    BIGINT;
  v_before_subtasks BIGINT;
  v_after           BIGINT;
  v_count           BIGINT;
BEGIN
  SELECT task_rows, subtask_rows INTO v_before_tasks, v_before_subtasks FROM _113_precheck;

  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_after IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed (% -> %). Aborting.', v_before_tasks, v_after;
  END IF;

  -- Every task must have a valid, existing type. A NULL or dangling one would make the
  -- hierarchy trigger raise on the next unrelated write to that row.
  SELECT count(*) INTO v_count
  FROM public.tasks t
  LEFT JOIN public.work_item_types wt ON wt.key = t.type_key
  WHERE wt.key IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION '% task(s) carry an unknown type_key. Aborting.', v_count;
  END IF;

  -- The backfill must have reached every subtask. If it skipped one, its defensive clause
  -- fired, which means 060's single-level guarantee does not hold on this database - exactly
  -- the surprise that should stop the migration rather than be papered over.
  SELECT count(*) INTO v_count
  FROM public.tasks WHERE parent_task_id IS NOT NULL AND type_key <> 'subtask';
  IF v_count > 0 THEN
    RAISE EXCEPTION
      '% subtask(s) were not backfilled - they appear to have children of their own, which '
      '060 should prevent. Investigate before applying. Aborting.', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks WHERE type_key = 'subtask';
  IF v_count IS DISTINCT FROM v_before_subtasks THEN
    RAISE EXCEPTION 'subtask type count (%) does not match the pre-existing subtask count (%). Aborting.',
      v_count, v_before_subtasks;
  END IF;

  SELECT count(*) INTO v_count FROM public.work_item_types;
  IF v_count < 11 THEN
    RAISE EXCEPTION 'Expected 11 seeded work item types, found %. Aborting.', v_count;
  END IF;

  -- Exactly two active, and both system. Anything else means this migration turned something
  -- on that it promised not to.
  SELECT count(*) INTO v_count FROM public.work_item_types WHERE is_active;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly 2 active work item types (task, subtask), found %. Aborting.', v_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.work_item_types WHERE key = 'task' AND is_active AND is_system) THEN
    RAISE EXCEPTION 'The task type must be active and system. Aborting.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.work_item_types WHERE key = 'subtask' AND can_have_children) THEN
    RAISE EXCEPTION 'The subtask type must not be able to have children (060 forbids two levels). Aborting.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.work_item_types'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on work_item_types. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'work_item_types';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 policies on work_item_types, found %. Aborting.', v_count;
  END IF;

  -- anon must hold nothing (095's rule, restated per-table).
  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'work_item_types' AND grantee = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on work_item_types. Aborting.', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'enforce_single_level_subtasks'
      AND tgrelid = 'public.tasks'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '060''s enforce_single_level_subtasks trigger is gone - hierarchy shape is unguarded. Aborting.';
  END IF;

  RAISE NOTICE '113 verified: 11 types (2 active), % tasks typed, hierarchy-by-kind enforced.', v_after;
END $$;

COMMIT;
