-- Revert 136 (the timeline module and its saved-view layout).
--
-- ⚠️ READ THIS BEFORE RUNNING. It restores 119's four-layout list, so any saved view already
-- stored with {"layout":"timeline"} keeps its row but FAILS ITS NEXT EDIT with a check
-- violation, and the workspace will fall back to its default layout when it reads one. That
-- is deliberate: silently rewriting somebody's saved view to a layout they did not choose is
-- worse than a loud refusal. To avoid it entirely, retire those views first:
--
--   SELECT id, name, owner_id FROM public.saved_views WHERE config->>'layout' = 'timeline';
--
-- Destroys no other data: the module row is a switch, and no task, milestone or view row is
-- deleted here.

BEGIN;

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

DELETE FROM public.app_modules WHERE module_key = 'timeline';

DELETE FROM public.applied_migrations WHERE filename = '136_timeline_module.sql';

DO $$
DECLARE v_count BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_modules WHERE module_key = 'timeline') THEN
    RAISE EXCEPTION 'The timeline module row survived the revert. Aborting.';
  END IF;

  SELECT count(*) INTO v_count FROM public.saved_views WHERE config->>'layout' = 'timeline';
  IF v_count > 0 THEN
    RAISE WARNING
      '% saved view(s) still ask for the timeline layout and can no longer be edited. See this '
      'file''s header.', v_count;
  END IF;

  RAISE NOTICE '136 reverted: four layouts, module row removed.';
END $$;

COMMIT;
