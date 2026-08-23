-- 114: an extensible custom-field engine - definitions, values, and validation in the database.
--
-- WHY THIS SHAPE
-- FEATURES.md Phase 1 calls custom fields "the single highest-leverage change" because views,
-- forms, automations and reporting all need somewhere to put the properties this company
-- tracks that a task table cannot know about in advance. The requirement is explicit that the
-- values be "type validated, permission checked, queryable, filterable, indexable where
-- needed" and that the engine must not be "one uncontrolled JSON blob without a documented
-- reason". So:
--
--   * ONE ROW PER (task, field), not one JSON document per task. That is what makes a value
--     addressable: it can be indexed, joined, permission-checked, and updated without
--     read-modify-writing every other field on the same task and losing a concurrent edit.
--
--   * The value itself IS jsonb, and that is the documented reason. Twelve field types with
--     one storage column each would be twelve mostly-NULL columns and a CHECK that cannot see
--     which type applies (the type lives on the other table); a text column holding everything
--     would make `number` unsortable and `multi_select` unrepresentable. jsonb keeps the
--     value's own type - a number stays a number, a multi-select stays an array - and Postgres
--     can index and order it.
--
--   * VALIDATION IS A TRIGGER, not a convention. A field declared `number` cannot hold "abc",
--     a `select` cannot hold an option that was never defined, and a board-scoped field cannot
--     be attached to a task on another board - regardless of whether the write came from the
--     UI, an import, psql, or a future automation. This is the same argument 103's status
--     history makes: a guarantee that only the application enforces is not a guarantee.
--
-- REQUIRED FIELDS
-- `is_required` is enforced at the VALUE, not at the task: setting a required field to null or
-- to an empty string/array is refused. It deliberately does NOT block task creation. Making it
-- do so would mean that the moment an admin ticks "required" on a new field, every task that
-- already exists becomes invalid and unsaveable - a change to a field definition would
-- retroactively break unrelated work. The UI marks the field required and asks for it; the
-- database guarantees that a value, once given, is really there.
--
-- CHANGING A FIELD'S TYPE
-- Refused once values exist. Reinterpreting stored values under a new type is the kind of
-- silent data corruption that shows up months later; archive the field and add a new one.
--
-- SAFETY
-- Purely additive: two new tables and their triggers, nothing existing touched - no column,
-- policy, grant, constraint or row on any table that already exists. On this repo's own rule
-- that makes it --allow-prod eligible, and applying it to prod changes nothing anyone can see
-- until an admin defines a field (none are seeded, deliberately).
-- Rollback: scripts/rollback/114_revert.sql - which DESTROYS every custom field value.

BEGIN;

CREATE TEMP TABLE _114_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.tasks)   AS task_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

-- ---------------------------------------------------------------------------------------
-- Definitions
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_definitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  field_type       TEXT NOT NULL,
  -- Per-type settings: {options:[{id,label,color}]} for select/multi_select,
  -- {min,max} for number, {max_length} for text. Validated by the trigger below.
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required      BOOLEAN NOT NULL DEFAULT FALSE,
  scope            TEXT NOT NULL DEFAULT 'global',
  board_id         UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  -- NULL = applies to every work item type. Non-null narrows to these work_item_types keys.
  applies_to_types TEXT[],
  position         INTEGER NOT NULL DEFAULT 0,
  is_archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT field_definitions_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT field_definitions_type_check CHECK (field_type IN (
    'text', 'long_text', 'number', 'date', 'datetime', 'checkbox',
    'select', 'multi_select', 'person', 'url', 'email', 'relation'
  )),
  CONSTRAINT field_definitions_scope_check CHECK (scope IN ('global', 'board')),
  -- A scope and a board_id that disagree is unrepresentable rather than merely discouraged.
  CONSTRAINT field_definitions_scope_board_agree CHECK (
    (scope = 'global' AND board_id IS NULL) OR (scope = 'board' AND board_id IS NOT NULL)
  ),
  CONSTRAINT field_definitions_applies_nonempty CHECK (
    applies_to_types IS NULL OR array_length(applies_to_types, 1) > 0
  )
);

COMMENT ON TABLE public.field_definitions IS
  'Custom field definitions. Global fields apply everywhere; board-scoped fields only to tasks '
  'on that board (enforced by private.validate_field_value, not just by the picker).';

-- Two partial uniques rather than one over COALESCE(board_id, <sentinel>): a sentinel uuid is
-- a value that could in principle collide with a real board id, and the partial pair says
-- exactly what is meant - a key is unique among global fields, and unique within a board.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_definitions_global_key
  ON public.field_definitions(key) WHERE board_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_definitions_board_key
  ON public.field_definitions(board_id, key) WHERE board_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_field_definitions_board
  ON public.field_definitions(board_id) WHERE board_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_field_definitions_updated_at ON public.field_definitions;
CREATE TRIGGER set_field_definitions_updated_at
  BEFORE UPDATE ON public.field_definitions
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- Values
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_values (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  field_id   UUID NOT NULL REFERENCES public.field_definitions(id) ON DELETE CASCADE,
  value      JSONB,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT field_values_unique_per_task UNIQUE (task_id, field_id)
);

COMMENT ON TABLE public.field_values IS
  'One row per (task, field). The value keeps its own JSON type - a number stays a number, a '
  'multi-select stays an array - and is validated against its definition by a trigger.';

CREATE INDEX IF NOT EXISTS idx_field_values_task ON public.field_values(task_id);
CREATE INDEX IF NOT EXISTS idx_field_values_field ON public.field_values(field_id);
-- Containment/existence queries ("which tasks have option X selected") - the multi_select and
-- select filter path.
CREATE INDEX IF NOT EXISTS idx_field_values_value_gin ON public.field_values USING GIN (value);
-- Equality and ORDER BY on a scalar value, per field. `jsonb_extract_path_text(value)` with no
-- path returns the scalar as text and is IMMUTABLE, so it is indexable; this is the "filter a
-- table view by a custom field" path.
CREATE INDEX IF NOT EXISTS idx_field_values_scalar_text
  ON public.field_values(field_id, (jsonb_extract_path_text(value, VARIADIC ARRAY[]::text[])));

DROP TRIGGER IF EXISTS set_field_values_updated_at ON public.field_values;
CREATE TRIGGER set_field_values_updated_at
  BEFORE UPDATE ON public.field_values
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ---------------------------------------------------------------------------------------
-- Definition integrity
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.validate_field_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_options  JSONB;
  v_opt      JSONB;
  v_ids      TEXT[];
  v_in_use   BIGINT;
  v_bad_type TEXT;
BEGIN
  -- A choice field with no choices renders as an empty control that cannot be satisfied,
  -- and if it is also required it makes the task unsaveable with no way to fix it.
  IF NEW.field_type IN ('select', 'multi_select') THEN
    v_options := NEW.config -> 'options';
    IF v_options IS NULL OR jsonb_typeof(v_options) <> 'array' OR jsonb_array_length(v_options) = 0 THEN
      RAISE EXCEPTION 'A % field needs a non-empty "options" array in its config.', NEW.field_type
        USING ERRCODE = '22023';
    END IF;

    v_ids := ARRAY[]::TEXT[];
    FOR v_opt IN SELECT jsonb_array_elements(v_options) LOOP
      IF jsonb_typeof(v_opt) <> 'object' OR jsonb_typeof(v_opt -> 'id') <> 'string'
         OR btrim(v_opt ->> 'id') = '' THEN
        RAISE EXCEPTION 'Every option needs a non-empty string "id". Got: %', v_opt
          USING ERRCODE = '22023';
      END IF;
      IF (v_opt ->> 'id') = ANY (v_ids) THEN
        RAISE EXCEPTION 'Duplicate option id "%" in field "%".', v_opt ->> 'id', NEW.key
          USING ERRCODE = '22023';
      END IF;
      v_ids := v_ids || (v_opt ->> 'id');
    END LOOP;
  END IF;

  IF NEW.field_type = 'number' THEN
    IF NEW.config ? 'min' AND jsonb_typeof(NEW.config -> 'min') <> 'number' THEN
      RAISE EXCEPTION 'config.min must be a number.' USING ERRCODE = '22023';
    END IF;
    IF NEW.config ? 'max' AND jsonb_typeof(NEW.config -> 'max') <> 'number' THEN
      RAISE EXCEPTION 'config.max must be a number.' USING ERRCODE = '22023';
    END IF;
    IF NEW.config ? 'min' AND NEW.config ? 'max'
       AND (NEW.config ->> 'min')::numeric > (NEW.config ->> 'max')::numeric THEN
      RAISE EXCEPTION 'config.min cannot exceed config.max.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Narrowing to work item types that do not exist would silently hide the field everywhere.
  IF NEW.applies_to_types IS NOT NULL THEN
    SELECT string_agg(t, ', ') INTO v_bad_type
    FROM unnest(NEW.applies_to_types) AS t
    WHERE NOT EXISTS (SELECT 1 FROM public.work_item_types w WHERE w.key = t);
    IF v_bad_type IS NOT NULL THEN
      RAISE EXCEPTION 'Unknown work item type(s) in applies_to_types: %', v_bad_type
        USING ERRCODE = '23503';
    END IF;
  END IF;

  -- Re-typing a field whose values already exist would reinterpret every stored value.
  IF TG_OP = 'UPDATE' AND NEW.field_type IS DISTINCT FROM OLD.field_type THEN
    SELECT count(*) INTO v_in_use FROM public.field_values WHERE field_id = OLD.id;
    IF v_in_use > 0 THEN
      RAISE EXCEPTION
        'Cannot change the type of "%" - % value(s) already stored. Archive it and add a new field.',
        OLD.key, v_in_use USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Likewise for moving a field between boards, or from board scope to global and back: the
  -- values already attached were validated against the OLD scope.
  IF TG_OP = 'UPDATE'
     AND (NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.scope IS DISTINCT FROM OLD.scope) THEN
    SELECT count(*) INTO v_in_use FROM public.field_values WHERE field_id = OLD.id;
    IF v_in_use > 0 THEN
      RAISE EXCEPTION
        'Cannot re-scope "%" - % value(s) already stored against its current scope.',
        OLD.key, v_in_use USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_field_definition ON public.field_definitions;
CREATE TRIGGER validate_field_definition
  BEFORE INSERT OR UPDATE ON public.field_definitions
  FOR EACH ROW EXECUTE FUNCTION private.validate_field_definition();

-- ---------------------------------------------------------------------------------------
-- Value integrity - the reason this engine is not "an uncontrolled JSON blob"
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.validate_field_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def       public.field_definitions%ROWTYPE;
  v_json_type TEXT;
  v_text      TEXT;
  v_elem      JSONB;
  v_task_board UUID;
BEGIN
  SELECT * INTO v_def FROM public.field_definitions WHERE id = NEW.field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown field definition.' USING ERRCODE = '23503';
  END IF;

  -- JSON null and SQL NULL both mean "cleared"; storing two representations of one state is
  -- how `value IS NULL` starts missing rows. Normalise here so only SQL NULL is ever stored.
  IF NEW.value IS NOT NULL AND jsonb_typeof(NEW.value) = 'null' THEN
    NEW.value := NULL;
  END IF;

  -- A field the admin archived stays readable and keeps its values; it just stops accepting
  -- new ones, mirroring how an archived task_status behaves.
  IF v_def.is_archived AND (TG_OP = 'INSERT' OR NEW.value IS DISTINCT FROM OLD.value) THEN
    RAISE EXCEPTION 'The field "%" is archived and no longer accepts values.', v_def.name
      USING ERRCODE = '23514';
  END IF;

  -- A board-scoped field must not travel to another board's task. The picker will not offer
  -- it, but the picker is not the boundary.
  IF v_def.board_id IS NOT NULL THEN
    SELECT c.board_id INTO v_task_board
    FROM public.tasks t JOIN public.columns c ON c.id = t.column_id
    WHERE t.id = NEW.task_id;
    IF v_task_board IS DISTINCT FROM v_def.board_id THEN
      RAISE EXCEPTION 'The field "%" belongs to another board.', v_def.name
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Narrowed to certain work item types? Then the task must be one of them.
  IF v_def.applies_to_types IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = NEW.task_id AND t.type_key = ANY (v_def.applies_to_types)
    ) THEN
      RAISE EXCEPTION 'The field "%" does not apply to this kind of work item.', v_def.name
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.value IS NULL THEN
    IF v_def.is_required THEN
      RAISE EXCEPTION '"%" is required and cannot be cleared.', v_def.name USING ERRCODE = '23502';
    END IF;
    RETURN NEW;
  END IF;

  v_json_type := jsonb_typeof(NEW.value);

  CASE v_def.field_type

    WHEN 'text', 'long_text' THEN
      IF v_json_type <> 'string' THEN
        RAISE EXCEPTION '"%" expects text.', v_def.name USING ERRCODE = '22023';
      END IF;
      v_text := NEW.value #>> '{}';
      IF v_def.is_required AND btrim(v_text) = '' THEN
        RAISE EXCEPTION '"%" is required.', v_def.name USING ERRCODE = '23502';
      END IF;
      IF v_def.config ? 'max_length'
         AND length(v_text) > (v_def.config ->> 'max_length')::int THEN
        RAISE EXCEPTION '"%" is limited to % characters.', v_def.name, v_def.config ->> 'max_length'
          USING ERRCODE = '22001';
      END IF;

    WHEN 'number' THEN
      IF v_json_type <> 'number' THEN
        RAISE EXCEPTION '"%" expects a number.', v_def.name USING ERRCODE = '22023';
      END IF;
      IF v_def.config ? 'min' AND (NEW.value #>> '{}')::numeric < (v_def.config ->> 'min')::numeric THEN
        RAISE EXCEPTION '"%" must be at least %.', v_def.name, v_def.config ->> 'min'
          USING ERRCODE = '22003';
      END IF;
      IF v_def.config ? 'max' AND (NEW.value #>> '{}')::numeric > (v_def.config ->> 'max')::numeric THEN
        RAISE EXCEPTION '"%" must be at most %.', v_def.name, v_def.config ->> 'max'
          USING ERRCODE = '22003';
      END IF;

    WHEN 'checkbox' THEN
      IF v_json_type <> 'boolean' THEN
        RAISE EXCEPTION '"%" expects true or false.', v_def.name USING ERRCODE = '22023';
      END IF;

    WHEN 'date' THEN
      -- Stored as a calendar date string, never an instant. Per this repo's CRM lesson, a
      -- date-only value parsed into a timestamp resolves against the runtime's timezone and
      -- renders differently on the server and in the browser.
      IF v_json_type <> 'string' OR (NEW.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION '"%" expects a date as YYYY-MM-DD.', v_def.name USING ERRCODE = '22007';
      END IF;
      BEGIN
        PERFORM (NEW.value #>> '{}')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '"%" is not a real date.', v_def.name USING ERRCODE = '22007';
      END;

    WHEN 'datetime' THEN
      IF v_json_type <> 'string' THEN
        RAISE EXCEPTION '"%" expects a timestamp.', v_def.name USING ERRCODE = '22007';
      END IF;
      BEGIN
        PERFORM (NEW.value #>> '{}')::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '"%" is not a valid timestamp.', v_def.name USING ERRCODE = '22007';
      END;

    WHEN 'select' THEN
      IF v_json_type <> 'string' THEN
        RAISE EXCEPTION '"%" expects one option id.', v_def.name USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_def.config -> 'options') o
        WHERE o ->> 'id' = NEW.value #>> '{}'
      ) THEN
        RAISE EXCEPTION '"%" is not an option of "%".', NEW.value #>> '{}', v_def.name
          USING ERRCODE = '23514';
      END IF;

    WHEN 'multi_select' THEN
      IF v_json_type <> 'array' THEN
        RAISE EXCEPTION '"%" expects a list of option ids.', v_def.name USING ERRCODE = '22023';
      END IF;
      IF v_def.is_required AND jsonb_array_length(NEW.value) = 0 THEN
        RAISE EXCEPTION '"%" is required.', v_def.name USING ERRCODE = '23502';
      END IF;
      FOR v_elem IN SELECT jsonb_array_elements(NEW.value) LOOP
        IF jsonb_typeof(v_elem) <> 'string' THEN
          RAISE EXCEPTION '"%" expects option ids as strings.', v_def.name USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_def.config -> 'options') o
          WHERE o ->> 'id' = v_elem #>> '{}'
        ) THEN
          RAISE EXCEPTION '"%" is not an option of "%".', v_elem #>> '{}', v_def.name
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
      -- Duplicates would make "how many tasks chose X" wrong without ever looking wrong.
      IF (SELECT count(*) FROM jsonb_array_elements(NEW.value)) <>
         (SELECT count(DISTINCT e) FROM jsonb_array_elements(NEW.value) e) THEN
        RAISE EXCEPTION '"%" cannot list the same option twice.', v_def.name USING ERRCODE = '23514';
      END IF;

    WHEN 'person' THEN
      IF v_json_type <> 'string' THEN
        RAISE EXCEPTION '"%" expects one person.', v_def.name USING ERRCODE = '22023';
      END IF;
      BEGIN
        PERFORM (NEW.value #>> '{}')::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '"%" expects a user id.', v_def.name USING ERRCODE = '22P02';
      END;
      IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (NEW.value #>> '{}')::uuid) THEN
        RAISE EXCEPTION '"%" points at someone who does not exist.', v_def.name
          USING ERRCODE = '23503';
      END IF;

    WHEN 'relation' THEN
      IF v_json_type <> 'string' THEN
        RAISE EXCEPTION '"%" expects one work item id.', v_def.name USING ERRCODE = '22023';
      END IF;
      BEGIN
        PERFORM (NEW.value #>> '{}')::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '"%" expects a work item id.', v_def.name USING ERRCODE = '22P02';
      END;
      IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = (NEW.value #>> '{}')::uuid) THEN
        RAISE EXCEPTION '"%" points at a work item that does not exist.', v_def.name
          USING ERRCODE = '23503';
      END IF;
      IF (NEW.value #>> '{}')::uuid = NEW.task_id THEN
        RAISE EXCEPTION '"%" cannot point a work item at itself.', v_def.name
          USING ERRCODE = '23514';
      END IF;

    WHEN 'url' THEN
      IF v_json_type <> 'string' OR (NEW.value #>> '{}') !~* '^https?://[^\s]+$' THEN
        RAISE EXCEPTION '"%" expects a URL starting http:// or https://.', v_def.name
          USING ERRCODE = '22023';
      END IF;

    WHEN 'email' THEN
      IF v_json_type <> 'string' OR (NEW.value #>> '{}') !~* '^[^@\s]+@[^@\s.]+\.[^@\s]+$' THEN
        RAISE EXCEPTION '"%" expects an email address.', v_def.name USING ERRCODE = '22023';
      END IF;

    ELSE
      -- Unreachable while the CHECK constraint and this CASE agree. If a thirteenth type is
      -- ever added to the constraint and not here, refuse rather than store it unvalidated.
      RAISE EXCEPTION 'No validation rule for field type "%".', v_def.field_type
        USING ERRCODE = '0A000';
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_field_value ON public.field_values;
CREATE TRIGGER validate_field_value
  BEFORE INSERT OR UPDATE ON public.field_values
  FOR EACH ROW EXECUTE FUNCTION private.validate_field_value();

-- ---------------------------------------------------------------------------------------
-- Grants and RLS
--
-- Definitions: everyone reads (a field nobody can see is a field nobody can fill in),
-- SUPER ADMINS write - deliberately the same tier as task_statuses (069) and
-- work_item_types (113), because a global field appears on every work item in the workspace
-- and that is a workspace-shaping decision, not a per-board one.
--
-- ⚠️ This started as `private.is_admin_user()` and was narrowed before it ever left dev,
-- because the only screen that manages fields lives on /admin/super-admin. Shipping a policy
-- that grants an ability no screen exposes is precisely the guest/client defect CLAUDE.md
-- records three times over - the database says yes and no human can get there. The two must
-- agree, and they agree here. Widening later is a one-line change if a plain admin turns out
-- to need it; discovering the gap in production is not.
--
-- Note this is `is_super_admin_user()`, NOT the literal `role = 'super_admin'`. Both work
-- today, but only the helper folds in 101's is_active check.
--
-- Values: mirror task_links exactly - view a value if you can view its task, write it if you
-- can manage its task. That means guests and clients get read-only custom fields for free,
-- because private.can_manage_task already refuses them via task_restricted_by_board_role,
-- and nothing new has to know about board roles.
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_values ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.field_definitions FROM anon;
REVOKE ALL ON public.field_values FROM anon;
REVOKE ALL ON public.field_definitions FROM authenticated;
REVOKE ALL ON public.field_values FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_values TO authenticated;

DROP POLICY IF EXISTS "Everyone can view field definitions" ON public.field_definitions;
CREATE POLICY "Everyone can view field definitions"
  ON public.field_definitions FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage field definitions" ON public.field_definitions;
DROP POLICY IF EXISTS "Super admins can manage field definitions" ON public.field_definitions;
CREATE POLICY "Super admins can manage field definitions"
  ON public.field_definitions FOR ALL
  USING (private.is_super_admin_user())
  WITH CHECK (private.is_super_admin_user());

DROP POLICY IF EXISTS "Collaborators can view field values" ON public.field_values;
CREATE POLICY "Collaborators can view field values"
  ON public.field_values FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = field_values.task_id
      AND private.can_view_task(t.id, t.created_by, t.visibility, t.assigned_to)
  ));

DROP POLICY IF EXISTS "Collaborators can set field values" ON public.field_values;
CREATE POLICY "Collaborators can set field values"
  ON public.field_values FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = field_values.task_id
      AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
  ));

DROP POLICY IF EXISTS "Collaborators can update field values" ON public.field_values;
CREATE POLICY "Collaborators can update field values"
  ON public.field_values FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = field_values.task_id
      AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = field_values.task_id
      AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
  ));

DROP POLICY IF EXISTS "Collaborators can clear field values" ON public.field_values;
CREATE POLICY "Collaborators can clear field values"
  ON public.field_values FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = field_values.task_id
      AND private.can_manage_task(t.id, t.created_by, t.assigned_to)
  ));

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_tasks    BIGINT;
  v_before_policies BIGINT;
  v_after           BIGINT;
  v_count           BIGINT;
BEGIN
  SELECT task_rows, policy_rows INTO v_before_tasks, v_before_policies FROM _114_precheck;

  SELECT count(*) INTO v_after FROM public.tasks;
  IF v_after IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed during an additive migration (% -> %). Aborting.',
      v_before_tasks, v_after;
  END IF;

  -- Six new policies (2 + 4) and not one existing policy replaced.
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies + 6 THEN
    RAISE EXCEPTION 'Expected % policies after adding 6, found %. An existing policy was touched. Aborting.',
      v_before_policies + 6, v_count;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.field_definitions'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.field_values'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on both custom-field tables. Aborting.';
  END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('field_definitions', 'field_values')
    AND grantee = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on the custom-field tables. Aborting.', v_count;
  END IF;

  FOR v_count IN
    SELECT 1 FROM (VALUES ('validate_field_definition', 'field_definitions'),
                          ('validate_field_value', 'field_values')) AS t(tg, tbl)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t.tg AND tgrelid = ('public.' || t.tbl)::regclass AND NOT tgisinternal
    )
  LOOP
    RAISE EXCEPTION 'A validation trigger is missing - values could be stored unvalidated. Aborting.';
  END LOOP;

  -- No fields are seeded. Applying this to prod must change nothing anyone can see.
  SELECT count(*) INTO v_count FROM public.field_definitions;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 seeded field definitions, found %. Aborting.', v_count;
  END IF;

  RAISE NOTICE '114 verified: field engine in place, 0 fields defined, % tasks untouched.', v_after;
END $$;

COMMIT;
