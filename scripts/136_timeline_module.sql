-- 136: the optional `timeline` module, and the saved-view layout that goes with it.
--
-- WHY A FIFTH LAYOUT RATHER THAN A SIXTH ROUTE
-- master-prompt.md's LAYOUTS line names Timeline and Gantt beside List, Table, Kanban and
-- Calendar, and Prompt E built exactly one configuration model that every layout renders from.
-- A standalone /timeline route would rebuild filtering, grouping, descendant scope and saved
-- views a third time - which is the duplication Prompt E's own audit was spent collapsing,
-- after it found three implementations of one filter disagreeing with each other. As a layout
-- the timeline inherits all of it and costs one string.
--
-- WHY A MODULE ANYWAY
-- master-prompt.md also says module activation should support "Timeline and Gantt", and
-- CLAUDE.md's "Explicitly not building" listed Gantt/timeline until the scope decision that
-- produced this file. Seeding the module DISABLED means the deploy changes nothing anyone can
-- see: the layout is not offered, no saved view can select it, and the four existing layouts
-- are untouched. It is the appointments (080) / crm (103) / agile (123) / strategy (129)
-- pattern, and the fifth time this repo has shipped a feature switched off.
--
-- ⚠️ THIS REPLACES A TRIGGER FUNCTION ON AN EXISTING TABLE, WHICH IS WORTH ARGUING ABOUT.
-- private.validate_saved_view_config (119) refuses any layout outside its own list, and 119's
-- post-conditions prove it by trying {"layout":"gantt"} and asserting the refusal. So adding a
-- layout is a real change to a real guard, not a comment. The eligibility argument:
--   * The change is strictly WIDENING. The new list is the old list plus one value. No config
--     the old function accepted is rejected by the new one, so no existing saved view can stop
--     validating - and saved_views rows are only re-validated when somebody edits them.
--   * The table is one 119 created for this feature family, and no write path outside the
--     views workspace touches it.
--   * The post-conditions below re-assert 119's own five refusals, then add the new
--     acceptance, so this file cannot loosen the guard in any direction it did not intend.
--     'gantt' stays refused deliberately: it is the negative case 119 chose, and keeping it
--     invalid proves the list is still a list rather than an open door.
-- Purely additive on the module side (one app_modules row). Eligible on this repo's rule.
--
-- Rollback: scripts/rollback/136_revert.sql (restores 119's four-layout list and removes the
-- module row; any saved view already on the timeline layout then fails its next edit, which
-- the revert's own header says out loud).

BEGIN;

DROP TABLE IF EXISTS _136_precheck;
CREATE TEMP TABLE _136_precheck AS
SELECT
  (SELECT count(*) FROM public.saved_views) AS view_rows,
  (SELECT count(*) FROM public.app_modules) AS module_rows,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policy_rows;

-- ---------------------------------------------------------------------------------------
-- The module, seeded OFF
-- ---------------------------------------------------------------------------------------
INSERT INTO public.app_modules (module_key, enabled)
VALUES ('timeline', false)
ON CONFLICT (module_key) DO NOTHING;

-- ---------------------------------------------------------------------------------------
-- 119's config guard, widened by exactly one value
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
  IF v_layout IS NULL OR v_layout NOT IN ('list', 'table', 'kanban', 'calendar', 'timeline') THEN
    RAISE EXCEPTION
      'A saved view config needs a layout of list, table, kanban, calendar or timeline; got %.',
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

  -- ⚠️ The timeline's own settings (zoom, whether milestones are drawn, which end of the bar
  -- an undated task hangs from) are deliberately NOT validated here. 119's rule was that this
  -- guard checks only what the renderer cannot survive without, so that adding a field stays
  -- a code change rather than a migration - and lib/timeline.ts falls back to a default for
  -- every one of them rather than throwing.

  NEW.updated_at := now();
  RETURN NEW;
END $$;

COMMENT ON FUNCTION private.validate_saved_view_config() IS
  'Minimal shape guard for saved_views.config plus the updated_at stamp. Checks only what the '
  'renderer cannot survive without; deliberately not a full schema. 136 added the timeline '
  'layout to the list and changed nothing else.';

-- ---------------------------------------------------------------------------------------
-- Post-conditions: 119's five refusals must still hold, plus the one new acceptance.
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  v_before_views    BIGINT;
  v_before_modules  BIGINT;
  v_before_policies BIGINT;
  v_count           BIGINT;
  v_owner           UUID;
BEGIN
  SELECT view_rows, module_rows, policy_rows
    INTO v_before_views, v_before_modules, v_before_policies FROM _136_precheck;

  SELECT count(*) INTO v_count FROM public.saved_views;
  IF v_count IS DISTINCT FROM v_before_views THEN
    RAISE EXCEPTION 'saved_views row count changed (% -> %). Aborting.', v_before_views, v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.app_modules;
  IF v_count IS DISTINCT FROM v_before_modules + 1 THEN
    RAISE EXCEPTION 'Expected one new module row, went % -> %. Aborting.',
      v_before_modules, v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_modules WHERE module_key = 'timeline' AND enabled = false
  ) THEN
    RAISE EXCEPTION
      'The timeline module is missing or seeded ENABLED. It must ship off. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public';
  IF v_count IS DISTINCT FROM v_before_policies THEN
    RAISE EXCEPTION 'Policy count changed (% -> %); this file adds none. Aborting.',
      v_before_policies, v_count;
  END IF;

  SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_owner IS NOT NULL THEN
    -- The new acceptance.
    INSERT INTO public.saved_views (owner_id, name, config)
    VALUES (v_owner, '_136_probe_timeline', '{"layout":"timeline"}'::jsonb);

    -- 119's four original layouts must all still validate.
    INSERT INTO public.saved_views (owner_id, name, config)
    VALUES (v_owner, '_136_probe_ok',
            '{"layout":"kanban","descendants":"all","filters":[],"sort":[],"visibleFields":[]}'::jsonb);
    UPDATE public.saved_views SET config = '{"layout":"list"}'::jsonb     WHERE name = '_136_probe_ok';
    UPDATE public.saved_views SET config = '{"layout":"table"}'::jsonb    WHERE name = '_136_probe_ok';
    UPDATE public.saved_views SET config = '{"layout":"calendar"}'::jsonb WHERE name = '_136_probe_ok';

    -- And 119's five refusals must all still refuse. 'gantt' stays the negative case.
    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_136_probe', '"not an object"'::jsonb);
      RAISE EXCEPTION 'A non-object config was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_136_probe', '{"layout":"gantt"}'::jsonb);
      RAISE EXCEPTION 'An unknown layout was accepted; the list is no longer a list. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_136_probe', '{"layout":"timeline","filters":"nope"}'::jsonb);
      RAISE EXCEPTION 'A non-array filters was accepted on the new layout. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '_136_probe', '{"layout":"timeline","descendants":"everything"}'::jsonb);
      RAISE EXCEPTION 'An unknown descendant mode was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.saved_views (owner_id, name, config)
      VALUES (v_owner, '   ', '{"layout":"timeline"}'::jsonb);
      RAISE EXCEPTION 'A blank name was accepted. Aborting.';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    DELETE FROM public.saved_views WHERE name LIKE '\_136\_probe%';
  END IF;

  SELECT count(*) INTO v_count FROM public.saved_views;
  IF v_count IS DISTINCT FROM v_before_views THEN
    RAISE EXCEPTION 'saved_views row count changed during the probes (% -> %). Aborting.',
      v_before_views, v_count;
  END IF;

  RAISE NOTICE
    '136 verified: timeline module seeded OFF, 5 layouts accepted, 119''s 5 refusals intact, '
    'gantt still refused, saved_views unchanged at %.', v_before_views;
END $$;

COMMIT;
