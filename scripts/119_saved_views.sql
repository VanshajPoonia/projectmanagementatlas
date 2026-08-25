-- 119: saved views - one stored configuration that any layout can render.
--
-- WHAT IS WRONG
-- Every filter in this app is `useState` and dies on navigation. Measured, not assumed:
--   * reports-view.tsx  - NINE filter states (user, tags, priority, status, board, created
--                         from/to, due from/to), filtered in a useEffect into a SECOND state.
--   * board-view.tsx    - filterUser, filterPriority, filterDateRange, searchTerm, sortConfig.
--   * calendar-view.tsx - no filters at all.
-- Three different implementations of "filter by assignee": reports offers Unassigned and the
-- board does not; the board offers overdue and reports does not; reports has tags and status
-- and the board has neither. Nobody can carry a question from one screen to the next, and
-- "the work I look at every morning" has to be rebuilt by hand every morning.
--
-- WHAT PROMPT E ASKS FOR
--   "A saved view stores: layout, scope, descendant behavior, filters, sort, grouping,
--    visible fields, density. Scopes: personal, shared. Public/external sharing waits for
--    client-sharing permissions."
--
-- THE CONFIG IS ONE JSONB DOCUMENT, and that is deliberate, against this repo's own habit.
-- 114 argued the opposite for custom FIELD VALUES - one row per (task, field) - because a
-- value must be addressable and independently editable by concurrent writers. A view config is
-- the opposite kind of thing: it is read and written whole, by one owner, as a single unit. Ten
-- columns and a child table for filters would buy addressability nobody needs and freeze the
-- shape so that adding "subgroup" later is a migration. The trade is real and it is being made
-- knowingly: the cost is that Postgres cannot type-check the inside of the document.
--
-- SO THE SHAPE IS VALIDATED BY A TRIGGER, minimally. 114's lesson holds - a rule enforced only
-- in the UI is enforced by nothing, and an import or psql write would store a config that
-- makes every view crash on load. But the validation checks only what the renderer genuinely
-- cannot survive without (an object, a known layout, arrays where arrays are indexed) and
-- deliberately does NOT enumerate every key, so a new field is a code change and not a
-- migration. Validating more here would trade the one advantage the jsonb choice bought.
--
-- SCOPES
--   personal - owner only, on every verb. No admin bypass, matching 117's task_reminders: a
--              saved view is a note about how someone likes to work, and an admin has no more
--              business reading it than reading their reminders. Asserted below.
--   shared   - readable by anyone who can read what it points at; manageable by its owner or
--              an admin, because shared views are org furniture and somebody has to be able to
--              tidy up after a departure.
--
-- A BOARD-SCOPED SHARED VIEW IS BOUNDED BY THE BOARD. If board_id is set, the view is visible
-- only to people who can SELECT that board, so a shared view on a private board does not
-- announce the board's name or its filters to the company.
-- ⚠️ Residual, stated rather than hidden: a GLOBAL shared view (board_id IS NULL) is visible to
-- every signed-in user, and its config may name private board uuids in a filter. That leaks
-- ids, never content - the tasks behind them stay hidden by their own policies at query time.
-- If that ever matters, the fix is to bound global shared views by the boards they name, not to
-- pretend the config is opaque.
--
-- NOT ADDED, deliberately: an is_active clause on INSERT. 101 folded is_active into the
-- tasks/comments/chat INSERT policies because those grant reach into shared work. A saved view
-- grants nothing at all, and a deactivated account is banned at GoTrue and cannot sign in to
-- create one. Adding the clause would be cargo-culting the shape without the reason.
--
-- NOT ADDED, deliberately: UNIQUE (owner_id, name). Two views called "This week" on different
-- boards is reasonable, and a UNIQUE over a nullable board_id would not mean what it looks like
-- (NULLs compare distinct, so it would police board views and silently ignore global ones). The
-- UI warns about a duplicate name instead.
--
-- SAFETY
-- Purely additive: one new table, one new trigger ON THAT NEW TABLE ONLY, no existing table,
-- row, policy, grant or trigger touched. --allow-prod eligible on this repo's own rule, unlike
-- 118. Seeds zero views, so applying it changes nothing anyone can see.

BEGIN;

CREATE TEMP TABLE _119_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.boards)                          AS board_rows,
  (SELECT count(*) FROM public.tasks)                           AS task_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

-- ---------------------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  scope       TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'shared')),
  -- NULL = a cross-board view. Set = this view belongs to one board and is bounded by it.
  board_id    UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A departing person's PERSONAL views go with them (they are private notes), which the
-- ON DELETE CASCADE above does. Their SHARED views would go too, which is wrong - so the
-- delete-user route reassigns shared views the same way it reassigns boards. See 100.

CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON public.saved_views (owner_id);
CREATE INDEX IF NOT EXISTS idx_saved_views_board ON public.saved_views (board_id)
  WHERE board_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saved_views_shared ON public.saved_views (scope)
  WHERE scope = 'shared';

COMMENT ON TABLE public.saved_views IS
  'A stored view configuration: layout, scope, descendant behaviour, filters, sort, grouping, '
  'visible fields and density, as one jsonb document. personal = owner-only on every verb, no '
  'admin bypass. shared = readable by anyone who can read what it points at.';

COMMENT ON COLUMN public.saved_views.config IS
  'The normalized view config (lib/view-config.ts is the TypeScript mirror). Shape is validated '
  'by a trigger only as far as the renderer requires - deliberately not a full schema, so a new '
  'field is a code change rather than a migration.';

-- ---------------------------------------------------------------------------------------
-- Shape validation
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.validate_saved_view_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_layout TEXT;
  v_scope  TEXT;
BEGIN
  IF jsonb_typeof(NEW.config) <> 'object' THEN
    RAISE EXCEPTION 'A saved view config must be a JSON object, got %.', jsonb_typeof(NEW.config)
      USING ERRCODE = 'check_violation';
  END IF;

  v_layout := NEW.config ->> 'layout';
  IF v_layout IS NULL OR v_layout NOT IN ('list', 'table', 'kanban', 'calendar') THEN
    RAISE EXCEPTION
      'A saved view config needs a layout of list, table, kanban or calendar; got %.',
      COALESCE(v_layout, 'null')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every array the renderer indexes into must really be an array. A string here does not
  -- fail loudly, it renders as a list of characters.
  IF NEW.config ? 'filters' AND jsonb_typeof(NEW.config -> 'filters') <> 'array' THEN
    RAISE EXCEPTION 'saved view config.filters must be an array.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.config ? 'sort' AND jsonb_typeof(NEW.config -> 'sort') <> 'array' THEN
    RAISE EXCEPTION 'saved view config.sort must be an array.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.config ? 'visibleFields' AND jsonb_typeof(NEW.config -> 'visibleFields') <> 'array' THEN
    RAISE EXCEPTION 'saved view config.visibleFields must be an array.' USING ERRCODE = 'check_violation';
  END IF;

  v_scope := NEW.config ->> 'descendants';
  IF v_scope IS NOT NULL AND v_scope NOT IN ('none', 'direct', 'all') THEN
    RAISE EXCEPTION
      'saved view config.descendants must be none, direct or all; got %.', v_scope
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

COMMENT ON FUNCTION private.validate_saved_view_config() IS
  'Minimal shape guard for saved_views.config plus the updated_at stamp. Checks only what the '
  'renderer cannot survive without; deliberately not a full schema.';

DROP TRIGGER IF EXISTS validate_saved_view_config ON public.saved_views;
CREATE TRIGGER validate_saved_view_config
  BEFORE INSERT OR UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION private.validate_saved_view_config();

-- ---------------------------------------------------------------------------------------
-- Grants, then RLS
-- ---------------------------------------------------------------------------------------
-- Supabase default-grants ALL on every new table in public to anon and authenticated, so
-- granting narrowly is not enough - the wide grant is already there. 090's lesson, and 095
-- narrowed the DEFAULT but could not reach tables created through the dashboard.
REVOKE ALL ON public.saved_views FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own views and shared ones you can reach" ON public.saved_views;
CREATE POLICY "Read own views and shared ones you can reach" ON public.saved_views
  FOR SELECT USING (
    owner_id = auth.uid()
    OR (
      scope = 'shared'
      AND (
        board_id IS NULL
        OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = saved_views.board_id)
      )
    )
  );

-- The EXISTS above reads `boards` through the CALLER's own SELECT policy, so a shared view on
-- a private board is invisible to a non-member without this policy needing to know anything
-- about board privacy. Adding a privacy term here would be a second copy of a rule 061 already
-- owns, and 109 records what happens when that rule ends up in three places.

DROP POLICY IF EXISTS "Create your own views" ON public.saved_views;
CREATE POLICY "Create your own views" ON public.saved_views
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND (
      board_id IS NULL
      OR EXISTS (SELECT 1 FROM public.boards b WHERE b.id = saved_views.board_id)
    )
  );

DROP POLICY IF EXISTS "Update your own views, or shared ones as an admin" ON public.saved_views;
CREATE POLICY "Update your own views, or shared ones as an admin" ON public.saved_views
  FOR UPDATE
  USING (owner_id = auth.uid() OR (scope = 'shared' AND private.is_admin_user()))
  WITH CHECK (owner_id = auth.uid() OR (scope = 'shared' AND private.is_admin_user()));

DROP POLICY IF EXISTS "Delete your own views, or shared ones as an admin" ON public.saved_views;
CREATE POLICY "Delete your own views, or shared ones as an admin" ON public.saved_views
  FOR DELETE USING (owner_id = auth.uid() OR (scope = 'shared' AND private.is_admin_user()));

-- ⚠️ Both admin clauses are ANDed with scope = 'shared'. An admin deliberately cannot touch a
-- PERSONAL view, and cannot read one at all. The post-conditions assert the SELECT policy has
-- no admin term so this cannot be softened by accident - same guard as 117's.

-- ---------------------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_boards   BIGINT;
  v_before_tasks    BIGINT;
  v_before_policies BIGINT;
  v_count           BIGINT;
  v_qual            TEXT;
  v_owner           UUID;
BEGIN
  SELECT board_rows, task_rows, policy_rows
    INTO v_before_boards, v_before_tasks, v_before_policies FROM _119_precheck;

  SELECT count(*) INTO v_count FROM public.boards;
  IF v_count IS DISTINCT FROM v_before_boards THEN
    RAISE EXCEPTION 'boards row count changed (% -> %). Aborting.', v_before_boards, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.tasks;
  IF v_count IS DISTINCT FROM v_before_tasks THEN
    RAISE EXCEPTION 'tasks row count changed (% -> %). Aborting.', v_before_tasks, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies + 4 THEN
    RAISE EXCEPTION 'Expected % policies after adding 4, found %. Aborting.',
      v_before_policies + 4, v_count;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.saved_views'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on saved_views. Aborting.';
  END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'saved_views' AND grantee = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'anon holds % grant(s) on saved_views. Aborting.', v_count;
  END IF;

  -- A personal view must be unreadable by an admin. If an admin term ever appears in the
  -- SELECT policy this fails loudly rather than quietly widening.
  SELECT qual INTO v_qual FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'saved_views' AND cmd = 'SELECT';
  IF v_qual LIKE '%is_admin_user%' OR v_qual LIKE '%is_super_admin_user%' THEN
    RAISE EXCEPTION
      'The saved_views SELECT policy has an admin bypass. A personal view is private by design. '
      'Aborting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'validate_saved_view_config'
      AND tgrelid = 'public.saved_views'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The saved view config validator is missing. Aborting.';
  END IF;

  -- "The trigger exists" and "the trigger refuses this" are different claims. Try the bad
  -- values rather than asserting the constraint is present (117's lesson).
  SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_119_probe', '"not an object"'::jsonb);
      RAISE EXCEPTION 'A non-object config was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_119_probe', '{"layout":"gantt"}'::jsonb);
      RAISE EXCEPTION 'An unknown layout was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_119_probe', '{"layout":"list","filters":"nope"}'::jsonb);
      RAISE EXCEPTION 'A non-array filters was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_119_probe', '{"layout":"list","descendants":"everything"}'::jsonb);
      RAISE EXCEPTION 'An unknown descendant mode was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '   ', '{"layout":"list"}'::jsonb);
      RAISE EXCEPTION 'A blank name was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And a good one must be accepted, or the guard is simply refusing everything.
    INSERT INTO public.saved_views (owner_id, name, config)
    VALUES (v_owner, '_119_probe_ok',
            '{"layout":"kanban","descendants":"all","filters":[],"sort":[],"visibleFields":[]}'::jsonb);
    DELETE FROM public.saved_views WHERE name = '_119_probe_ok';
  END IF;

  SELECT count(*) INTO v_count FROM public.saved_views;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 seeded views, found %. Aborting.', v_count;
  END IF;

  RAISE NOTICE '119 verified: saved_views, 4 policies, config guard refuses 5 bad shapes.';
END $$;

COMMIT;
